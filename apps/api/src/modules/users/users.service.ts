import { hash as argonHash } from "@node-rs/argon2";
import type { Prisma, PrismaClient } from "@prisma/client";
import type { CreateUserInput, UpdateUserInput, UserDto } from "@latticore/shared";
import { SYSTEM_ROLES } from "@latticore/shared";
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from "../../lib/errors.js";

const ARGON2_OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1 };

const userWithRolesInclude = {
  roles: { include: { role: true } },
} satisfies Prisma.UserInclude;

type UserWithRoles = Prisma.UserGetPayload<{ include: typeof userWithRolesInclude }>;

function serialize(user: UserWithRoles): UserDto {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    isOwner: user.isOwner,
    isDisabled: user.isDisabled,
    roles: user.roles.map((r) => ({ id: r.role.id, name: r.role.name })),
    createdAt: user.createdAt.toISOString(),
  };
}

export class UserService {
  constructor(private readonly prisma: PrismaClient) {}

  async list(): Promise<UserDto[]> {
    const users = await this.prisma.user.findMany({ include: userWithRolesInclude, orderBy: { createdAt: "asc" } });
    return users.map(serialize);
  }

  async get(id: string): Promise<UserDto> {
    const user = await this.requireUser(id);
    return serialize(user);
  }

  async create(input: CreateUserInput, actingUserIsOwner: boolean): Promise<UserDto> {
    const [byUsername, byEmail] = await Promise.all([
      this.prisma.user.findUnique({ where: { username: input.username } }),
      this.prisma.user.findUnique({ where: { email: input.email } }),
    ]);
    if (byUsername) throw new ConflictError("Username is already taken.");
    if (byEmail) throw new ConflictError("Email is already registered.");

    const roles = await this.resolveRoles(input.roleIds);
    const willBeOwner = roles.some((r) => r.name === SYSTEM_ROLES.OWNER);
    if (willBeOwner && !actingUserIsOwner) {
      throw new ForbiddenError("Only an Owner can grant Owner access.");
    }

    const passwordHash = await argonHash(input.password, ARGON2_OPTIONS);

    const user = await this.prisma.user.create({
      data: {
        username: input.username,
        email: input.email,
        passwordHash,
        isOwner: willBeOwner,
        roles: { create: roles.map((r) => ({ roleId: r.id })) },
      },
      include: userWithRolesInclude,
    });
    return serialize(user);
  }

  async update(id: string, input: UpdateUserInput, actingUserId: string, actingUserIsOwner: boolean): Promise<UserDto> {
    const existing = await this.requireUser(id);

    let isOwner = existing.isOwner;
    if (input.roleIds) {
      const roles = await this.resolveRoles(input.roleIds);
      const willBeOwner = roles.some((r) => r.name === SYSTEM_ROLES.OWNER);

      if (willBeOwner && !existing.isOwner && !actingUserIsOwner) {
        throw new ForbiddenError("Only an Owner can grant Owner access.");
      }
      if (existing.isOwner && !willBeOwner) {
        await this.assertNotLastOwner(id, "You cannot remove Owner from the last remaining Owner.");
      }
      isOwner = willBeOwner;

      await this.prisma.userRole.deleteMany({ where: { userId: id } });
      await this.prisma.userRole.createMany({ data: roles.map((r) => ({ userId: id, roleId: r.id })) });
    }

    if (input.isDisabled && id === actingUserId) {
      throw new BadRequestError("You cannot disable your own account.");
    }
    if (input.isDisabled && existing.isOwner) {
      await this.assertNotLastOwner(id, "You cannot disable the last remaining Owner.");
    }

    const user = await this.prisma.user.update({
      where: { id },
      data: {
        email: input.email,
        isDisabled: input.isDisabled,
        isOwner,
      },
      include: userWithRolesInclude,
    });
    return serialize(user);
  }

  async delete(id: string, actingUserId: string): Promise<void> {
    if (id === actingUserId) throw new BadRequestError("You cannot delete your own account.");
    const user = await this.requireUser(id);
    if (user.isOwner) {
      await this.assertNotLastOwner(id, "You cannot delete the last remaining Owner.");
    }
    await this.prisma.user.delete({ where: { id } });
  }

  private async assertNotLastOwner(excludingUserId: string, message: string): Promise<void> {
    const otherOwners = await this.prisma.user.count({ where: { isOwner: true, id: { not: excludingUserId } } });
    if (otherOwners === 0) throw new ConflictError(message);
  }

  private async resolveRoles(roleIds: string[]) {
    if (roleIds.length === 0) return [];
    const roles = await this.prisma.role.findMany({ where: { id: { in: roleIds } } });
    if (roles.length !== roleIds.length) throw new BadRequestError("One or more roles were not found.");
    return roles;
  }

  private async requireUser(id: string): Promise<UserWithRoles> {
    const user = await this.prisma.user.findUnique({ where: { id }, include: userWithRolesInclude });
    if (!user) throw new NotFoundError("User not found.");
    return user;
  }
}
