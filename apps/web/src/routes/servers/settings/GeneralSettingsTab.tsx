import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { isProxySoftware, updateServerSettingsSchema, type ServerDto, type UpdateServerSettingsInput } from "@latticore/shared";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useUpdateServerSettings, useServerAction } from "@/lib/servers";
import { useServerConfigFile, useUpdateServerConfigFile } from "@/lib/serverConfig";
import { ApiError } from "@/lib/api";
import { ServerIconEditor } from "./ServerIconEditor";
import { MotdEditor } from "./MotdEditor";
import { RestartConfirmDialog } from "./RestartConfirmDialog";

type GeneralInput = Pick<UpdateServerSettingsInput, "name" | "description">;
const generalSchema = updateServerSettingsSchema.pick({ name: true, description: true });

function ServerListCard({ server, canEdit }: { server: ServerDto; canEdit: boolean }) {
  const query = useServerConfigFile(server.id, "server-properties");
  const update = useUpdateServerConfigFile(server.id, "server-properties");
  const restart = useServerAction(server.id, "restart");

  const [motd, setMotd] = useState("");
  const [maxPlayers, setMaxPlayers] = useState("");
  const [touched, setTouched] = useState<Set<"motd" | "max-players">>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    if (query.data) {
      setMotd(typeof query.data.values.motd === "string" ? query.data.values.motd : "");
      setMaxPlayers(query.data.values["max-players"] != null ? String(query.data.values["max-players"]) : "");
      setTouched(new Set());
    }
  }, [query.data]);

  function changeMotd(v: string) {
    setMotd(v);
    setTouched((t) => new Set(t).add("motd"));
  }

  function changeMaxPlayers(v: string) {
    setMaxPlayers(v);
    setTouched((t) => new Set(t).add("max-players"));
  }

  async function doSave(): Promise<boolean> {
    const payload: Record<string, string | number> = {};
    if (touched.has("motd")) payload.motd = motd;
    if (touched.has("max-players") && maxPlayers !== "") payload["max-players"] = Number(maxPlayers);
    try {
      await update.mutateAsync(payload);
      toast.success("Server list settings saved.");
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
          <CardTitle>Server list</CardTitle>
          <CardDescription>How this server appears to players before they join — icon, MOTD and player slots.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {query.isLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : (
            <>
              <ServerIconEditor serverId={server.id} canEdit={canEdit} />
              <MotdEditor value={motd} onChange={changeMotd} disabled={!canEdit} />
              <FormField label="Max players (slots)" htmlFor="max-players" hint="Maximum number of players who can be connected at once.">
                <Input
                  id="max-players"
                  type="number"
                  min={1}
                  max={100000}
                  step={1}
                  value={maxPlayers}
                  onChange={(e) => changeMaxPlayers(e.target.value)}
                  disabled={!canEdit}
                />
              </FormField>
            </>
          )}
        </CardContent>
        {canEdit && (
          <CardFooter>
            <Button onClick={handleSaveClick} disabled={touched.size === 0 || saving}>
              {saving ? "Saving..." : "Save Changes"}
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

export function GeneralSettingsTab({ server, canEdit }: { server: ServerDto; canEdit: boolean }) {
  const update = useUpdateServerSettings(server.id);
  const {
    register,
    handleSubmit,
    formState: { errors, isDirty },
  } = useForm<GeneralInput>({
    resolver: zodResolver(generalSchema),
    defaultValues: { name: server.name, description: server.description ?? "" },
  });

  const onSubmit = async (data: GeneralInput) => {
    try {
      await update.mutateAsync(data);
      toast.success("Settings saved.");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to save settings.");
    }
  };

  return (
    <div className="space-y-6">
      <form onSubmit={handleSubmit(onSubmit)}>
        <Card>
          <CardHeader>
            <CardTitle>General</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField label="Server name" htmlFor="name" error={errors.name}>
              <Input id="name" disabled={!canEdit} {...register("name")} />
            </FormField>
            <FormField label="Description (optional)" htmlFor="description" error={errors.description} className="sm:col-span-2">
              <Textarea id="description" rows={2} disabled={!canEdit} {...register("description")} />
            </FormField>
          </CardContent>
          {canEdit && (
            <CardFooter>
              <Button type="submit" disabled={!isDirty || update.isPending}>
                {update.isPending ? "Saving..." : "Save Changes"}
              </Button>
            </CardFooter>
          )}
        </Card>
      </form>

      {/* Proxies keep MOTD and slots in velocity.toml / config.yml, not server.properties — edit those in Files. */}
      {!isProxySoftware(server.software) && <ServerListCard server={server} canEdit={canEdit} />}
    </div>
  );
}
