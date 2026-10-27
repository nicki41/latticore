import type { Prisma, PrismaClient } from "@prisma/client";
import type { CreateRoleInput, Permission, RoleDto, UpdateRoleInput } from "@latticore/shared";
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from "../../lib/errors.js";

export interface ActingUser {
  isOwner: boolean;
  permissions: ReadonlySet<Permission>;
}

const roleWithCountsInclude = {
  permissions: { include: { permission: true } },
  _count: { select: { users: true } },
} satisfies Prisma.RoleInclude;

type RoleWithCounts = Prisma.RoleGetPayload<{ include: typeof roleWithCountsInclude }>;

/**
 * Standard RBAC guard: nobody can grant a permission they don't hold
 * themselves. Without this, any user with roles.manage (e.g. the built-in
 * Admin role) could create a custom role containing settings.manage or any
 * other permission and assign it to themselves, escalating past their own
 * actual access. Exported standalone (rather than a private method) so it
 * has direct unit test coverage without needing a mocked Prisma client.
 */
export function assertGrantable(permissions: Permission[], actingUser: ActingUser): void {
  if (actingUser.isOwner) return;
  const notHeld = permissions.filter((p) => !actingUser.permissions.has(p));
  if (notHeld.length > 0) {
    throw new ForbiddenError(`You cannot grant permissions you don't have yourself: ${notHeld.join(", ")}`);
  }
}

function serialize(role: RoleWithCounts): RoleDto {
  return {
    id: role.id,
    name: role.name,
    isSystem: role.isSystem,
    permissions: role.permissions.map((p) => p.permission.key as Permission),
    userCount: role._count.users,
  };
}

export class RoleService {
  constructor(private readonly prisma: PrismaClient) {}

  async list(): Promise<RoleDto[]> {
    const roles = await this.prisma.role.findMany({ include: roleWithCountsInclude, orderBy: { name: "asc" } });
    return roles.map(serialize);
  }

  async create(input: CreateRoleInput, actingUser: ActingUser): Promise<RoleDto> {
    assertGrantable(input.permissions, actingUser);

    const existing = await this.prisma.role.findUnique({ where: { name: input.name } });
    if (existing) throw new ConflictError("A role with that name already exists.");

    const permissionIds = await this.permissionIdsFor(input.permissions);
    const role = await this.prisma.role.create({
      data: {
        name: input.name,
        isSystem: false,
        permissions: { create: permissionIds.map((permissionId) => ({ permissionId })) },
      },
      include: roleWithCountsInclude,
    });
    return serialize(role);
  }

  async update(id: string, input: UpdateRoleInput, actingUser: ActingUser): Promise<RoleDto> {
    const existing = await this.prisma.role.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError("Role not found.");
    if (existing.isSystem) {
      throw new BadRequestError("Built-in roles can't be edited — create a custom role instead.");
    }

    if (input.name && input.name !== existing.name) {
      const clash = await this.prisma.role.findUnique({ where: { name: input.name } });
      if (clash) throw new ConflictError("A role with that name already exists.");
    }

    if (input.permissions) {
      assertGrantable(input.permissions, actingUser);
      const permissionIds = await this.permissionIdsFor(input.permissions);
      await this.prisma.rolePermission.deleteMany({ where: { roleId: id } });
      await this.prisma.rolePermission.createMany({ data: permissionIds.map((permissionId) => ({ roleId: id, permissionId })) });
    }

    const role = await this.prisma.role.update({
      where: { id },
      data: { name: input.name },
      include: roleWithCountsInclude,
    });
    return serialize(role);
  }

  async delete(id: string): Promise<void> {
    const existing = await this.prisma.role.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError("Role not found.");
    if (existing.isSystem) throw new BadRequestError("Built-in roles can't be deleted.");
    await this.prisma.role.delete({ where: { id } });
  }

  private async permissionIdsFor(keys: Permission[]): Promise<string[]> {
    if (keys.length === 0) return [];
    const rows = await this.prisma.permission.findMany({ where: { key: { in: keys } } });
    return rows.map((r) => r.id);
  }
}
