// The three views: Сегодня, Связи (side panel), Качество мышления.

import { ItemView, MarkdownView, Modal, Notice, TFile, WorkspaceLeaf, setIcon } from "obsidian";
import type MindPlugin from "../main";
import { analyzeLinkLines } from "../core/links";
import { pickForDay } from "../core/similarity";
import { LinkModal } from "./link-modal";
import { t } from "../i18n";

export const VIEW_TODAY = "mind-today";
export const VIEW_LINKS = "mind-links";
export const VIEW_STATS = "mind-stats";

abstract class MindView extends ItemView {
  private off?: () => void;
  constructor(leaf: WorkspaceLeaf, protected plugin: MindPlugin) { super(leaf); }
  getIcon(): string { return "brain-circuit"; }
  async onOpen(): Promise<void> {
    this.off = this.plugin.model.onChange(() => this.render());
    this.render();
  }
  async onClose(): Promise<void> { this.off?.(); }
  abstract render(): void;

  protected root(): HTMLElement {
    const el = this.contentEl;
    el.empty();
    el.addClass("mind-view");
    return el;
  }

  protected card(parent: HTMLElement, icon: string, title: string, tone = ""): HTMLElement {
    const c = parent.createDiv(`mind-card ${tone}`);
    const h = c.createDiv("mind-card-head");
    setIcon(h.createSpan("mind-card-icon"), icon);
    h.createSpan({ text: title });
    return c;
  }

  protected noteLink(parent: HTMLElement, path: string, title: string): HTMLElement {
    const a = parent.createEl("a", { text: title, cls: "mind-note-link", href: "#" });
    a.onclick = (e) => { e.preventDefault(); void this.app.workspace.openLinkText(path, "", false); };
    return a;
  }

  protected loading(el: HTMLElement): boolean {
    if (this.plugin.model.index && this.plugin.model.stats) return false;
    el.createDiv({ text: t("loading"), cls: "mind-muted" });
    return true;
  }
}

// ---------------- Сегодня ----------------

export class TodayView extends MindView {
  getViewType(): string { return VIEW_TODAY; }
  getDisplayText(): string { return t("today"); }

  render(): void {
    const el = this.root();
    el.createEl("h2", { text: t("today"), cls: "mind-title" });
    if (this.loading(el)) return;
    const { index, stats } = this.plugin.model;

    // Pair to think about
    const pairs = index!.discoveryPairs(this.plugin.model.hidden);
    const p = pickForDay(pairs, new Date());
    const c = this.card(el, "git-compare-arrows", t("pairTitle"), "is-warm");
    if (!p) {
      c.createDiv({ text: t("pairEmpty"), cls: "mind-muted" });
    } else {
      const list = c.createDiv("mind-pair-list");
      this.noteLink(list.createDiv(), p.from, index!.title(p.from));
      this.noteLink(list.createDiv(), p.path, index!.title(p.path));
      const why = c.createDiv("mind-small");
      why.createSpan({ text: t("pairWhyA"), cls: "mind-muted" });
      why.createSpan({ text: p.shared.join(" · ") });
      why.createSpan({ text: t("pairWhyB"), cls: "mind-muted" });
      c.createDiv({ text: t("pairQuestion", { a: index!.title(p.from), b: index!.title(p.path) }), cls: "mind-question" });
      c.createDiv({ text: t("notClaim"), cls: "mind-muted mind-small" });
      const row = c.createDiv("mind-row");
      const write = row.createEl("button", { text: t("writeThought"), cls: "mod-cta" });
      write.onclick = () => void this.writeThought(p.from, p.path, p.shared);
      const link = row.createEl("button", { text: t("link") });
      link.onclick = () => {
        const f = this.plugin.model.files.get(p.from);
        if (f) new LinkModal(this.app, f, index!.title(p.path)).open();
      };
      const no = row.createEl("button", { text: t("notThis") });
      no.onclick = () => void this.plugin.model.reject(p.from, p.path);
    }

    // Waiting
    const w = this.card(el, "inbox", t("waiting"));
    this.row(w, String(stats!.bare), t("bareCount"), () => this.openBareList());
    this.row(w, String(stats!.planned.length), t("plannedCount"),
      () => this.openList(t("plannedList"), stats!.planned.map((x) => ({ label: x.name, hint: t("mentions", { n: x.mentions }), open: () => this.app.workspace.openLinkText(x.name, "", false) }))),
      stats!.planned.slice(0, 2).map((x) => x.name).join(" · ") + (stats!.planned.length > 2 ? " · …" : ""));
    this.row(w, String(stats!.orphans.length), t("orphanCount"),
      () => this.openList(t("orphanList"), stats!.orphans.map((path) => ({ label: index!.title(path), open: () => this.app.workspace.openLinkText(path, "", false) }))));
  }

