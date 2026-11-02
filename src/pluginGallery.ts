/** The gallery: plugins that come with the app, ready to add — each a real
 * plugin (src/gallery/<name>/), copied into the plugins folder when added,
 * so it can be read, changed or taken apart like any other. */
const files = import.meta.glob("./gallery/*/*", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

export interface GalleryPlugin {
  folder: string;
  name: string;
  description: string;
  /** what it adds, in a few words: "a tile", "```chem cells"… */
  kind: string;
  files: [string, string][];
}

const KIND: Record<string, string> = {
  "focus-timer": "Tile",
  chemistry: "Cell",
  matrix: "Cell",
  tables: "Cell",
  julia: "Language",
  "r-lang": "Language",
};

export const GALLERY: GalleryPlugin[] = Object.entries(
  Object.entries(files).reduce<Record<string, [string, string][]>>((by, [path, text]) => {
    const [, folder, file] = path.match(/^\.\/gallery\/([^/]+)\/(.+)$/)!;
    (by[folder] ??= []).push([file, text]);
    return by;
  }, {}),
).map(([folder, list]) => {
  const manifest = JSON.parse(list.find(([f]) => f === "plugin.json")?.[1] ?? "{}");
  return { folder, name: manifest.displayName ?? folder, description: manifest.description ?? "", kind: KIND[folder] ?? "Plugin", files: list };
});
