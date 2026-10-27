import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { ChevronLeft, Trash2 } from "lucide-react";
import type { AccessLevel } from "@latticore/shared";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
import { useUser, useUserAccess, useUpdateUser, useDeleteUser, useSetServerAccess } from "@/lib/users";
import { useRoles } from "@/lib/roles";
import { useAuth } from "@/lib/auth";
import { ApiError } from "@/lib/api";

export default function UserEditPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user: currentUser, hasPermission } = useAuth();
  const { data, isLoading } = useUser(id);
  const { data: rolesData } = useRoles();
  const { data: accessData } = useUserAccess(id);
  const updateUser = useUpdateUser(id!);
  const deleteUser = useDeleteUser();
  const setAccess = useSetServerAccess(id!);

  const canEdit = hasPermission("users.edit");
  const canDelete = hasPermission("users.delete") && id !== currentUser?.id;

  if (isLoading || !data) {
    return <Skeleton className="h-96 w-full" />;
  }

  const user = data.user;
  const roleIds = user.roles.map((r) => r.id);

  async function toggleRole(roleId: string, checked: boolean) {
    try {
      await updateUser.mutateAsync({ roleIds: checked ? [...roleIds, roleId] : roleIds.filter((r) => r !== roleId) });
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to update roles.");
    }
  }

  async function toggleDisabled(checked: boolean) {
    try {
      await updateUser.mutateAsync({ isDisabled: checked });
      toast.success(checked ? "User disabled." : "User enabled.");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to update user.");
    }
  }

  async function handleAccessChange(serverId: string, level: AccessLevel | "NONE") {
    try {
      await setAccess.mutateAsync({ serverId, level: level === "NONE" ? null : level });
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to update access.");
    }
  }

  async function handleDelete() {
    if (!id) return;
    try {
      await deleteUser.mutateAsync(id);
      toast.success("User deleted.");
      navigate("/admin/users");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to delete user.");
    }
  }

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" className="-ml-2" onClick={() => navigate("/admin/users")}>
        <ChevronLeft className="h-4 w-4" /> Users
      </Button>

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{user.username}</h1>
          <p className="text-sm text-muted-foreground">{user.email}</p>
        </div>
        {canDelete && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" className="text-destructive hover:text-destructive">
                <Trash2 className="h-4 w-4" /> Delete
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete {user.username}?</AlertDialogTitle>
                <AlertDialogDescription>This permanently removes their account and all server access grants.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction variant="destructive" onClick={handleDelete}>
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Account</CardTitle>
        </CardHeader>
        <CardContent>
          <label className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Account disabled</p>
              <p className="text-xs text-muted-foreground">Disabled accounts cannot sign in.</p>
            </div>
            <Switch checked={user.isDisabled} onCheckedChange={toggleDisabled} disabled={!canEdit || user.id === currentUser?.id} />
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Roles</CardTitle>
          <CardDescription>Roles determine what this user can do across the whole panel.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-1.5">
          {rolesData?.roles.map((role) => (
            <label key={role.id} className="flex items-center gap-2 text-sm">
              <Checkbox checked={roleIds.includes(role.id)} onCheckedChange={(v) => toggleRole(role.id, Boolean(v))} disabled={!canEdit} />
              {role.name}
              {role.isSystem && <span className="text-xs text-muted-foreground">(built-in)</span>}
            </label>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Server access</CardTitle>
          <CardDescription>Fine-grained access per server — a user needs both a role permission and server access to act on a server.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {accessData?.allServers.map((server) => {
            const grant = accessData.access.find((a) => a.serverId === server.id);
            return (
              <div key={server.id} className="flex items-center justify-between py-1 text-sm">
                <span>{server.name}</span>
                <Select value={grant?.level ?? "NONE"} onValueChange={(v) => handleAccessChange(server.id, v as AccessLevel | "NONE")} disabled={!canEdit}>
                  <SelectTrigger className="w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NONE">No access</SelectItem>
                    <SelectItem value="VIEW_ONLY">View only</SelectItem>
                    <SelectItem value="FULL">Full access</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            );
          })}
          {(accessData?.allServers.length ?? 0) === 0 && <p className="text-sm text-muted-foreground">No servers exist yet.</p>}
        </CardContent>
      </Card>
    </div>
  );
}
