/** Extensions: the app's parts and the plugins, each on or off — the way
 * VS Code's Extensions view does it. Tiles (Calculate, Work…, and plugins'
 * own), the languages code cells can be in (and whether what runs them is
 * installed), and every plugin in ~/Documents/MatrixLab/Plugins. */
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import Icon from "../Icon";
import { TILES } from "./CalcDock";
import { languages } from "../notebook/languages";
import { type LoadedPlugin, loadPlugins, pluginSetting, setPluginSetting, usePlugins } from "../plugins";
import { GALLERY } from "../pluginGallery";
import { toggleCell, toggleTile, togglePlugin, useParts } from "../parts";
import { NEW_CELLS } from "../notebook/NotebookTile";

function Switch({ on, onChange, label }: { on: boolean; onChange: () => void; label: string }) {
  return (
    <button className={`ext-switch${on ? " is-on" : ""}`} role="switch" aria-checked={on} aria-label={label} title={on ? `On — turn ${label} off` : `Off — turn ${label} on`} onClick={onChange}>
      <span className="ext-knob" />
    </button>
  );
}

/** a plugin's settings (its plugin.json's contributes.settings), changed as you go */
function PluginSettings({ plugin }: { plugin: LoadedPlugin }) {
  return (
    <div className="ext-settings">
      {(plugin.settings ?? []).map((s) => {
        const value = pluginSetting(plugin, s.key);
        const set = (v: unknown) => setPluginSetting(plugin, s.key, v);
        return (
          <label key={s.key} className="ext-setting">
            <span className="ext-text">
              <span className="ext-name">{s.label}</span>
              {s.description && <span className="ext-dim">{s.description}</span>}
            </span>
            {s.type === "boolean" ? (
              <Switch on={Boolean(value)} onChange={() => set(!value)} label={s.label} />
            ) : s.type === "select" ? (
              <select value={String(value)} onChange={(e) => set(e.target.value)}>
                {(s.options ?? []).map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </select>
            ) : (
              <input
                type={s.type === "number" ? "number" : "text"}
                defaultValue={String(value)}
                spellCheck={false}
                onChange={(e) => set(s.type === "number" ? Number(e.target.value) : e.target.value)}
              />
            )}
          </label>
        );
      })}
    </div>
  );
}

export default function Extensions({ onClose, onNewPlugin }: { onClose: () => void; onNewPlugin: () => void }) {
  const parts = useParts();
  const plugins = usePlugins();
  const langs = languages();
  // which programs the languages need are installed
  const [found, setFound] = useState<Record<string, string | null>>({});
  useEffect(() => {
    const programs = [...new Set(langs.flatMap((l) => (l.run ?? []).map((r) => r.needs)))];
    invoke<Record<string, string | null>>("lang_which", { programs })
      .then(setFound)
      .catch(() => {});
  }, [langs]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);
  const folder = async (sub?: string) => revealItemInDir(`${await invoke<string>("plugins_folder")}${sub ? `/${sub}` : ""}`).catch(() => {});
  const replacedBy = (id: string) => plugins.tiles.find((t) => t.replaces === id && !parts.offTiles.includes(t.id));
  const [settingsOf, setSettingsOf] = useState<string | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  /** a plugin from the gallery, into the plugins folder (and loaded) */
  const addFromGallery = async (g: (typeof GALLERY)[number]) => {
    setAdding(g.folder);
    try {
      await invoke("plugins_create", { folder: g.folder, files: g.files });
      await loadPlugins();
      window.dispatchEvent(new CustomEvent("matrixlab-notice", { detail: `${g.name} added` }));
    } catch (err) {
      window.dispatchEvent(new CustomEvent("matrixlab-notice", { detail: String(err) }));
    }
    setAdding(null);
  };
  const pluginState = (p: LoadedPlugin) => (p.off ? "off" : p.error ? `didn't load: ${p.error}` : p.adds.join(" · ") || "adds nothing yet");

  return (
    <div className="ext-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="ext" role="dialog" aria-label="Extensions">
        <div className="ext-head">
          <span className="ext-title">Extensions</span>
          <span className="ext-sub">The app is only what you want of it — turn parts off, add your own</span>
          <button className="ext-close" title="Close (Esc)" onClick={onClose}>
            <Icon name="close" size={14} />
          </button>
        </div>
        <div className="ext-body">
          <section>
            <h3>Tiles</h3>
            {TILES.map((t) => {
              const swap = replacedBy(t.id);
              return (
                <div key={t.id} className="ext-row">
                  <span className="ext-icon">
                    <Icon name={t.id} size={16} />
                  </span>
                  <span className="ext-text">
                    <span className="ext-name">{t.title}</span>
                    <span className="ext-dim">{swap ? `Replaced by ${swap.title} (${swap.plugin})` : t.blurb}</span>
                  </span>
                  <Switch on={!parts.offTiles.includes(t.id)} onChange={() => toggleTile(t.id)} label={t.title} />
                </div>
              );
            })}
            {plugins.tiles.map((t) => (
              <div key={t.id} className="ext-row">
                <span className="ext-icon">
                  <Icon name="source" size={16} />
                </span>
                <span className="ext-text">
                  <span className="ext-name">{t.title}</span>
                  <span className="ext-dim">{[t.blurb, `from ${t.plugin}`, t.replaces && `in place of ${TILES.find((o) => o.id === t.replaces)?.title ?? t.replaces}`].filter(Boolean).join(" · ")}</span>
                </span>
                <Switch on={!parts.offTiles.includes(t.id)} onChange={() => toggleTile(t.id)} label={t.title} />
              </div>
            ))}
          </section>

          <section>
            <h3>Notebook cells</h3>
            <div className="ext-dim ext-note">Which kinds the notebook offers to add (cells already in a notebook stay)</div>
            {[...NEW_CELLS.map((c) => ({ id: c.lang, label: c.label, icon: c.icon, from: "" })), ...plugins.cells.map((c) => ({ id: c.id, label: c.label, icon: "source", from: c.plugin }))].map((c) => (
              <div key={c.id} className="ext-row">
                <span className="ext-icon">
                  <Icon name={c.icon} size={16} />
                </span>
                <span className="ext-text">
                  <span className="ext-name">{c.label}</span>
                  {c.from && <span className="ext-dim">from {c.from}</span>}
                </span>
                <Switch on={!parts.offCells.includes(c.id)} onChange={() => toggleCell(c.id)} label={`${c.label} cells`} />
              </div>
            ))}
          </section>

          <section>
            <h3>Languages for code cells</h3>
            {langs.map((l) => {
              const way = (l.run ?? []).find((r) => found[r.needs]);
              return (
                <div key={l.id} className="ext-row">
                  <span className={`ext-dot${way ? " is-ready" : l.run?.length ? " is-missing" : ""}`} />
                  <span className="ext-text">
                    <span className="ext-name">{l.label}</span>
                    <span className="ext-dim">
                      {way ? `runs with ${way.needs}` : l.run?.length ? `needs ${l.run.map((r) => r.needs).join(" or ")}${l.install ? ` — ${l.install}` : ""}` : "colored, not run"}
                      {l.plugin !== "built-in" ? ` · from ${l.plugin}` : ""}
                    </span>
                  </span>
                </div>
              );
            })}
          </section>

          <section>
            <h3>Plugins</h3>
            {plugins.loaded.length === 0 && <div className="ext-empty">None yet. A plugin is a folder with a plugin.json — start from the sample.</div>}
            {plugins.loaded.map((p) => (
              <div key={p.folder}>
              <div className={`ext-row${p.error ? " is-broken" : ""}`}>
                <span className="ext-icon">
                  <Icon name="source" size={16} />
                </span>
                <span className="ext-text">
                  <span className="ext-name">
                    {p.name} {p.version && <span className="ext-dim">{p.version}</span>}
                  </span>
                  {p.description && <span className="ext-dim">{p.description}</span>}
                  <span className={`ext-dim${p.error ? " is-error" : ""}`}>{pluginState(p)}</span>
                </span>
                {(p.settings?.length ?? 0) > 0 && !p.off && (
                  <button className={`ext-link${settingsOf === p.folder ? " is-on" : ""}`} title="Its settings" onClick={() => setSettingsOf(settingsOf === p.folder ? null : p.folder)}>
                    <Icon name="gear" size={13} />
                  </button>
                )}
                <button className="ext-link" title="Show it in Finder" onClick={() => folder(p.folder)}>
                  <Icon name="folder" size={13} />
                </button>
                <Switch on={!p.off} onChange={() => (togglePlugin(p.folder), loadPlugins())} label={p.name} />
              </div>
              {settingsOf === p.folder && <PluginSettings plugin={p} />}
              </div>
            ))}
            <div className="ext-actions">
              <button onClick={onNewPlugin}>
                <Icon name="plus" size={13} /> New plugin from a sample
              </button>
              <button onClick={() => loadPlugins()}>
                <Icon name="reset" size={13} /> Reload plugins
              </button>
              <button onClick={() => folder()}>
                <Icon name="folder" size={13} /> Open the plugins folder
              </button>
            </div>
          </section>

          <section>
            <h3>Gallery</h3>
            <div className="ext-dim ext-note">Plugins that come with the app — adding one copies it into your plugins folder, to use as it is or change</div>
            {GALLERY.map((g) => {
              const added = plugins.loaded.some((p) => p.folder === g.folder);
              return (
                <div key={g.folder} className="ext-row">
                  <span className="ext-kind">{g.kind}</span>
                  <span className="ext-text">
                    <span className="ext-name">{g.name}</span>
                    <span className="ext-dim">{g.description}</span>
                  </span>
                  {added ? (
                    <span className="ext-dim ext-added">Added</span>
                  ) : (
                    <button className="ext-add" disabled={adding === g.folder} onClick={() => addFromGallery(g)}>
                      {adding === g.folder ? "Adding…" : "Add"}
                    </button>
                  )}
                </div>
              );
            })}
          </section>
        </div>
      </div>
    </div>
  );
}
