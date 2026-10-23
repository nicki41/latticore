import { describe, expect, it, vi } from "vitest";
import { UserService } from "./users.service.js";

const OWNER_ROLE = { id: "role-owner", name: "Owner" };
const VIEWER_ROLE = { id: "role-viewer", name: "Viewer" };

function makeUser(overrides: Partial<{ id: string; isOwner: boolean; isDisabled: boolean; roles: { role: typeof OWNER_ROLE }[] }> = {}) {
  return {
    id: "user-1",
    username: "nicki",
    email: "nicki@example.com",
    passwordHash: "hash",
    isOwner: false,
    isDisabled: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    roles: [],
    ...overrides,
  };
}

/** Minimal fake Prisma client implementing only what UserService calls. */
function makePrismaMock(opts: { existingUser?: ReturnType<typeof makeUser>; otherOwnerCount?: number } = {}) {
  return {
    user: {
      findUnique: vi.fn(async () => opts.existingUser ?? null),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => makeUser({ ...data, roles: [] } as never)),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => makeUser({ ...(opts.existingUser ?? makeUser()), ...data } as never)),
      delete: vi.fn(async () => undefined),
      count: vi.fn(async () => opts.otherOwnerCount ?? 1),
    },
    role: {
      findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
        [OWNER_ROLE, VIEWER_ROLE].filter((r) => where.id.in.includes(r.id)),
      ),
    },
    userRole: {
      deleteMany: vi.fn(async () => undefined),
      createMany: vi.fn(async () => undefined),
    },
     
  } as any;
}

describe("UserService — Owner-grant escalation guard", () => {
  it("blocks a non-owner from creating a new user with the Owner role", async () => {
    const prisma = makePrismaMock();
    const service = new UserService(prisma);
    await expect(
      service.create({ username: "eve", email: "eve@example.com", password: "Sup3rSecret!", roleIds: [OWNER_ROLE.id] }, false),
    ).rejects.toThrow(/only an owner/i);
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it("allows an Owner to create a new user with the Owner role", async () => {
    const prisma = makePrismaMock();
    const service = new UserService(prisma);
    await expect(
      service.create({ username: "coowner", email: "co@example.com", password: "Sup3rSecret!", roleIds: [OWNER_ROLE.id] }, true),
    ).resolves.toBeDefined();
    expect(prisma.user.create).toHaveBeenCalled();
  });

  it("blocks a non-owner from promoting an existing user to Owner", async () => {
    const existing = makeUser({ isOwner: false, roles: [{ role: VIEWER_ROLE }] });
    const prisma = makePrismaMock({ existingUser: existing });
    const service = new UserService(prisma);
    await expect(service.update(existing.id, { roleIds: [OWNER_ROLE.id] }, "acting-admin", false)).rejects.toThrow(/only an owner/i);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("allows an Owner to promote an existing user to Owner", async () => {
    const existing = makeUser({ isOwner: false, roles: [{ role: VIEWER_ROLE }] });
    const prisma = makePrismaMock({ existingUser: existing });
    const service = new UserService(prisma);
    await expect(service.update(existing.id, { roleIds: [OWNER_ROLE.id] }, "acting-owner", true)).resolves.toBeDefined();
    expect(prisma.user.update).toHaveBeenCalled();
  });

  it("does not require Owner to make a non-owner role change (no escalation involved)", async () => {
    const existing = makeUser({ isOwner: false, roles: [] });
    const prisma = makePrismaMock({ existingUser: existing });
    const service = new UserService(prisma);
    await expect(service.update(existing.id, { roleIds: [VIEWER_ROLE.id] }, "acting-admin", false)).resolves.toBeDefined();
  });
});

describe("UserService — last-Owner lockout protection", () => {
  it("refuses to demote the last Owner's role away from Owner", async () => {
    const existing = makeUser({ isOwner: true, roles: [{ role: OWNER_ROLE }] });
    const prisma = makePrismaMock({ existingUser: existing, otherOwnerCount: 0 });
    const service = new UserService(prisma);
    await expect(service.update(existing.id, { roleIds: [VIEWER_ROLE.id] }, "someone-else", true)).rejects.toThrow(/last remaining owner/i);
  });

  it("allows demoting an Owner when another Owner still exists", async () => {
    const existing = makeUser({ isOwner: true, roles: [{ role: OWNER_ROLE }] });
    const prisma = makePrismaMock({ existingUser: existing, otherOwnerCount: 1 });
    const service = new UserService(prisma);
    await expect(service.update(existing.id, { roleIds: [VIEWER_ROLE.id] }, "someone-else", true)).resolves.toBeDefined();
  });

  it("refuses to delete the last Owner", async () => {
    const existing = makeUser({ isOwner: true });
    const prisma = makePrismaMock({ existingUser: existing, otherOwnerCount: 0 });
    const service = new UserService(prisma);
    await expect(service.delete(existing.id, "someone-else")).rejects.toThrow(/last remaining owner/i);
    expect(prisma.user.delete).not.toHaveBeenCalled();
  });

  it("refuses to let a user delete their own account", async () => {
    const existing = makeUser({ isOwner: false });
    const prisma = makePrismaMock({ existingUser: existing });
    const service = new UserService(prisma);
    await expect(service.delete(existing.id, existing.id)).rejects.toThrow(/own account/i);
  });

  it("refuses to let a user disable their own account", async () => {
    const existing = makeUser({ isOwner: false });
    const prisma = makePrismaMock({ existingUser: existing });
    const service = new UserService(prisma);
    await expect(service.update(existing.id, { isDisabled: true }, existing.id, false)).rejects.toThrow(/own account/i);
  });
});