  private row(parent: HTMLElement, n: string, label: string, onClick: () => void, sub?: string): void {
    const r = parent.createEl("button", { cls: "mind-count-row" });
    r.createSpan({ text: n, cls: "mind-count" });
    const t = r.createSpan({ cls: "mind-count-label" });
    t.createSpan({ text: label });
    if (sub) t.createDiv({ text: sub, cls: "mind-muted mind-small" });
    setIcon(r.createSpan("mind-chevron"), "chevron-right");
    r.onclick = onClick;
  }

  private openBareList(): void {
    const items: ListItem[] = [];
    for (const [path, file] of this.plugin.model.files) {
      void file;
      const text = this.plugin.textCache.get(path);
      if (!text) continue;
      const bare = analyzeLinkLines(text).filter((l) => !l.explained).reduce((n, l) => n + l.targets.length, 0);
      if (bare) items.push({ label: this.plugin.model.index!.title(path), hint: t("bareN", { n: bare }), open: () => this.app.workspace.openLinkText(path, "", false), n: bare });
    }
    items.sort((a, b) => (b.n ?? 0) - (a.n ?? 0));
    this.openList(t("bareList"), items);
  }

  private openList(title: string, items: ListItem[]): void {
    new ListModal(this.app, title, items).open();
  }

  private async writeThought(a: string, b: string, shared: string[]): Promise<void> {
    const ta = this.plugin.model.index!.title(a), tb = this.plugin.model.index!.title(b);
    let name = t("thoughtName", { a: ta, b: tb }).replace(/[\\/:*?"<>|#^[\]]/g, " ").slice(0, 120).trim();
    let i = 2;
    while (this.app.vault.getAbstractFileByPath(`${name}.md`)) name = `${name} ${i++}`;
    const today = new Date().toLocaleDateString("ru-RU");
    const body = t("thoughtBody", { a: ta, b: tb, words: shared.join(", "), date: today });
    const file = await this.app.vault.create(`${name}.md`, body);
    await this.app.workspace.getLeaf(false).openFile(file);
    new Notice(t("thoughtCreated"));
  }
}

interface ListItem { label: string; hint?: string; open: () => unknown; n?: number }

class ListModal extends Modal {
  constructor(app: import("obsidian").App, private title: string, private items: ListItem[]) { super(app); }
  onOpen(): void {
    this.contentEl.createEl("h3", { text: this.title });
    if (!this.items.length) this.contentEl.createDiv({ text: t("empty"), cls: "mind-muted" });
    const list = this.contentEl.createDiv("mind-list");
    for (const it of this.items) {
      const b = list.createEl("button", { cls: "mind-list-item" });
      b.createSpan({ text: it.label });
      if (it.hint) b.createSpan({ text: it.hint, cls: "mind-muted mind-small" });
      b.onclick = () => { this.close(); void it.open(); };
    }
  }
  onClose(): void { this.contentEl.empty(); }
}

// ---------------- Связи (side panel for the active note) ----------------

export class LinksView extends MindView {
  private file: TFile | null = null;
  getViewType(): string { return VIEW_LINKS; }
  getDisplayText(): string { return t("links"); }
  getIcon(): string { return "waypoints"; }

  async onOpen(): Promise<void> {
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.track()));
    this.registerEvent(this.app.workspace.on("file-open", () => this.track()));
    this.track();
    await super.onOpen();
  }

  private track(): void {
    const f = this.app.workspace.getActiveViewOfType(MarkdownView)?.file ?? this.app.workspace.getActiveFile();
    if (f && f.extension === "md" && f !== this.file) { this.file = f; this.render(); }
  }

