// Bridges the vault (Obsidian API) and the pure core. Rebuilt on vault changes, debounced.

import { App, TFile, debounce, normalizePath } from "obsidian";
import type { Lang } from "./i18n";
import { SimilarityIndex, type Doc } from "./core/similarity";
import { computeStats, type NoteInfo, type ThinkingStats } from "./core/stats";
import { analyzeLinkLines } from "./core/links";
import { findIslands, matchNames, openQuestions, type Island, type IslandMap } from "./core/islands";

export interface PluginData {
  rejected: string[];               // pair keys "a\u0000b" (sorted paths) the user said no to
  snoozed: Record<string, number>;  // pair key → ms timestamp until which it is hidden
  excludeFolders: string[];
  lang: Lang;
  recent: string[];                 // last opened notes, newest first
  islandNames: { members: string[]; name: string }[];
  tiles: { order: string[]; hidden: string[]; auto: boolean };
  captureFolder: string;            // where "what I learned today" notes go; "" = vault root
  dayPair?: { day: string; a: string; b: string };
  thoughtMode?: "free" | "guided";
}

export const TILE_IDS = ["greeting", "totals", "pair", "next", "islands", "walk", "bare", "quality", "recent"] as const;
export type TileId = (typeof TILE_IDS)[number];

export const DEFAULT_DATA: PluginData = {
  rejected: [], snoozed: {}, excludeFolders: [], lang: "ru", recent: [],
  islandNames: [], tiles: { order: [...TILE_IDS], hidden: [], auto: true }, captureFolder: "",
};

/** Colours for islands, told apart by lightness as well as hue. */
export const ISLAND_COLORS = ["#8bc48a", "#e8b46b", "#6fb3e0", "#e0a0c8", "#b9a3fb", "#c4e08b", "#f0c987", "#9ec5e8", "#d9a0a0", "#8ad0c0", "#c8b08a", "#b0a0d0"];

export const pairKey = (a: string, b: string) => (a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`);

export class VaultModel {
  index: SimilarityIndex | null = null;
  stats: ThinkingStats | null = null;
  files = new Map<string, TFile>();
  texts = new Map<string, string>();
  islands: IslandMap = { islands: [], alone: [] };
  islandOf = new Map<string, Island>();
  explain = new Map<string, string>();        // "a\u0000b" → the explanation written on that link
  questions: { path: string; text: string }[] = [];
  words = 0;
  collections: TFile[] = [];
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
    const all = this.app.vault.getMarkdownFiles().filter((f) => !this.excluded(f.path));
    // collections are lists of links: they would glue every island together, so they stay out of the analysis
    this.collections = all.filter((f) => this.app.metadataCache.getFileCache(f)?.frontmatter?.mind === "collection");
    const files = all.filter((f) => !this.collections.includes(f));
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

    // islands
    const links: [string, string][] = docs.flatMap((d) => [...d.links].filter((t) => this.files.has(t)).map((t) => [d.path, t] as [string, string]));
    this.islands = findIslands(docs.map((d) => d.path), links);
    this.islandOf = new Map(this.islands.islands.flatMap((i) => i.members.map((m) => [m, i] as [string, Island])));
    this.names = matchNames(this.islands.islands, this.data().islandNames);

    // explanations on links, open questions, words
    const explain = new Map<string, string>();
    const questions: { path: string; text: string }[] = [];
    let words = 0;
    for (const d of docs) {
      words += (d.text.match(/\S+/g) ?? []).length;
      for (const l of analyzeLinkLines(d.text)) {
        if (!l.explained) continue;
        for (const tgt of l.targets) {
          const dest = this.app.metadataCache.getFirstLinkpathDest(tgt, d.path);
          if (dest) explain.set(`${d.path}\u0000${dest.path}`, l.explanation);
        }
      }
      for (const q of openQuestions(d.text)) questions.push({ path: d.path, text: q });
    }
    this.explain = explain;
    this.questions = questions;
    this.words = words;
    this.listeners.forEach((fn) => fn());
  }

  private names = new Map<string, string>();

  islandName(i: Island): string {
    return this.names.get(i.id) ?? this.index?.title(i.hub) ?? i.hub;
  }

  islandColor(i: Island): string {
    const n = this.islands.islands.indexOf(i);
    return ISLAND_COLORS[(n < 0 ? 0 : n) % ISLAND_COLORS.length];
  }

  async renameIsland(i: Island, name: string): Promise<void> {
    const d = this.data();
    d.islandNames = d.islandNames.filter((x) => matchNames([i], [x]).size === 0);
    if (name.trim()) d.islandNames.push({ members: i.members, name: name.trim() });
    await this.save();
    this.names = matchNames(this.islands.islands, d.islandNames);
    this.notify();
  }

  /** The explanation written on a link, either direction. */
  explanation = (a: string, b: string): string | undefined =>
    this.explain.get(`${a}\u0000${b}`) ?? this.explain.get(`${b}\u0000${a}`);

  /** Closest unlinked pair between this island and any other, by words. */
  nearestIsland(i: Island): { a: string; b: string; island: Island; shared: string[] } | undefined {
    if (!this.index) return;
    let best: { a: string; b: string; island: Island; shared: string[]; score: number } | undefined;
    for (const a of i.members) {
      for (const s of this.index.suggest(a, 3, 0.1, this.hidden)) {
        const other = this.islandOf.get(s.path);
        if (!other || other === i) continue;
        if (!best || s.score > best.score) best = { a, b: s.path, island: other, shared: s.shared, score: s.score };
      }
    }
    return best;
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
