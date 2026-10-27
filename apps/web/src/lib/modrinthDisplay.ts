import type { ModrinthSearchHit } from "@latticore/shared";

/** Loaders that make a result a "Plugin" in our terminology (Bukkit-family servers). */
export const PLUGIN_LOADERS = ["paper", "spigot", "bukkit", "purpur", "folia"];
/** Loaders that make a result a "Mod". */
export const MOD_LOADERS = ["fabric", "forge", "neoforge", "quilt"];

export const LOADER_OPTIONS = [
  { group: "Plugin loaders", loaders: [
    { value: "paper", label: "Paper" },
    { value: "spigot", label: "Spigot" },
    { value: "bukkit", label: "Bukkit" },
    { value: "purpur", label: "Purpur" },
  ] },
  { group: "Mod loaders", loaders: [
    { value: "fabric", label: "Fabric" },
    { value: "forge", label: "Forge" },
    { value: "neoforge", label: "NeoForge" },
    { value: "quilt", label: "Quilt" },
  ] },
] as const;

/**
 * The four things this page ever shows — resource packs and shaders are
 * excluded entirely, not just deprioritized.
 *
 * Modrinth's search *facets* now support project_type:plugin as a genuine,
 * accurately-indexed filter distinct from project_type:mod (verified live
 * against api.modrinth.com — GET /tag/project_type returns
 * ["mod","modpack","resourcepack","shader","plugin","datapack",
 * "minecraft_java_server"]). An earlier version of this file predated that
 * and approximated "Plugin" by OR-ing plugin-family loader categories on
 * top of project_type:mod instead — that under-counted badly (a query for
 * "Plugin" returned ~98 results instead of the real ~16,700) because most
 * plugins on Modrinth aren't also tagged with a matching loader category.
 * Use the real facet directly; it's both simpler and correct.
 */
export const TYPE_FILTER_OPTIONS = [
  { value: "all", label: "All types" },
  { value: "mod", label: "Mod" },
  { value: "plugin", label: "Plugin" },
  { value: "modpack", label: "Modpack" },
] as const;
export type TypeFilterValue = (typeof TYPE_FILTER_OPTIONS)[number]["value"];

const BROWSABLE_PROJECT_TYPES = ["mod", "plugin", "modpack"];

/**
 * Translates the UI's Type + Loader selections into the projectTypes/loaders
 * facet arrays the search API expects — independent AND'd facets, so a
 * specific Loader selection just narrows within whichever Type is picked.
 */
export function resolveTypeFilter(type: TypeFilterValue, loader: string): { projectTypes: string[]; loaders: string[] } {
  const projectTypes = type === "all" ? BROWSABLE_PROJECT_TYPES : [type];
  return { projectTypes, loaders: loader === "all" ? [] : [loader] };
}

/**
 * Modrinth's hit.project_type field itself still always reports "mod" for
 * both real mods and real plugins (a legacy quirk — only the search facet
 * knows the real distinction, see the note above), so the per-card badge
 * still has to derive plugin-vs-mod from loader categories. A project
 * genuinely published for both platform families (e.g. LuckPerms, which
 * ships Bukkit *and* Fabric/Forge builds) correctly shows both.
 */
export function modrinthTypeLabel(hit: ModrinthSearchHit): string {
  if (hit.project_type !== "mod") return hit.project_type === "modpack" ? "Modpack" : hit.project_type;
  const isPlugin = hit.categories.some((c) => PLUGIN_LOADERS.includes(c));
  const isMod = hit.categories.some((c) => MOD_LOADERS.includes(c));
  if (isPlugin && isMod) return "Plugin/Mod";
  if (isPlugin) return "Plugin";
  return "Mod";
}
