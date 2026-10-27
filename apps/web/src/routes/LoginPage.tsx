import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { loginSchema, verifyTotpLoginSchema, type LoginInput, type VerifyTotpLoginInput } from "@latticore/shared";
import { AuthShell } from "@/components/layout/AuthShell";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";

function TotpStep({ onBack }: { onBack: () => void }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { refetch } = useAuth();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<VerifyTotpLoginInput>({ resolver: zodResolver(verifyTotpLoginSchema) });

  const from = (location.state as { from?: Location })?.from?.pathname || "/";

  const onSubmit = async (data: VerifyTotpLoginInput) => {
    try {
      await api.post("/auth/login/verify-totp", data);
      refetch();
      navigate(from, { replace: true });
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Something went wrong. Please try again.";
      toast.error(message);
    }
  };

  return (
    <form className="space-y-4" onSubmit={handleSubmit(onSubmit)} noValidate>
      <FormField label="Authentication code" htmlFor="code" error={errors.code}>
        <Input
          id="code"
          inputMode="text"
          autoComplete="one-time-code"
          autoFocus
          placeholder="6-digit code or recovery code"
          {...register("code")}
        />
      </FormField>

      <Button type="submit" className="w-full" disabled={isSubmitting}>
        {isSubmitting ? "Verifying..." : "Verify"}
      </Button>
      <Button type="button" variant="ghost" className="w-full" onClick={onBack}>
        Back
      </Button>
    </form>
  );
}

export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { refetch } = useAuth();
  const [stage, setStage] = useState<"password" | "totp">("password");
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({ resolver: zodResolver(loginSchema) });

  const from = (location.state as { from?: Location })?.from?.pathname || "/";

  const onSubmit = async (data: LoginInput) => {
    try {
      const result = await api.post<{ requiresTotp: boolean }>("/auth/login", data);
      if (result.requiresTotp) {
        setStage("totp");
        return;
      }
      refetch();
      navigate(from, { replace: true });
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Something went wrong. Please try again.";
      toast.error(message);
    }
  };

  if (stage === "totp") {
    return (
      <AuthShell title="Two-factor authentication" description="Enter the code from your authenticator app.">
        <TotpStep onBack={() => setStage("password")} />
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Sign in" description="Enter your credentials to access the panel.">
      <form className="space-y-4" onSubmit={handleSubmit(onSubmit)} noValidate>
        <FormField label="Username or email" htmlFor="usernameOrEmail" error={errors.usernameOrEmail}>
          <Input id="usernameOrEmail" autoComplete="username" autoFocus {...register("usernameOrEmail")} />
        </FormField>
        <FormField label="Password" htmlFor="password" error={errors.password}>
          <Input id="password" type="password" autoComplete="current-password" {...register("password")} />
        </FormField>

        <Button type="submit" className="w-full" disabled={isSubmitting}>
          {isSubmitting ? "Signing in..." : "Sign in"}
        </Button>
      </form>
    </AuthShell>
  );
}
