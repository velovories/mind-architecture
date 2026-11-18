// Bridges the vault (Obsidian API) and the pure core. Rebuilt on vault changes, debounced.

import { App, TFile, debounce, normalizePath } from "obsidian";
import type { Lang } from "./i18n";
import { SimilarityIndex, type Doc } from "./core/similarity";
import { computeStats, type NoteInfo, type ThinkingStats } from "./core/stats";

export interface PluginData {
  rejected: string[];               // pair keys "a\u0000b" (sorted paths) the user said no to
  snoozed: Record<string, number>;  // pair key → ms timestamp until which it is hidden
  excludeFolders: string[];
  lang: Lang;
  recent: string[];                 // last opened notes, newest first
}

export const DEFAULT_DATA: PluginData = { rejected: [], snoozed: {}, excludeFolders: [], lang: "ru", recent: [] };

export const pairKey = (a: string, b: string) => (a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`);

export class VaultModel {
  index: SimilarityIndex | null = null;
  stats: ThinkingStats | null = null;
  files = new Map<string, TFile>();
  texts = new Map<string, string>();
  private listeners = new Set<() => void>();
  readonly scheduleRebuild = debounce(() => void this.rebuild(), 1500, true);

  constructor(private app: App, private data: () => PluginData, private save: () => Promise<void>) {}

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  notify(): void {
    this.listeners.forEach((fn) => fn());
  }

  excluded(path: string): boolean {
    const folders = [...this.data().excludeFolders, templatesFolder(this.app)].filter(Boolean) as string[];
    return folders.some((f) => path === f || path.startsWith(normalizePath(f) + "/"));
  }

  async rebuild(): Promise<void> {
    const files = this.app.vault.getMarkdownFiles().filter((f) => !this.excluded(f.path));
    this.files = new Map(files.map((f) => [f.path, f]));
    const resolved = this.app.metadataCache.resolvedLinks;
    const unresolved = this.app.metadataCache.unresolvedLinks;
    const inCount = new Map<string, number>();
    for (const [src, targets] of Object.entries(resolved)) {
      if (!this.files.has(src)) continue;
      for (const t of Object.keys(targets)) if (t !== src) inCount.set(t, (inCount.get(t) ?? 0) + 1);
    }
    const docs: Doc[] = [];
    const infos: NoteInfo[] = [];
    const texts = new Map<string, string>();
    for (const f of files) {
      const text = await this.app.vault.cachedRead(f);
      texts.set(f.path, text);
      const out = Object.keys(resolved[f.path] ?? {}).filter((p) => p.endsWith(".md") && p !== f.path);
      docs.push({ path: f.path, title: f.basename.normalize("NFC"), text, links: new Set(out) });
      infos.push({
        path: f.path, title: f.basename.normalize("NFC"), text,
        outResolved: out, unresolved: Object.keys(unresolved[f.path] ?? {}), inCount: inCount.get(f.path) ?? 0,
      });
    }
    this.texts = texts;
    this.index = new SimilarityIndex(docs);
    this.stats = computeStats(infos);
    this.listeners.forEach((fn) => fn());
  }

  hidden = (a: string, b: string): boolean => {
    const k = pairKey(a, b);
    const d = this.data();
    return d.rejected.includes(k) || (d.snoozed[k] ?? 0) > Date.now();
  };

  async reject(a: string, b: string): Promise<void> {
    const k = pairKey(a, b);
    if (!this.data().rejected.includes(k)) this.data().rejected.push(k);
    await this.save();
    this.listeners.forEach((fn) => fn());
  }

  async snooze(a: string, b: string, days = 7): Promise<void> {
    this.data().snoozed[pairKey(a, b)] = Date.now() + days * 86_400_000;
    await this.save();
    this.listeners.forEach((fn) => fn());
  }
}

function templatesFolder(app: App): string | undefined {
  // Obsidian's core Templates plugin keeps its folder here; its notes are not thoughts.
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (app as any).internalPlugins?.getPluginById?.("templates")?.instance?.options?.folder || undefined;
  } catch {
    return undefined;
  }
}
