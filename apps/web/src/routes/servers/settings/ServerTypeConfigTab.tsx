import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Info } from "lucide-react";
import type { ConfigFieldDef, ServerConfigFileDef, ServerDto } from "@minecraftpanel/shared";
import { getServerConfigSchema } from "@minecraftpanel/shared";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useServerAction } from "@/lib/servers";
import { useServerConfigFile, useUpdateServerConfigFile } from "@/lib/serverConfig";
import { ApiError } from "@/lib/api";
import { RestartConfirmDialog } from "./RestartConfirmDialog";

type ConfigValue = string | number | boolean | null;

function ConfigFieldRow({
  field,
  value,
  onChange,
  disabled,
}: {
  field: ConfigFieldDef;
  value: ConfigValue;
  onChange: (v: ConfigValue) => void;
  disabled: boolean;
}) {
  if (field.type === "boolean") {
    return (
      <div className="flex items-center justify-between gap-4 py-1.5">
        <div>
          <Label>{field.label}</Label>
          {field.description && <p className="text-xs text-muted-foreground">{field.description}</p>}
        </div>
        <Switch checked={Boolean(value)} onCheckedChange={onChange} disabled={disabled} />
      </div>
    );
  }

  return (
    <FormField label={field.label} htmlFor={field.key} hint={field.description}>
      {field.type === "enum" && (
        <Select value={value != null ? String(value) : undefined} onValueChange={onChange} disabled={disabled}>
          <SelectTrigger id={field.key}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {field.options?.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {field.type === "number" && (
        <Input
          id={field.key}
          type="number"
          min={field.min}
          max={field.max}
          step={field.step ?? 1}
          value={value === null ? "" : String(value)}
          onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
          disabled={disabled}
        />
      )}
      {field.type === "string" && (
        <Input
          id={field.key}
          value={value === null ? "" : String(value)}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
        />
      )}
    </FormField>
  );
}

export function ConfigFileCard({
  server,
  fileDef,
  canEdit,
  excludeKeys,
}: {
  server: ServerDto;
  fileDef: ServerConfigFileDef;
  canEdit: boolean;
  /** Field keys to omit from this card's rendering (e.g. moved to a dedicated editor elsewhere) — the underlying file/schema is untouched, so the API can still read/write them. */
  excludeKeys?: string[];
}) {
  const excluded = excludeKeys ? new Set(excludeKeys) : null;
  const query = useServerConfigFile(server.id, fileDef.id);
  const update = useUpdateServerConfigFile(server.id, fileDef.id);
  const restart = useServerAction(server.id, "restart");

  const [values, setValues] = useState<Record<string, ConfigValue>>({});
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    if (query.data) {
      setValues(query.data.values);
      setTouched(new Set());
    }
    // Only re-sync when a fresh server response arrives, not on every local edit.
     
  }, [query.data]);

  function setField(key: string, value: ConfigValue) {
    setValues((v) => ({ ...v, [key]: value }));
    setTouched((t) => new Set(t).add(key));
  }

  async function doSave(): Promise<boolean> {
    const payload: Record<string, string | number | boolean> = {};
    for (const key of touched) {
      const v = values[key];
      if (v != null) payload[key] = v;
    }
    try {
      await update.mutateAsync(payload);
      toast.success(`${fileDef.label} saved.`);
      setTouched(new Set());
      return true;
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to save.");
      return false;
    }
  }

  function handleSaveClick() {
    if (touched.size === 0) return;
    if (server.status === "RUNNING") {
      setConfirmOpen(true);
      return;
    }
    void doSave();
  }

  async function handleRestartNow() {
    setConfirmOpen(false);
    const saved = await doSave();
    if (!saved) return;
    try {
      await restart.mutateAsync();
      toast.success("Restarting server...");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to restart server.");
    }
  }

  async function handleSaveLater() {
    setConfirmOpen(false);
    await doSave();
  }

  const saving = update.isPending || restart.isPending;

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>{fileDef.label}</CardTitle>
          {fileDef.description && <CardDescription>{fileDef.description}</CardDescription>}
        </CardHeader>
        <CardContent className="space-y-5">
          {query.isLoading && <Skeleton className="h-40 w-full" />}

          {!query.isLoading && query.data && !query.data.exists && (
            <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
              <Info className="mt-0.5 h-4 w-4 shrink-0" />
              <p>
                <code className="font-mono">{fileDef.relativePath}</code> doesn&apos;t exist yet. You can still set values below —
                they&apos;ll be written to a new file the next time it&apos;s generated (on first server start).
              </p>
            </div>
          )}

          {!query.isLoading &&
            query.data &&
            fileDef.sections.map((section) => {
              const fields = excluded ? section.fields.filter((f) => !excluded.has(f.key)) : section.fields;
              if (fields.length === 0) return null;
              return (
                <div key={section.id} className="space-y-1">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{section.label}</h3>
                  <div className="divide-y divide-border/60">
                    {fields.map((field) => (
                      <ConfigFieldRow
                        key={field.key}
                        field={field}
                        value={values[field.key] ?? null}
                        onChange={(v) => setField(field.key, v)}
                        disabled={!canEdit}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
        </CardContent>
        {canEdit && (
          <CardFooter>
            <Button onClick={handleSaveClick} disabled={touched.size === 0 || saving}>
              {saving ? "Saving..." : `Save ${fileDef.label}`}
            </Button>
          </CardFooter>
        )}
      </Card>

      <RestartConfirmDialog
        open={confirmOpen}
        saving={saving}
        onRestartNow={handleRestartNow}
        onSaveLater={handleSaveLater}
        onCancel={() => setConfirmOpen(false)}
      />
    </>
  );
}

/** Renders nothing when the server's software has no registered extra config schema (e.g. Paper) — callers should check getServerConfigSchema() before showing this tab at all. */
export function ServerTypeConfigTab({ server, canEdit }: { server: ServerDto; canEdit: boolean }) {
  const schema = getServerConfigSchema(server.software);
  if (!schema) return null;

  return (
    <div className="space-y-6">
      {schema.files.map((file) => (
        <ConfigFileCard key={file.id} server={server} fileDef={file} canEdit={canEdit} />
      ))}
    </div>
  );
}
