import { hash as argonHash, verify as argonVerify } from "@node-rs/argon2";
import { TOTP, Secret } from "otpauth";
import QRCode from "qrcode";
import type { Prisma, PrismaClient } from "@prisma/client";
import { PERMISSIONS, SYSTEM_ROLES, type ChangePasswordInput, type LoginInput, type Permission, type SetupAdminInput } from "@latticore/shared";
import { ConflictError, ForbiddenError, UnauthenticatedError } from "../../lib/errors.js";
import { decryptTotpSecret, encryptTotpSecret } from "../../lib/totpCrypto.js";
import { generateRecoveryCodes, hashRecoveryCode } from "../../lib/recoveryCodes.js";
import {
  generateSessionToken,
  hashSessionToken,
  sessionExpiryFromNow,
  shouldRefreshSession,
} from "./session.js";

const TOTP_ISSUER = "Latticore";

export interface AuthenticatedUser {
  id: string;
  username: string;
  email: string;
  isOwner: boolean;
  isDisabled: boolean;
  totpEnabled: boolean;
  roles: { id: string; name: string }[];
  /** Global (non server-scoped) effective permissions — Owner implicitly has all of them. */
  permissions: Set<Permission>;
}

export interface SessionContext {
  ipAddress?: string | null;
  userAgent?: string | null;
}

// OWASP-recommended minimums for argon2id as of the 2024/2025 cheat sheet.
const ARGON2_OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1 };

const userWithRolesInclude = {
  roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
} satisfies Prisma.UserInclude;

type UserWithRoles = Prisma.UserGetPayload<{ include: typeof userWithRolesInclude }>;
type Db = PrismaClient | Prisma.TransactionClient;

let cachedDummyHash: string | null = null;
/** A real, validly-formatted argon2 hash nothing will ever match, used to keep login timing similar for unknown usernames vs wrong passwords. */
async function getDummyHash(): Promise<string> {
  if (!cachedDummyHash) {
    cachedDummyHash = await argonHash("not-a-real-password-used-only-for-timing-safety", ARGON2_OPTIONS);
  }
  return cachedDummyHash;
}

export class AuthService {
  constructor(private readonly prisma: PrismaClient) {}

  async hasAnyUser(): Promise<boolean> {
    return (await this.prisma.user.count()) > 0;
  }

  async createFirstAdmin(input: SetupAdminInput, ctx: SessionContext) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.user.count();
      if (existing > 0) throw new ConflictError("An administrator account already exists.");

      const [byUsername, byEmail] = await Promise.all([
        tx.user.findUnique({ where: { username: input.username } }),
        tx.user.findUnique({ where: { email: input.email } }),
      ]);
      if (byUsername) throw new ConflictError("Username is already taken.");
      if (byEmail) throw new ConflictError("Email is already registered.");

      const ownerRole = await tx.role.findUnique({ where: { name: SYSTEM_ROLES.OWNER } });
      if (!ownerRole) throw new Error("Owner role is not seeded — this should never happen.");

      const passwordHash = await argonHash(input.password, ARGON2_OPTIONS);
      const user = await tx.user.create({
        data: {
          username: input.username,
          email: input.email,
          passwordHash,
          isOwner: true,
          roles: { create: [{ roleId: ownerRole.id }] },
        },
        include: userWithRolesInclude,
      });

