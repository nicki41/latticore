import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { createServerSchema, type CreateServerInput } from "@latticore/shared";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api";
import { useCreateServer } from "@/lib/servers";
import { WizardProgress } from "./wizard/WizardProgress";
import { StepBasics, StepSoftware, StepVersion, StepResources, StepPort, StepConfirm } from "./wizard/Steps";

const STEPS = ["Name", "Software", "Version", "Resources", "Port", "Confirm"] as const;

const STEP_FIELDS: (keyof CreateServerInput)[][] = [
  ["name", "description"],
  ["software"],
  ["mcVersion"],
  ["memoryMb", "cpuCores", "diskLimitMb"],
  ["port"],
  [],
];

export default function CreateServerPage() {
  const [step, setStep] = useState(0);
  const navigate = useNavigate();
  const createServer = useCreateServer();

  const form = useForm<CreateServerInput>({
    resolver: zodResolver(createServerSchema),
    defaultValues: { software: "PAPER", memoryMb: 4096, cpuCores: 2, diskLimitMb: 20480, eulaAccepted: false },
    mode: "onChange",
  });

  async function goNext() {
    const valid = await form.trigger(STEP_FIELDS[step]);
    if (valid) setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }

  function goBack() {
    setStep((s) => Math.max(s - 1, 0));
  }

  async function onSubmit(data: CreateServerInput) {
    try {
      const res = await createServer.mutateAsync(data);
      toast.success(`${data.name} is being created — this can take a few minutes.`);
      navigate(`/servers/${res.server.id}`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to create server.");
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Create Server</h1>
        <p className="text-sm text-muted-foreground">
          Step {step + 1} of {STEPS.length}: {STEPS[step]}
        </p>
      </div>

      <WizardProgress steps={STEPS} current={step} />

      <Card>
        <CardContent className="pt-6">
          <form
            onSubmit={(e) => {
              if (step !== STEPS.length - 1) e.preventDefault();
              else void form.handleSubmit(onSubmit)(e);
            }}
          >
            {step === 0 && <StepBasics form={form} />}
            {step === 1 && <StepSoftware form={form} />}
            {step === 2 && <StepVersion form={form} />}
            {step === 3 && <StepResources form={form} />}
            {step === 4 && <StepPort form={form} />}
            {step === 5 && <StepConfirm form={form} />}

            <div className="mt-6 flex justify-between">
              <Button type="button" variant="outline" onClick={goBack} disabled={step === 0}>
                Back
              </Button>
              {step < STEPS.length - 1 ? (
                // key differentiates this from the "Create Server" submit button below so
                // React always mounts a fresh DOM node instead of mutating this one in place
                // (same position in the tree either way) — otherwise, on the click that
                // advances to the final step, React can rewrite this very button's type from
                // "button" to "submit" synchronously *during* the click's own event handling,
                // and the browser's native default-action check (which runs after listeners)
                // sees the new type and submits the form the same click produced.
                <Button key="next" type="button" onClick={goNext}>
                  Next
                </Button>
              ) : (
                <Button key="create" type="submit" disabled={createServer.isPending}>
                  {createServer.isPending ? "Creating..." : "Create Server"}
                </Button>
              )}
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
