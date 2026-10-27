import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { setupAdminSchema, type SetupAdminInput } from "@latticore/shared";
import { AuthShell } from "@/components/layout/AuthShell";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";

export default function SetupPage() {
  const navigate = useNavigate();
  const { refetch } = useAuth();
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<SetupAdminInput>({ resolver: zodResolver(setupAdminSchema) });

  const onSubmit = async (data: SetupAdminInput) => {
    try {
      await api.post("/auth/setup", data);
      refetch();
      navigate("/", { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.code === "CONFLICT") {
        setError("username", { message: err.message });
        toast.error(err.message);
      } else if (err instanceof ApiError) {
        toast.error(err.message);
      } else {
        toast.error("Something went wrong. Please try again.");
      }
    }
  };

  return (
    <AuthShell title="Welcome" description="Create your administrator account to get started.">
      <form className="space-y-4" onSubmit={handleSubmit(onSubmit)} noValidate>
        <FormField label="Username" htmlFor="username" error={errors.username}>
          <Input id="username" autoComplete="username" autoFocus {...register("username")} />
        </FormField>
        <FormField label="Email" htmlFor="email" error={errors.email}>
          <Input id="email" type="email" autoComplete="email" {...register("email")} />
        </FormField>
        <FormField
          label="Password"
          htmlFor="password"
          error={errors.password}
          hint="At least 10 characters, with uppercase, lowercase and a number."
        >
          <Input id="password" type="password" autoComplete="new-password" {...register("password")} />
        </FormField>
        <FormField label="Confirm password" htmlFor="confirmPassword" error={errors.confirmPassword}>
          <Input id="confirmPassword" type="password" autoComplete="new-password" {...register("confirmPassword")} />
        </FormField>

        <Button type="submit" className="w-full" disabled={isSubmitting}>
          {isSubmitting ? "Creating account..." : "Create Administrator"}
        </Button>
      </form>
    </AuthShell>
  );
}