      const { token } = await this.createSessionRecord(tx, user.id, ctx);
      return { user, token };
    });
  }

  async login(
    input: LoginInput,
    ctx: SessionContext,
  ): Promise<{ requiresTotp: true; userId: string } | { requiresTotp: false; user: UserWithRoles; token: string }> {
    const user = await this.prisma.user.findFirst({
      where: { OR: [{ username: input.usernameOrEmail }, { email: input.usernameOrEmail.toLowerCase() }] },
      include: userWithRolesInclude,
    });

    const hashToVerify = user?.passwordHash ?? (await getDummyHash());
    const valid = await argonVerify(hashToVerify, input.password).catch(() => false);

    if (!user || !valid || user.isDisabled) {
      throw new UnauthenticatedError("Invalid username/email or password.");
    }

    if (user.totpEnabled) {
      return { requiresTotp: true, userId: user.id };
    }

    const { token } = await this.createSessionRecord(this.prisma, user.id, ctx);
    return { requiresTotp: false, user, token };
  }

  /** Second login step once a password has already been verified and 2FA is required. Accepts a TOTP code or an unused recovery code. */
  async verifyTotpLogin(userId: string, code: string, ctx: SessionContext): Promise<{ user: UserWithRoles; token: string }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, include: userWithRolesInclude });
    if (!user || !user.totpEnabled || !user.totpSecretEncrypted || user.isDisabled) {
      throw new UnauthenticatedError("Your two-factor session has expired — please log in again.");
    }

    const isValidTotp = this.checkTotpCode(user.totpSecretEncrypted, code);
    const isValidRecovery = !isValidTotp && (await this.tryConsumeRecoveryCode(user.id, code));
    if (!isValidTotp && !isValidRecovery) {
      throw new UnauthenticatedError("Invalid authentication code.");
    }

    const { token } = await this.createSessionRecord(this.prisma, user.id, ctx);
    return { user, token };
  }

  /** Starts (or restarts) 2FA setup: provisions a new secret, not yet active until enableTotp confirms it with a real code. */
  async setupTotp(userId: string): Promise<{ secret: string; otpauthUrl: string; qrCodeDataUrl: string }> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const totp = new TOTP({
      issuer: TOTP_ISSUER,
      label: user.username,
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      secret: new Secret({ size: 20 }),
    });

    await this.prisma.user.update({
      where: { id: userId },
      data: { totpSecretEncrypted: encryptTotpSecret(totp.secret.base32), totpEnabled: false },
    });

    const otpauthUrl = totp.toString();
    const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl);
    return { secret: totp.secret.base32, otpauthUrl, qrCodeDataUrl };
  }

  /** Confirms setupTotp's provisioned secret with a real code, flips 2FA on, and issues one-time recovery codes. */
  async enableTotp(userId: string, code: string): Promise<{ recoveryCodes: string[] }> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.totpSecretEncrypted) {
      throw new ConflictError("Start two-factor setup before confirming a code.");
    }
    if (!this.checkTotpCode(user.totpSecretEncrypted, code)) {
      throw new UnauthenticatedError("Invalid code — check your authenticator app and try again.");
    }

    const recoveryCodes = generateRecoveryCodes();
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: userId }, data: { totpEnabled: true } }),
      // Re-enabling after a prior disable shouldn't leave stale codes from that earlier setup lying around.
      this.prisma.recoveryCode.deleteMany({ where: { userId } }),
      this.prisma.recoveryCode.createMany({
        data: recoveryCodes.map((c) => ({ userId, codeHash: hashRecoveryCode(c) })),
      }),
    ]);

    return { recoveryCodes };
  }

  /** Requires the current password again — disabling 2FA is exactly the kind of action a hijacked-but-not-fully-authenticated session shouldn't be able to do silently. */
  async disableTotp(userId: string, password: string): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const valid = await argonVerify(user.passwordHash, password).catch(() => false);
    if (!valid) throw new ForbiddenError("Incorrect password.");

    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: userId }, data: { totpEnabled: false, totpSecretEncrypted: null } }),
      this.prisma.recoveryCode.deleteMany({ where: { userId } }),
    ]);
  }

  private checkTotpCode(encryptedSecret: string, code: string): boolean {
    const totp = new TOTP({
      issuer: TOTP_ISSUER,
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      secret: Secret.fromBase32(decryptTotpSecret(encryptedSecret)),
    });
    // window: 1 tolerates the code from one 30s step before/after "now" for clock drift.
    return totp.validate({ token: code.trim(), window: 1 }) !== null;
  }

  private async tryConsumeRecoveryCode(userId: string, code: string): Promise<boolean> {
    if (!/^[A-Z0-9-]{5,16}$/i.test(code.trim())) return false;
    const result = await this.prisma.recoveryCode.updateMany({
      where: { userId, codeHash: hashRecoveryCode(code), usedAt: null },
      data: { usedAt: new Date() },
    });
    return result.count > 0;
  }

  async logout(rawToken: string): Promise<void> {
    await this.prisma.session.deleteMany({ where: { tokenHash: hashSessionToken(rawToken) } });
  }

  async getUserFromToken(rawToken: string): Promise<AuthenticatedUser | null> {
    const tokenHash = hashSessionToken(rawToken);
    const session = await this.prisma.session.findUnique({
      where: { tokenHash },
      include: { user: { include: userWithRolesInclude } },
    });

    if (!session) return null;
    if (session.expiresAt.getTime() < Date.now()) {
      await this.prisma.session.delete({ where: { id: session.id } }).catch(() => {});
      return null;
    }
    if (session.user.isDisabled) return null;

    if (shouldRefreshSession(session.expiresAt)) {
      await this.prisma.session
        .update({ where: { id: session.id }, data: { expiresAt: sessionExpiryFromNow() } })
        .catch(() => {});
    }

    return toAuthenticatedUser(session.user);
  }

  async changePassword(userId: string, input: ChangePasswordInput, currentRawToken: string): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const valid = await argonVerify(user.passwordHash, input.currentPassword).catch(() => false);
    if (!valid) throw new UnauthenticatedError("Current password is incorrect.");

    const newHash = await argonHash(input.newPassword, ARGON2_OPTIONS);
    const currentTokenHash = hashSessionToken(currentRawToken);

    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: userId }, data: { passwordHash: newHash } }),
      // Changing your password invalidates every other session (not the one making the request).
      this.prisma.session.deleteMany({ where: { userId, NOT: { tokenHash: currentTokenHash } } }),
    ]);
  }

  async listSessions(userId: string, currentRawToken: string | null) {
    const currentTokenHash = currentRawToken ? hashSessionToken(currentRawToken) : null;
    const sessions = await this.prisma.session.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      select: { id: true, userAgent: true, ipAddress: true, createdAt: true, expiresAt: true, tokenHash: true },
    });
    return sessions.map(({ tokenHash, ...rest }) => ({ ...rest, isCurrent: tokenHash === currentTokenHash }));
  }

  async revokeSession(userId: string, sessionId: string): Promise<void> {
    await this.prisma.session.deleteMany({ where: { id: sessionId, userId } });
  }

  private async createSessionRecord(db: Db, userId: string, ctx: SessionContext) {
    const token = generateSessionToken();
    const tokenHash = hashSessionToken(token);
    await db.session.create({
      data: {
        userId,
        tokenHash,
        userAgent: ctx.userAgent ?? null,
        ipAddress: ctx.ipAddress ?? null,
        expiresAt: sessionExpiryFromNow(),
      },
    });
    return { token, tokenHash };
  }
}

export function toAuthenticatedUser(user: UserWithRoles): AuthenticatedUser {
  const permissions = new Set<Permission>();
  const roles: { id: string; name: string }[] = [];

  for (const userRole of user.roles) {
    roles.push({ id: userRole.role.id, name: userRole.role.name });
    for (const rolePermission of userRole.role.permissions) {
      permissions.add(rolePermission.permission.key as Permission);
    }
  }
  if (user.isOwner) {
    for (const p of PERMISSIONS) permissions.add(p);
  }

  return {
    id: user.id,
    username: user.username,
    email: user.email,
    isOwner: user.isOwner,
    isDisabled: user.isDisabled,
    totpEnabled: user.totpEnabled,
    roles,
    permissions,
  };
}
