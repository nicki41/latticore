import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { Monitor, ShieldCheck } from "lucide-react";
import { changePasswordSchema, disableTotpSchema, type ChangePasswordInput, type DisableTotpInput } from "@latticore/shared";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useDisableTotp } from "@/lib/totp";
import { TotpSetupDialog } from "./TotpSetupDialog";

interface SessionRow {
  id: string;
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: string;
  expiresAt: string;
  isCurrent: boolean;
}

function ChangePasswordCard() {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ChangePasswordInput>({ resolver: zodResolver(changePasswordSchema) });

  const onSubmit = async (data: ChangePasswordInput) => {
    try {
      await api.post("/auth/change-password", data);
      toast.success("Password changed. Other sessions were signed out.");
      reset();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to change password.");
    }
  };

  return (
    <Card id="password">
      <CardHeader>
        <CardTitle>Change password</CardTitle>
        <CardDescription>Changing your password signs you out of every other session.</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="max-w-sm space-y-4" onSubmit={handleSubmit(onSubmit)} noValidate>
          <FormField label="Current password" htmlFor="currentPassword" error={errors.currentPassword}>
            <Input id="currentPassword" type="password" autoComplete="current-password" {...register("currentPassword")} />
          </FormField>
          <FormField label="New password" htmlFor="newPassword" error={errors.newPassword}>
            <Input id="newPassword" type="password" autoComplete="new-password" {...register("newPassword")} />
          </FormField>
          <FormField label="Confirm new password" htmlFor="confirmNewPassword" error={errors.confirmNewPassword}>
            <Input id="confirmNewPassword" type="password" autoComplete="new-password" {...register("confirmNewPassword")} />
          </FormField>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Saving..." : "Update password"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function DisableTotpDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const disableTotp = useDisableTotp();
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<DisableTotpInput>({ resolver: zodResolver(disableTotpSchema) });

  async function onSubmit(data: DisableTotpInput) {
    try {
      await disableTotp.mutateAsync(data.password);
      toast.success("Two-factor authentication disabled.");
      reset();
      onClose();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Incorrect password.");
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          reset();
          onClose();
        }
      }}
    >
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Disable two-factor authentication</DialogTitle>
          <DialogDescription>Confirm your password to turn off 2FA. Your recovery codes will stop working.</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={handleSubmit(onSubmit)} noValidate>
          <FormField label="Password" htmlFor="disable-password" error={errors.password}>
            <Input id="disable-password" type="password" autoComplete="current-password" autoFocus {...register("password")} />
          </FormField>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="destructive" disabled={isSubmitting}>
              {isSubmitting ? "Disabling..." : "Disable 2FA"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function TwoFactorCard() {
  const { user } = useAuth();
  const [setupOpen, setSetupOpen] = useState(false);
  const [disableOpen, setDisableOpen] = useState(false);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Two-factor authentication</CardTitle>
        <CardDescription>Require a code from an authenticator app in addition to your password when signing in.</CardDescription>
      </CardHeader>
      <CardContent className="flex items-center justify-between gap-4">
        <Badge variant={user?.totpEnabled ? "default" : "secondary"}>{user?.totpEnabled ? "Enabled" : "Disabled"}</Badge>
        {user?.totpEnabled ? (
          <Button variant="outline" onClick={() => setDisableOpen(true)}>
            Disable
          </Button>
        ) : (
          <Button onClick={() => setSetupOpen(true)}>Enable 2FA</Button>
        )}
      </CardContent>

      <TotpSetupDialog open={setupOpen} onClose={() => setSetupOpen(false)} />
      <DisableTotpDialog open={disableOpen} onClose={() => setDisableOpen(false)} />
    </Card>
  );
}

function SessionsCard() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["auth", "sessions"],
    queryFn: () => api.get<{ sessions: SessionRow[] }>("/auth/sessions"),
  });

  const revoke = useMutation({
    mutationFn: (id: string) => api.delete(`/auth/sessions/${id}`),
    onSuccess: () => {
      toast.success("Session signed out.");
      queryClient.invalidateQueries({ queryKey: ["auth", "sessions"] });
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Failed to revoke session."),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Active sessions</CardTitle>
        <CardDescription>Devices currently signed in to your account.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-1">
        {isLoading && (
          <div className="space-y-2">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        )}
        {data?.sessions.map((session, i) => (
          <div key={session.id}>
            {i > 0 && <Separator className="my-1" />}
            <div className="flex items-center justify-between gap-3 py-2.5">
              {/*
                min-w-0 at every nested flex level: .truncate alone only sets
                overflow-hidden/ellipsis, it doesn't shrink a flex item below
                its content size (default min-width:auto) — without min-w-0
                threaded all the way down, a long raw User-Agent string blew
                the whole page out to ~1140px wide on a 320px viewport.
              */}
              <div className="flex min-w-0 flex-1 items-start gap-3">
                <Monitor className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 space-y-0.5">
                  <div className="flex min-w-0 items-center gap-2 text-sm">
                    <span className="min-w-0 truncate">{session.userAgent || "Unknown device"}</span>
                    {session.isCurrent && (
                      <Badge variant="secondary" className="gap-1">
                        <ShieldCheck className="h-3 w-3" /> This device
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {session.ipAddress ?? "Unknown IP"} · active{" "}
                    {formatDistanceToNow(new Date(session.createdAt), { addSuffix: true })}
                  </p>
                </div>
              </div>
              {!session.isCurrent && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => revoke.mutate(session.id)}
                  disabled={revoke.isPending}
                >
                  Sign out
                </Button>
              )}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export default function AccountSettingsPage() {
  const { user } = useAuth();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Account</h1>
        <p className="text-sm text-muted-foreground">Manage your profile, password and active sessions.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
        </CardHeader>
        <CardContent className="grid max-w-sm gap-3 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Username</span>
            <span className="font-medium">{user?.username}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Email</span>
            <span className="font-medium">{user?.email}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Roles</span>
            <span className="font-medium">{user?.roles.map((r) => r.name).join(", ") || "—"}</span>
          </div>
        </CardContent>
      </Card>

      <ChangePasswordCard />
      <TwoFactorCard />
      <SessionsCard />
    </div>
  );
}
