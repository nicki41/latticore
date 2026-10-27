import { useRef, useState } from "react";
import { toast } from "sonner";
import {
  Upload,
  FilePlus,
  FolderPlus,
  Search,
  Download,
  FolderDown,
  Pencil,
  Trash2,
  MoreHorizontal,
  ChevronRight,
  Archive,
  Loader2,
} from "lucide-react";
import type { FileEntryDto } from "@latticore/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState } from "@/components/layout/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import { FileIcon } from "@/components/files/FileIcon";
import { formatBytes } from "@/lib/format";
import { isLikelyEditable } from "@/lib/editorLanguage";
import { ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import {
  useCreateEntry,
  useDeleteEntry,
  useExtractZip,
  useFileList,
  useFileSearch,
  useMoveEntry,
  downloadFileUrl,
  uploadFiles,
} from "@/lib/files";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function joinPath(dir: string, name: string): string {
  return dir ? `${dir}/${name}` : name;
}

interface FileBrowserViewProps {
  serverId: string;
  currentPath: string;
  onNavigate: (path: string) => void;
  onOpenFile: (path: string) => void;
}

export function FileBrowserView({ serverId, currentPath, onNavigate, onOpenFile }: FileBrowserViewProps) {
  const { hasPermission } = useAuth();
  const canCreate = hasPermission("files.create");
  const canEdit = hasPermission("files.edit");
  const canDelete = hasPermission("files.delete");
  const canUpload = hasPermission("files.upload");

  const [search, setSearch] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createType, setCreateType] = useState<"file" | "directory">("file");
  const [createName, setCreateName] = useState("");
  const [renameTarget, setRenameTarget] = useState<FileEntryDto | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<FileEntryDto | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const list = useFileList(serverId, currentPath);
  const searchResults = useFileSearch(serverId, currentPath, search);
  const createEntry = useCreateEntry(serverId);
  const deleteEntry = useDeleteEntry(serverId);
  const moveEntry = useMoveEntry(serverId);
  const extractZip = useExtractZip(serverId);

  const isSearching = search.trim().length > 0;
  const entries = isSearching ? searchResults.data?.entries : list.data?.entries;
  const isLoading = isSearching ? searchResults.isLoading : list.isLoading;

  const breadcrumbs = currentPath ? currentPath.split("/").filter(Boolean) : [];

  async function handleUpload(files: FileList | File[]) {
    if (!files || (Array.isArray(files) ? files.length === 0 : files.length === 0)) return;
    setUploading(true);
    try {
      const result = await uploadFiles(serverId, currentPath, files);
      toast.success(`Uploaded ${result.uploaded} file${result.uploaded === 1 ? "" : "s"}.`);
      list.refetch();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  }

  async function handleCreate() {
    if (!createName.trim()) return;
    try {
      await createEntry.mutateAsync({ path: joinPath(currentPath, createName.trim()), type: createType });
      toast.success(createType === "directory" ? "Folder created." : "File created.");
      setCreateOpen(false);
      setCreateName("");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to create.");
    }
  }

  async function handleRename() {
    if (!renameTarget || !renameValue.trim() || renameValue === renameTarget.name) {
      setRenameTarget(null);
      return;
    }
    const parentDir = renameTarget.path.split("/").slice(0, -1).join("/");
    try {
      await moveEntry.mutateAsync({ from: renameTarget.path, to: joinPath(parentDir, renameValue.trim()) });
      toast.success("Renamed.");
      setRenameTarget(null);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to rename.");
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    try {
      await deleteEntry.mutateAsync(deleteTarget.path);
      toast.success(`Deleted ${deleteTarget.name}.`);
      setDeleteTarget(null);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to delete.");
    }
  }

  async function handleExtract(entry: FileEntryDto) {
    try {
      await extractZip.mutateAsync({ path: entry.path });
      toast.success(`Extracted ${entry.name}.`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to extract.");
    }
  }

  return (
    <div
      className="space-y-4"
      onDragOver={(e) => {
        if (!canUpload) return;
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        if (canUpload) void handleUpload(e.dataTransfer.files);
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-1 text-sm">
          <button className="font-medium hover:underline" onClick={() => onNavigate("")}>
            root
          </button>
          {breadcrumbs.map((segment, i) => (
            <span key={i} className="flex items-center gap-1 text-muted-foreground">
              <ChevronRight className="h-3.5 w-3.5" />
              <button
                className="hover:underline hover:text-foreground"
                onClick={() => onNavigate(breadcrumbs.slice(0, i + 1).join("/"))}
              >
                {segment}
              </button>
            </span>
          ))}
        </div>

        <div className="relative w-48">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search..." className="h-8 pl-7 text-xs" />
        </div>

        {canCreate && (
          <>
            <Button size="sm" variant="outline" onClick={() => { setCreateType("file"); setCreateOpen(true); }}>
              <FilePlus className="h-3.5 w-3.5" /> File
            </Button>
            <Button size="sm" variant="outline" onClick={() => { setCreateType("directory"); setCreateOpen(true); }}>
              <FolderPlus className="h-3.5 w-3.5" /> Folder
            </Button>
          </>
        )}
        {canUpload && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => e.target.files && void handleUpload(e.target.files)}
            />
            <Button size="sm" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
              {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />} Upload
            </Button>
          </>
        )}
        <Button size="sm" variant="outline" asChild>
          <a href={downloadFileUrl(serverId, currentPath)} download>
            <FolderDown className="h-3.5 w-3.5" /> Download as ZIP
          </a>
        </Button>
      </div>

      <div className={`relative rounded-lg border ${dragOver ? "border-primary bg-primary/5" : "border-border"}`}>
        {dragOver && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-primary/10 text-sm font-medium text-primary">
            Drop files to upload
          </div>
        )}

        {isLoading && (
          <div className="space-y-1 p-3">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        )}

        {!isLoading && (entries?.length ?? 0) === 0 && (
          <EmptyState title={isSearching ? "No matches" : "This folder is empty"} className="border-0" />
        )}

        {!isLoading && (entries?.length ?? 0) > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead className="w-28">Size</TableHead>
                <TableHead className="w-44">Modified</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries!.map((entry) => (
                <TableRow key={entry.path}>
                  <TableCell>
                    <button
                      className="flex items-center gap-2 text-left hover:underline"
                      onClick={() => {
                        if (entry.type === "directory") onNavigate(entry.path);
                        else if (isLikelyEditable(entry.name)) onOpenFile(entry.path);
                        else toast.info("This file type can't be opened in the editor. Download it instead.");
                      }}
                    >
                      <FileIcon name={entry.name} type={entry.type} className="h-4 w-4 shrink-0" />
                      <span className="truncate">{entry.name}</span>
                    </button>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{entry.type === "file" ? formatBytes(entry.size) : "—"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{formatDate(entry.modifiedAt)}</TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-7 w-7">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {entry.type === "file" && (
                          <DropdownMenuItem asChild>
                            <a href={downloadFileUrl(serverId, entry.path)} download>
                              <Download /> Download
                            </a>
                          </DropdownMenuItem>
                        )}
                        {entry.type === "directory" && (
                          <DropdownMenuItem asChild>
                            <a href={downloadFileUrl(serverId, entry.path)} download>
                              <FolderDown /> Download as ZIP
                            </a>
                          </DropdownMenuItem>
                        )}
                        {entry.type === "file" && entry.name.endsWith(".zip") && canCreate && (
                          <DropdownMenuItem onClick={() => handleExtract(entry)}>
                            <Archive /> Extract here
                          </DropdownMenuItem>
                        )}
                        {canEdit && (
                          <DropdownMenuItem
                            onClick={() => {
                              setRenameTarget(entry);
                              setRenameValue(entry.name);
                            }}
                          >
                            <Pencil /> Rename
                          </DropdownMenuItem>
                        )}
                        {canDelete && (
                          <DropdownMenuItem destructive onClick={() => setDeleteTarget(entry)}>
                            <Trash2 /> Delete
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{createType === "directory" ? "New folder" : "New file"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="entry-type">Type</Label>
              <Select value={createType} onValueChange={(v) => setCreateType(v as "file" | "directory")}>
                <SelectTrigger id="entry-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="file">File</SelectItem>
                  <SelectItem value="directory">Folder</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="entry-name">Name</Label>
              <Input id="entry-name" value={createName} onChange={(e) => setCreateName(e.target.value)} autoFocus />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={!createName.trim() || createEntry.isPending}>
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(renameTarget)} onOpenChange={(open) => !open && setRenameTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename</DialogTitle>
          </DialogHeader>
          <Input value={renameValue} onChange={(e) => setRenameValue(e.target.value)} autoFocus />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameTarget(null)}>
              Cancel
            </Button>
            <Button onClick={handleRename} disabled={!renameValue.trim() || moveEntry.isPending}>
              Rename
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleteTarget?.type === "directory" ? "folder" : "file"}?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget?.type === "directory"
                ? `"${deleteTarget?.name}" and everything inside it will be permanently deleted.`
                : `"${deleteTarget?.name}" will be permanently deleted.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={handleDelete}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
