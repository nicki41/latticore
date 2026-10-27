import type { PrismaClient } from "@prisma/client";
import { PERMISSIONS, SYSTEM_ROLE_PERMISSIONS, SYSTEM_ROLES } from "@latticore/shared";

/**
 * Idempotent: safe to run on every boot. Ensures every entry in
 * PERMISSIONS exists as a row, and that the five built-in system roles
 * exist with the permission set defined in packages/shared/src/permissions.ts.
 * Owner always gets the full, current permission list so newly added
 * permissions apply to Owner automatically without a migration.
 */
export async function seedRolesAndPermissions(prisma: PrismaClient) {
  await prisma.$transaction(
    PERMISSIONS.map((key) => prisma.permission.upsert({ where: { key }, update: {}, create: { key } })),
  );

  const allPermissions = await prisma.permission.findMany();
  const byKey = new Map(allPermissions.map((p) => [p.key, p.id]));

  const roleDefs: Record<string, readonly string[]> = {
    [SYSTEM_ROLES.OWNER]: PERMISSIONS,
    [SYSTEM_ROLES.ADMIN]: SYSTEM_ROLE_PERMISSIONS.Admin,
    [SYSTEM_ROLES.MANAGER]: SYSTEM_ROLE_PERMISSIONS.Manager,
    [SYSTEM_ROLES.MODERATOR]: SYSTEM_ROLE_PERMISSIONS.Moderator,
    [SYSTEM_ROLES.VIEWER]: SYSTEM_ROLE_PERMISSIONS.Viewer,
  };

  for (const [name, permissionKeys] of Object.entries(roleDefs)) {
    const role = await prisma.role.upsert({
      where: { name },
      update: { isSystem: true },
      create: { name, isSystem: true },
    });

    const desired = new Set(permissionKeys.map((k) => byKey.get(k)).filter((v): v is string => Boolean(v)));
    const existing = await prisma.rolePermission.findMany({ where: { roleId: role.id } });
    const existingIds = new Set(existing.map((e) => e.permissionId));

    const toAdd = [...desired].filter((id) => !existingIds.has(id));
    const toRemove = existing.filter((e) => !desired.has(e.permissionId));

    if (toAdd.length) {
      // skipDuplicates isn't supported on SQLite; toAdd is already filtered
      // against existingIds above, so plain createMany is safe here.
      await prisma.rolePermission.createMany({
        data: toAdd.map((permissionId) => ({ roleId: role.id, permissionId })),
      });
    }
    if (toRemove.length) {
      await prisma.rolePermission.deleteMany({
        where: { roleId: role.id, permissionId: { in: toRemove.map((r) => r.permissionId) } },
      });
    }
  }
}
