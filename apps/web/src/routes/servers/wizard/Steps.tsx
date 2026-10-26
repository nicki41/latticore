import { useState } from "react";
import { Controller, type UseFormReturn } from "react-hook-form";
import { Check, ExternalLink } from "lucide-react";
import { isProxySoftware, type CreateServerInput, type ServerSoftware } from "@minecraftpanel/shared";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { formatMb } from "@/lib/format";
import { GAME_SOFTWARE_ORDER, PROXY_SOFTWARE_ORDER, SOFTWARE_META } from "@/lib/softwareMeta";
import { useServerVersions } from "@/lib/servers";
import { Skeleton } from "@/components/ui/skeleton";

interface StepProps {
  form: UseFormReturn<CreateServerInput>;
}

export function StepBasics({ form }: StepProps) {
  const {
    register,
    formState: { errors },
  } = form;
  return (
    <div className="space-y-4">
      <FormField label="Server name" htmlFor="name" error={errors.name}>
        <Input id="name" placeholder="Survival" autoFocus {...register("name")} />
      </FormField>
      <FormField label="Description (optional)" htmlFor="description" error={errors.description}>
        <Textarea id="description" placeholder="What's this server for?" rows={3} {...register("description")} />
      </FormField>
    </div>
  );
}

/** A proxy needs far less memory than a game server; the wizard's default is sized for the latter. */
const PROXY_DEFAULT_MEMORY_MB = 1024;
const GAME_DEFAULT_MEMORY_MB = 4096;

export function StepSoftware({ form }: StepProps) {
  const { control, getValues, setValue } = form;

  function pick(software: ServerSoftware, onChange: (value: ServerSoftware) => void) {
    onChange(software);
    // Only adjust a memory value the user hasn't changed themselves.
    const memory = Number(getValues("memoryMb"));
    if (isProxySoftware(software) && memory === GAME_DEFAULT_MEMORY_MB) setValue("memoryMb", PROXY_DEFAULT_MEMORY_MB);
    if (!isProxySoftware(software) && memory === PROXY_DEFAULT_MEMORY_MB) setValue("memoryMb", GAME_DEFAULT_MEMORY_MB);
  }

  return (
    <Controller
      control={control}
      name="software"
      render={({ field }) => (
        <div className="space-y-4">
          {[
            { title: "Game server", order: GAME_SOFTWARE_ORDER },
            { title: "Proxy — connects several servers into one network", order: PROXY_SOFTWARE_ORDER },
          ].map((group) => (
        <div key={group.title} className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{group.title}</p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {group.order.map((software) => {
            const meta = SOFTWARE_META[software];
            const selected = field.value === software;
            return (
              <button
                type="button"
                key={software}
                onClick={() => pick(software, field.onChange)}
                className={cn(
                  "flex flex-col items-start gap-1 rounded-lg border p-4 text-left transition-colors",
                  selected ? "border-primary bg-primary/10" : "border-border hover:bg-accent",
                )}
              >
                <div className="flex w-full items-center justify-between">
                  <span className="text-sm font-semibold">{meta.label}</span>
                  {selected && <Check className="h-4 w-4 text-primary" />}
                </div>
                <span className="text-xs text-muted-foreground">{meta.description}</span>
              </button>
            );
          })}
        </div>
        </div>
          ))}
        </div>
      )}
    />
  );
}

