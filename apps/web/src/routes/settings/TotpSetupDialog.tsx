import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Check, Copy } from "lucide-react";
import { enableTotpSchema, type EnableTotpInput } from "@latticore/shared";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useEnableTotp, useSetupTotp } from "@/lib/totp";
import { ApiError } from "@/lib/api";

export function TotpSetupDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const setup = useSetupTotp();
  const enable = useEnableTotp();
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [copied, setCopied] = useState(false);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<EnableTotpInput>({ resolver: zodResolver(enableTotpSchema) });

  useEffect(() => {
    if (open) {
      setup.mutate();
      setRecoveryCodes(null);
      setCopied(false);
      reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function onSubmit(data: EnableTotpInput) {
    try {
      const result = await enable.mutateAsync(data);
      setRecoveryCodes(result.recoveryCodes);
      toast.success("Two-factor authentication is now enabled.");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Invalid code — please try again.");
    }
  }

  function copyRecoveryCodes() {
    if (!recoveryCodes) return;
    navigator.clipboard.writeText(recoveryCodes.join("\n"));
    setCopied(true);
  }

  function handleClose() {
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="max-w-md">
        {!recoveryCodes && (
          <>
            <DialogHeader>
              <DialogTitle>Set up two-factor authentication</DialogTitle>
              <DialogDescription>
                Scan the QR code with an authenticator app (Google Authenticator, Aegis, 1Password, ...), then enter the 6-digit
                code it shows.
              </DialogDescription>
            </DialogHeader>

            {setup.isPending && <Skeleton className="mx-auto h-48 w-48" />}

            {setup.data && (
              <div className="space-y-4">
                <div className="flex justify-center">
                  <img
                    src={setup.data.qrCodeDataUrl}
                    alt="Two-factor authentication QR code"
                    className="h-48 w-48 rounded-md border border-border bg-white p-2"
                  />
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Can&apos;t scan? Enter this code manually:</p>
                  <p className="select-all rounded-md border border-border bg-muted px-3 py-2 font-mono text-xs">
                    {setup.data.secret}
                  </p>
                </div>

                <form className="space-y-4" onSubmit={handleSubmit(onSubmit)} noValidate>
                  <FormField label="6-digit code" htmlFor="code" error={errors.code}>
                    <Input id="code" inputMode="numeric" autoComplete="one-time-code" autoFocus maxLength={6} {...register("code")} />
                  </FormField>
                  <DialogFooter>
                    <Button type="button" variant="outline" onClick={handleClose}>
                      Cancel
                    </Button>
                    <Button type="submit" disabled={isSubmitting}>
                      {isSubmitting ? "Verifying..." : "Enable"}
                    </Button>
                  </DialogFooter>
                </form>
              </div>
            )}

            {setup.isError && (
              <p className="text-sm text-destructive">Could not start setup. Close this dialog and try again.</p>
            )}
          </>
        )}

        {recoveryCodes && (
          <>
            <DialogHeader>
              <DialogTitle>Save your recovery codes</DialogTitle>
              <DialogDescription>
                Each code can be used once to sign in if you lose access to your authenticator app. Store them somewhere safe —
                they won&apos;t be shown again.
              </DialogDescription>
            </DialogHeader>

            <div className="grid grid-cols-2 gap-2 rounded-md border border-border bg-muted p-3 font-mono text-sm">
              {recoveryCodes.map((code) => (
                <span key={code}>{code}</span>
              ))}
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={copyRecoveryCodes}>
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? "Copied" : "Copy codes"}
              </Button>
              <Button type="button" onClick={handleClose}>
                I&apos;ve saved these — done
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
