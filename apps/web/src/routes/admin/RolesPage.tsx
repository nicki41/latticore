import { useState } from "react";
import { toast } from "sonner";
import { PlusCircle, ShieldCheck, Trash2 } from "lucide-react";
import type { Permission, RoleDto } from "@latticore/shared";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useRoles, useCreateRole, useUpdateRole, useDeleteRole } from "@/lib/roles";
import { useAuth } from "@/lib/auth";
import { ApiError } from "@/lib/api";
import { groupPermissions } from "@/lib/permissionGroups";

const permissionGroups = groupPermissions();

function RoleFormDialog({
  open,
  onOpenChange,
  role,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  role: RoleDto | null;
}) {
  const [name, setName] = useState(role?.name ?? "");
  const [permissions, setPermissions] = useState<Permission[]>(role?.permissions ?? []);
  const createRole = useCreateRole();
  const updateRole = useUpdateRole(role?.id ?? "");
  const isEdit = Boolean(role);
  const readOnly = role?.isSystem ?? false;

  function toggle(p: Permission, checked: boolean) {
    setPermissions((prev) => (checked ? [...prev, p] : prev.filter((x) => x !== p)));
  }

  async function handleSubmit() {
    try {
      if (isEdit) {
        await updateRole.mutateAsync({ name, permissions });
        toast.success("Role updated.");
      } else {
        await createRole.mutateAsync({ name, permissions });
        toast.success("Role created.");
      }
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to save role.");
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) {
          setName(role?.name ?? "");
          setPermissions(role?.permissions ?? []);
        }
      }}
    >
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? `Edit ${role!.name}` : "Create role"}</DialogTitle>
        </DialogHeader>

        {readOnly && <p className="text-sm text-muted-foreground">Built-in roles have a fixed permission set and can&apos;t be edited.</p>}

        <div className="space-y-1.5">
          <Label htmlFor="role-name">Name</Label>
          <Input id="role-name" value={name} onChange={(e) => setName(e.target.value)} disabled={readOnly} />
        </div>

        <div className="space-y-3">
          {Object.entries(permissionGroups).map(([group, perms]) => (
            <div key={group}>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{group}</p>
              <div className="grid grid-cols-2 gap-1.5">
                {perms.map((p) => (
                  <label key={p} className="flex items-center gap-2 text-sm">
                    <Checkbox checked={permissions.includes(p)} onCheckedChange={(v) => toggle(p, Boolean(v))} disabled={readOnly} />
                    <span className="truncate">{p.split(".").slice(1).join(".")}</span>
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          {!readOnly && (
            <Button onClick={handleSubmit} disabled={!name.trim()}>
              {isEdit ? "Save" : "Create"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function RolesPage() {
  const { data, isLoading } = useRoles();
  const { hasPermission } = useAuth();
  const canManage = hasPermission("roles.manage");
  const [dialogRole, setDialogRole] = useState<RoleDto | null | undefined>(undefined);
  const deleteRole = useDeleteRole();

  async function handleDelete(role: RoleDto) {
    try {
      await deleteRole.mutateAsync(role.id);
      toast.success(`Deleted ${role.name}.`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to delete role.");
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Roles</h1>
          <p className="text-sm text-muted-foreground">Built-in roles plus any custom roles you create.</p>
        </div>
        {canManage && (
          <Button onClick={() => setDialogRole(null)}>
            <PlusCircle /> Create Role
          </Button>
        )}
      </div>

      {isLoading && <Skeleton className="h-64 w-full" />}

      {!isLoading && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data?.roles.map((role) => (
            <Card key={role.id}>
              <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="flex items-center gap-1.5 text-sm">
                  <ShieldCheck className="h-4 w-4 text-primary" /> {role.name}
                </CardTitle>
                {!role.isSystem && canManage && (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive">
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete {role.name}?</AlertDialogTitle>
                        <AlertDialogDescription>
                          {role.userCount > 0
                            ? `${role.userCount} user(s) currently have this role and will lose its permissions.`
                            : "This role isn't assigned to anyone."}
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction variant="destructive" onClick={() => handleDelete(role)}>
                          Delete
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}
              </CardHeader>
              <CardContent className="space-y-2">
                <p className="text-xs text-muted-foreground">
                  {role.userCount} user{role.userCount === 1 ? "" : "s"} · {role.permissions.length} permissions
                </p>
                {role.isSystem && <Badge variant="secondary">Built-in</Badge>}
                <Button variant="outline" size="sm" className="w-full" onClick={() => setDialogRole(role)}>
                  {role.isSystem ? "View permissions" : "Edit"}
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {dialogRole !== undefined && (
        <RoleFormDialog open={dialogRole !== undefined} onOpenChange={(v) => !v && setDialogRole(undefined)} role={dialogRole} />
      )}
    </div>
  );
}