export function StepVersion({ form }: StepProps) {
  const { control, watch } = form;
  const software = watch("software") as ServerSoftware | undefined;
  const { data, isLoading, isError } = useServerVersions(software);
  const [showUnstable, setShowUnstable] = useState(false);

  const versions = (data?.versions ?? []).filter((v) => showUnstable || v.stable);

  return (
    <Controller
      control={control}
      name="mcVersion"
      render={({ field, fieldState }) => (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-medium">{software ? SOFTWARE_META[software].versionLabel : "Version"}</Label>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <Switch checked={showUnstable} onCheckedChange={setShowUnstable} />
              Show unstable
            </label>
          </div>

          {isLoading && (
            <div className="space-y-1.5">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
            </div>
          )}
          {isError && <p className="text-sm text-destructive">Failed to load versions. Check the panel's network access.</p>}

          {!isLoading && !isError && (
            <div className="max-h-72 space-y-1 overflow-y-auto rounded-md border border-border p-1.5 scrollbar-thin">
              {versions.length === 0 && <p className="p-3 text-sm text-muted-foreground">No versions available.</p>}
              {versions.map((v) => (
                <button
                  type="button"
                  key={v.id}
                  onClick={() => field.onChange(v.id)}
                  className={cn(
                    "flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm transition-colors",
                    field.value === v.id ? "bg-primary/15 text-primary" : "hover:bg-accent",
                  )}
                >
                  <span>{v.id}</span>
                  {!v.stable && <span className="text-xs text-muted-foreground">unstable</span>}
                </button>
              ))}
            </div>
          )}
          {fieldState.error && <p className="text-xs text-destructive">{fieldState.error.message}</p>}
        </div>
      )}
    />
  );
}

export function StepResources({ form }: StepProps) {
  const {
    register,
    watch,
    formState: { errors },
  } = form;
  const memoryMb = Number(watch("memoryMb")) || 0;
  const diskLimitMb = Number(watch("diskLimitMb")) || 0;

  return (
    <div className="space-y-4">
      <FormField label="RAM (MB)" htmlFor="memoryMb" error={errors.memoryMb} hint={memoryMb ? `≈ ${formatMb(memoryMb)}` : undefined}>
        <Input id="memoryMb" type="number" step={512} min={1024} {...register("memoryMb")} />
      </FormField>
      <FormField label="CPU cores" htmlFor="cpuCores" error={errors.cpuCores} hint="Fractional values like 1.5 are fine.">
        <Input id="cpuCores" type="number" step={0.5} min={0.5} {...register("cpuCores")} />
      </FormField>
      <FormField
        label="Disk limit (MB, optional)"
        htmlFor="diskLimitMb"
        error={errors.diskLimitMb}
        hint={diskLimitMb ? `≈ ${formatMb(diskLimitMb)} — tracked and shown in the UI, not hard-enforced by Docker.` : "Leave blank for no soft limit."}
      >
        <Input id="diskLimitMb" type="number" step={1024} min={512} {...register("diskLimitMb")} />
      </FormField>
    </div>
  );
}

export function StepPort({ form }: StepProps) {
  const { register, watch, setValue, formState } = form;
  const port = watch("port");
  const [customPort, setCustomPort] = useState(Boolean(port));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between rounded-lg border border-border p-4">
        <div>
          <p className="text-sm font-medium">Server port</p>
          <p className="text-xs text-muted-foreground">
            {customPort ? "Choose the port players connect to." : "Automatically assigned from the configured range when created."}
          </p>
        </div>
        <Switch
          checked={customPort}
          onCheckedChange={(checked) => {
            setCustomPort(checked);
            if (!checked) setValue("port", undefined);
          }}
        />
      </div>
      {customPort && (
        <FormField label="Port" htmlFor="port" error={formState.errors.port}>
          <Input id="port" type="number" min={1} max={65535} placeholder="25565" {...register("port")} />
        </FormField>
      )}
    </div>
  );
}

export function StepConfirm({ form }: StepProps) {
  const {
    control,
    formState: { isSubmitted },
  } = form;
  const values = form.watch();
  const meta = SOFTWARE_META[values.software as ServerSoftware];
  const rows: [string, string][] = [
    ["Name", values.name || "—"],
    ["Software", meta?.label ?? "—"],
    [meta?.versionLabel ?? "Version", values.mcVersion || "—"],
    ["RAM", values.memoryMb ? formatMb(Number(values.memoryMb)) : "—"],
    ["CPU cores", values.cpuCores ? String(values.cpuCores) : "—"],
    ["Disk limit", values.diskLimitMb ? formatMb(Number(values.diskLimitMb)) : "No limit"],
    ["Port", values.port ? String(values.port) : "Automatic"],
  ];

  return (
    <div className="space-y-4">
      <div className="space-y-1 rounded-lg border border-border divide-y divide-border">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-center justify-between px-4 py-2.5 text-sm">
            <span className="text-muted-foreground">{label}</span>
            <span className="font-medium">{value}</span>
          </div>
        ))}
      </div>

      <Controller
        control={control}
        name="eulaAccepted"
        render={({ field, fieldState }) => {
          // Deliberately gated on isSubmitted only, not fieldState.isTouched:
          // with the shared zodResolver validating the whole multi-step form
          // on every keystroke elsewhere in the wizard, isTouched here isn't
          // a reliable "the user looked at this field" signal — it would
          // often flip true before they ever reached this step.
          const showError = Boolean(fieldState.error) && isSubmitted;
          return (
          <div className="space-y-1.5">
            <label
              className={cn(
                "flex items-start gap-3 rounded-lg border p-4 text-sm transition-colors",
                showError ? "border-destructive/50 bg-destructive/5" : "border-border",
              )}
            >
              <Checkbox
                checked={field.value === true}
                onCheckedChange={(checked) => {
                  field.onChange(checked === true);
                  field.onBlur();
                }}
                className="mt-0.5"
              />
              <span>
                <span className="font-medium">Ich akzeptiere die Minecraft EULA.</span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  Ohne Zustimmung wird der Server nicht erstellt. Der Minecraft-Server-Prozess startet nur, wenn die EULA
                  explizit akzeptiert wird — sie wird niemals automatisch als akzeptiert gesetzt.{" "}
                  <a
                    href="https://www.minecraft.net/en-us/eula"
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-0.5 text-primary hover:underline"
                    onClick={(e) => e.stopPropagation()}
                  >
                    EULA lesen <ExternalLink className="h-3 w-3" />
                  </a>
                </span>
              </span>
            </label>
            {showError && <p className="text-xs text-destructive">{fieldState.error?.message}</p>}
          </div>
          );
        }}
      />
    </div>
  );
}