  render(): void {
    const el = this.root();
    const f = this.file;
    if (!f) { el.createDiv({ text: t("openNote"), cls: "mind-muted" }); return; }
    el.createEl("h3", { text: f.basename, cls: "mind-title" });
    if (this.loading(el)) return;
    const index = this.plugin.model.index!;
    const text = this.plugin.textCache.get(f.path) ?? "";
    const lines = analyzeLinkLines(text);

    // Own links
    const total = lines.reduce((n, l) => n + l.targets.length, 0);
    const done = lines.filter((l) => l.explained).reduce((n, l) => n + l.targets.length, 0);
    const own = el.createDiv("mind-section");
    own.createDiv({ text: t("ownLinks", { done, total }), cls: "mind-label" });
    if (!total) own.createDiv({ text: t("noLinks"), cls: "mind-muted mind-small" });
    for (const l of lines) for (const target of l.targets) {
      const c = own.createDiv(`mind-link-card ${l.explained ? "" : "is-bare"}`);
      const dest = this.app.metadataCache.getFirstLinkpathDest(target, f.path);
      if (dest) this.noteLink(c, dest.path, target); else c.createSpan({ text: t("notWritten", { t: target }), cls: "mind-muted" });
      if (l.explained) c.createDiv({ text: l.explanation, cls: "mind-small mind-explain" });
      else {
        c.createDiv({ text: t("bareHint"), cls: "mind-muted mind-small" });
        const b = c.createEl("button", { text: t("addWhy"), cls: "mod-cta mind-small-btn" });
        b.onclick = () => new LinkModal(this.app, f, target).open();
      }
    }

    // Suggestions
    const sug = index.suggest(f.path, 3, 0.09, this.plugin.model.hidden);
    const s = el.createDiv("mind-section");
    s.createDiv({ text: t("maybe"), cls: "mind-label" });
    if (!sug.length) s.createDiv({ text: t("noSimilar"), cls: "mind-muted mind-small" });
    for (const x of sug) {
      const c = s.createDiv("mind-link-card");
      this.noteLink(c, x.path, index.title(x.path));
      const why: string[] = [];
      if (x.shared.length) why.push(t("sharedWords", { w: x.shared.join(" · ") }));
      if (x.neighbours.length) why.push(t("bothLinked", { n: x.neighbours.slice(0, 2).map((p) => `«${index.title(p)}»`).join(", ") }));
      c.createDiv({ text: why.join("; "), cls: "mind-muted mind-small" });
      const row = c.createDiv("mind-row");
      const link = row.createEl("button", { text: t("link"), cls: "mind-small-btn" });
      link.onclick = () => new LinkModal(this.app, f, index.title(x.path)).open();
      const no = row.createEl("button", { text: t("no"), cls: "mind-small-btn" });
      no.onclick = () => void this.plugin.model.reject(f.path, x.path);
      const later = row.createEl("button", { text: t("later"), cls: "mind-small-btn" });
      later.onclick = () => void this.plugin.model.snooze(f.path, x.path);
    }

    // Backlinks with their explanation status
    const back = el.createDiv("mind-section");
    back.createDiv({ text: t("backlinks"), cls: "mind-label" });
    let any = false;
    for (const [src, targets] of Object.entries(this.app.metadataCache.resolvedLinks)) {
      if (src === f.path || !targets[f.path]) continue;
      any = true;
      const srcText = this.plugin.textCache.get(src) ?? "";
      const mine = analyzeLinkLines(srcText).filter((l) => l.targets.some((x) => this.app.metadataCache.getFirstLinkpathDest(x, src)?.path === f.path));
      const explained = mine.some((l) => l.explained);
      const r = back.createDiv("mind-back-row");
      this.noteLink(r, src, index.title(src));
      if (!explained) r.createSpan({ text: t("noExplain"), cls: "mind-muted mind-small" });
    }
    if (!any) back.createDiv({ text: t("noBacklinks"), cls: "mind-muted mind-small" });
  }
}

// ---------------- Качество мышления ----------------

export class StatsView extends MindView {
  getViewType(): string { return VIEW_STATS; }
  getDisplayText(): string { return t("stats"); }
  getIcon(): string { return "gauge"; }

  render(): void {
    const el = this.root();
    el.createEl("h2", { text: t("stats"), cls: "mind-title" });
    if (this.loading(el)) return;
    const s = this.plugin.model.stats!;
    const pct = s.linkLines ? Math.round((100 * s.explained) / s.linkLines) : 0;
    const c = this.card(el, "message-square-quote", t("explainedShare"));
    const big = c.createDiv("mind-big");
    big.createSpan({ text: `${pct}%`, cls: "mind-accent" });
    big.createSpan({ text: t("ofTotal", { a: s.explained, b: s.linkLines }), cls: "mind-muted" });
    const bar = c.createDiv("mind-bar");
    bar.createDiv("mind-bar-fill").style.width = `${pct}%`;
    if (s.mostBare) {
      const line = c.createDiv("mind-small");
      line.createSpan({ text: t("restBareA", { n: s.bare }) });
      this.noteLink(line, s.mostBare.path, `«${s.mostBare.title}»`);
      line.createSpan({ text: t("restBareB", { n: s.mostBare.bare }) });
    }
    const grid = el.createDiv("mind-grid");
    const tile = (n: number, label: string) => {
      const d = grid.createDiv("mind-tile");
      d.createDiv({ text: String(n), cls: "mind-tile-n" });
      d.createDiv({ text: label, cls: "mind-small" });
    };
    tile(s.conclusions, t("tileConclusions"));
    tile(s.notes - s.conclusions, t("tileKnowledge"));
    tile(s.orphans.length, t("tileOrphans"));
    tile(s.planned.length, t("tilePlanned"));
    el.createDiv({ text: t("foot"), cls: "mind-muted mind-small mind-foot" });
  }
}
