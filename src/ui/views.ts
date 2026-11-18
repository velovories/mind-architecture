// Side panel «Связи» and «Качество мышления». The home screen lives in hub.ts.

import { MarkdownView, TFile, setIcon } from "obsidian";
import type MindPlugin from "../main";
import { analyzeLinkLines } from "../core/links";
import { LinkModal } from "./link-modal";
import { MindView } from "./base";
import { t } from "../i18n";

export const VIEW_TODAY = "mind-today";
export const VIEW_LINKS = "mind-links";
export const VIEW_STATS = "mind-stats";
export const VIEW_ISLANDS = "mind-islands";
export const VIEW_BRANCHES = "mind-branches";

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
    if (f && f.extension === "md" && f !== this.file) { this.file = f; this.safeRender(); }
  }

  render(): void {
    const el = this.root();
    const f = this.file;
    if (!f) { el.createDiv({ text: t("openNote"), cls: "mind-muted" }); return; }
    const prev = this.plugin.recent(1, f.path)[0];
    if (prev) {
      const b = el.createEl("button", { cls: "mind-prev" });
      setIcon(b.createSpan("mind-card-icon"), "arrow-left");
      b.createSpan({ text: t("prevNote", { t: this.plugin.model.index?.title(prev) ?? prev }) });
      b.onclick = () => {
        const pf = this.app.vault.getAbstractFileByPath(prev);
        if (pf instanceof TFile) void this.app.workspace.getLeaf(false).openFile(pf);
      };
    }
    const head = el.createDiv("mind-head-row");
    head.createEl("h3", { text: f.basename, cls: "mind-title" });
    const br = head.createEl("button", { cls: "mind-small-btn" });
    setIcon(br.createSpan("mind-card-icon"), "git-fork");
    br.createSpan({ text: t("branchesBtn") });
    br.onclick = () => void this.plugin.openBranches(f.path);
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
        b.onclick = () => new LinkModal(this.app, f, target, undefined, this.plugin).open();
      }
    }

    // Suggestions
    const sug = index.suggest(f.path, 3, 0.09, this.plugin.model.hidden);
    const s = el.createDiv("mind-section");
    s.createDiv({ text: t("maybe"), cls: "mind-label" });
    if (!sug.length) s.createDiv({ text: t("noSimilar"), cls: "mind-muted mind-small" });
    for (const x of sug) {
      const c = s.createDiv("mind-link-card");
      this.noteLink(c, x.path, index.title(x.path), f.path);
      const why: string[] = [];
      if (x.shared.length) why.push(t("sharedWords", { w: x.shared.join(" · ") }));
      if (x.neighbours.length) why.push(t("bothLinked", { n: x.neighbours.slice(0, 2).map((p) => `«${index.title(p)}»`).join(", ") }));
      c.createDiv({ text: why.join("; "), cls: "mind-muted mind-small" });
      const row = c.createDiv("mind-row");
      const link = row.createEl("button", { text: t("link"), cls: "mind-small-btn" });
      link.onclick = () => new LinkModal(this.app, f, index.title(x.path), undefined, this.plugin).open();
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
