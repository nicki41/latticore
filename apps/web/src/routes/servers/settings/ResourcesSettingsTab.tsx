import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { updateServerSettingsSchema, type ServerDto, type UpdateServerSettingsInput } from "@latticore/shared";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { RestartConfirmDialog } from "./RestartConfirmDialog";
import { useRestartAwareSettings } from "./useRestartAwareSettings";

type ResourcesInput = Pick<UpdateServerSettingsInput, "memoryMb" | "cpuCores" | "diskLimitMb">;

const resourcesSchema = updateServerSettingsSchema.pick({ memoryMb: true, cpuCores: true, diskLimitMb: true });

export function ResourcesSettingsTab({ server, canEdit }: { server: ServerDto; canEdit: boolean }) {
  const { requestSave, pendingSave, confirmRestartNow, confirmSaveLater, cancelPendingSave, saving } = useRestartAwareSettings(
    server.id,
    server.status,
  );

  const {
    register,
    handleSubmit,
    formState: { errors, isDirty, dirtyFields },
  } = useForm<ResourcesInput>({
    resolver: zodResolver(resourcesSchema),
    defaultValues: {
      memoryMb: server.memoryMb,
      cpuCores: server.cpuCores,
      diskLimitMb: server.diskLimitMb ?? undefined,
    },
  });

  const onSubmit = (data: ResourcesInput) => {
    requestSave(data, Object.keys(dirtyFields));
  };

  return (
    <>
      <form onSubmit={handleSubmit(onSubmit)}>
        <Card>
          <CardHeader>
            <CardTitle>Resources</CardTitle>
            <CardDescription>Changes apply the next time the server (re)starts.</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <FormField label="RAM (MB)" htmlFor="memoryMb" error={errors.memoryMb}>
              <Input id="memoryMb" type="number" step={512} disabled={!canEdit} {...register("memoryMb")} />
            </FormField>
            <FormField label="CPU cores" htmlFor="cpuCores" error={errors.cpuCores}>
              <Input id="cpuCores" type="number" step={0.5} disabled={!canEdit} {...register("cpuCores")} />
            </FormField>
            <FormField label="Disk limit (MB)" htmlFor="diskLimitMb" error={errors.diskLimitMb}>
              <Input id="diskLimitMb" type="number" step={1024} disabled={!canEdit} {...register("diskLimitMb")} />
            </FormField>
          </CardContent>
          {canEdit && (
            <CardFooter>
              <Button type="submit" disabled={!isDirty || saving}>
                {saving ? "Saving..." : "Save Resources"}
              </Button>
            </CardFooter>
          )}
        </Card>
      </form>

      <RestartConfirmDialog
        open={pendingSave !== null}
        saving={saving}
        onRestartNow={confirmRestartNow}
        onSaveLater={confirmSaveLater}
        onCancel={cancelPendingSave}
      />
    </>
  );
}
