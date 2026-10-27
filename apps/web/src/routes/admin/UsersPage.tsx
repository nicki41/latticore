import { useState } from "react";
import { Link } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { PlusCircle, Users as UsersIcon } from "lucide-react";
import { createUserSchema, type CreateUserInput } from "@latticore/shared";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/layout/EmptyState";
import { useUsers, useCreateUser } from "@/lib/users";
import { useRoles } from "@/lib/roles";
import { useAuth } from "@/lib/auth";
import { ApiError } from "@/lib/api";

function CreateUserDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { data: rolesData } = useRoles();
  const createUser = useCreateUser();
  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<CreateUserInput>({ resolver: zodResolver(createUserSchema), defaultValues: { roleIds: [] } });

  const roleIds = watch("roleIds") ?? [];

  function toggleRole(id: string, checked: boolean) {
    setValue("roleIds", checked ? [...roleIds, id] : roleIds.filter((r) => r !== id));
  }

  async function onSubmit(data: CreateUserInput) {
    try {
      await createUser.mutateAsync(data);
      toast.success(`${data.username} created.`);
      reset();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to create user.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create user</DialogTitle>
        </DialogHeader>
        <form className="space-y-4" onSubmit={handleSubmit(onSubmit)} noValidate>
          <FormField label="Username" htmlFor="username" error={errors.username}>
            <Input id="username" autoComplete="off" {...register("username")} />
          </FormField>
          <FormField label="Email" htmlFor="email" error={errors.email}>
            <Input id="email" type="email" {...register("email")} />
          </FormField>
          <FormField label="Password" htmlFor="password" error={errors.password}>
            <Input id="password" type="password" autoComplete="new-password" {...register("password")} />
          </FormField>
          <div className="space-y-1.5">
            <p className="text-sm font-medium">Roles</p>
            <div className="space-y-1.5 rounded-md border border-border p-2.5">
              {rolesData?.roles.map((role) => (
                <label key={role.id} className="flex items-center gap-2 text-sm">
                  <Checkbox checked={roleIds.includes(role.id)} onCheckedChange={(v) => toggleRole(role.id, Boolean(v))} />
                  {role.name}
                </label>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function UsersPage() {
  const { data, isLoading } = useUsers();
  const { hasPermission, user: currentUser } = useAuth();
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Users</h1>
          <p className="text-sm text-muted-foreground">Manage panel accounts and their roles.</p>
        </div>
        {hasPermission("users.create") && (
          <Button onClick={() => setCreateOpen(true)}>
            <PlusCircle /> Create User
          </Button>
        )}
      </div>

      {isLoading && <Skeleton className="h-64 w-full" />}

      {!isLoading && (data?.users.length ?? 0) === 0 && <EmptyState icon={UsersIcon} title="No users" />}

      {!isLoading && (data?.users.length ?? 0) > 0 && (
        <div className="rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Username</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Roles</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {data!.users.map((u) => (
                <TableRow key={u.id}>
                  <TableCell className="font-medium">
                    {u.username}
                    {u.id === currentUser?.id && <span className="ml-1.5 text-xs text-muted-foreground">(you)</span>}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{u.email}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {u.isOwner && <Badge>Owner</Badge>}
                      {u.roles.map((r) => (
                        <Badge key={r.id} variant="secondary">
                          {r.name}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={u.isDisabled ? "destructive" : "outline"}>{u.isDisabled ? "Disabled" : "Active"}</Badge>
                  </TableCell>
                  <TableCell>
                    <Button asChild variant="ghost" size="sm">
                      <Link to={`/admin/users/${u.id}`}>Manage</Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <CreateUserDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}
