// «Карта картотеки»: islands of notes held together by your own links, plus your collections.

import { App, Modal, Notice, TFile, normalizePath, setIcon } from "obsidian";
import type MindPlugin from "../main";
import type { Island } from "../core/islands";
import { MindView, ListModal } from "./base";
import { VIEW_ISLANDS } from "./views";
import { t } from "../i18n";

export class IslandsView extends MindView {
  private expanded = new Set<string>();
  getViewType(): string { return VIEW_ISLANDS; }
  getDisplayText(): string { return t("islandsTitle"); }
  getIcon(): string { return "map"; }

  render(): void {
    const el = this.root();
    el.createEl("h2", { text: t("islandsTitle"), cls: "mind-title" });
    if (this.loading(el)) return;
    const m = this.plugin.model;
    el.createDiv({ text: t("islandsIntro", { n: m.stats!.notes }), cls: "mind-muted mind-small" });

    const big = m.islands.islands.filter((i) => i.members.length >= 5);
    const small = m.islands.islands.filter((i) => i.members.length < 5);
    const grid = el.createDiv("mind-tiles");
    for (const i of big) this.islandTile(grid, i);

    if (small.length) {
      el.createDiv({ text: t("smallIslands"), cls: "mind-label" });
      const chips = el.createDiv("mind-chips");
      for (const i of small) {
        const b = chips.createEl("button", { cls: "mind-island-chip" });
        b.createSpan({ cls: "mind-dot" }).style.background = m.islandColor(i);
        b.createSpan({ text: `${m.islandName(i)} · ${i.members.length}` });
        b.onclick = () => { this.toggle(i.id); };
        if (this.expanded.has(i.id)) b.addClass("is-active");
      }
      for (const i of small) if (this.expanded.has(i.id)) {
        const box = el.createDiv("mind-card");
        box.createDiv({ text: this.plugin.model.islandName(i), cls: "mind-tile2-title" });
        this.islandDetails(box, i);
      }
    }

    const alone = el.createEl("button", { cls: "mind-alone" });
    alone.createSpan({ text: String(m.islands.alone.length), cls: "mind-count" });
    alone.createSpan({ text: t("aloneCard"), cls: "mind-count-label" });
    setIcon(alone.createSpan("mind-chevron"), "chevron-right");
    alone.onclick = () => new ListModal(this.app, t("orphanList"),
      m.islands.alone.map((p) => ({ label: m.index!.title(p), open: () => this.peek([p]) }))).open();

    renderCollections(el, this.plugin, (p) => this.peek([p]));
  }

  private toggle(id: string): void {
    if (this.expanded.has(id)) this.expanded.delete(id); else this.expanded.add(id);
    this.safeRender();
  }

  private islandTile(grid: HTMLElement, i: Island): void {
    const m = this.plugin.model;
    const opened = this.expanded.has(i.id);
    const tile = grid.createDiv(`mind-tile2 ${opened ? "is-open is-wide" : ""}`);
    const head = tile.createEl("button", { cls: "mind-tile2-head" });
    const top = head.createDiv("mind-tile2-top");
    top.createSpan({ cls: "mind-dot" }).style.background = m.islandColor(i);
    top.createSpan({ text: String(i.members.length), cls: "mind-tile2-n" });
    head.createDiv({ text: m.islandName(i), cls: "mind-tile2-title" });
    if (!opened) head.createDiv({ text: i.members.slice(1, 3).map((p) => m.index!.title(p)).join(" · "), cls: "mind-muted mind-small" });
    head.onclick = () => this.toggle(i.id);
    if (opened) this.islandDetails(tile, i);
  }

  private islandDetails(parent: HTMLElement, i: Island): void {
    const m = this.plugin.model;
    const box = parent.createDiv("mind-island-details");
    box.createDiv({ text: t("peekHint"), cls: "mind-muted mind-small" });
    const list = box.createDiv("mind-recent");
    for (const p of i.members) {
      const b = list.createEl("button", { cls: "mind-recent-item" });
      b.createSpan({ text: m.index!.title(p) });
      if (p === i.hub) b.createSpan({ text: t("hubMark"), cls: "mind-badge" });
      b.onclick = () => this.peek([p]);
    }
    const near = m.nearestIsland(i);
    if (near) {
      const c = box.createDiv("mind-card is-warm");
      c.createDiv({ text: t("nearest"), cls: "mind-card-head" });
      const line = c.createDiv("mind-small");
      line.createSpan({ cls: "mind-dot" }).style.background = m.islandColor(near.island);
      line.createSpan({ text: ` ${m.islandName(near.island)}: ` });
      line.createSpan({ text: t("nearestText", { a: m.index!.title(near.a), b: m.index!.title(near.b), w: near.shared.slice(0, 3).join(", ") }) });
      const b = c.createEl("button", { text: t("compareTwo"), cls: "mind-small-btn" });
      b.onclick = () => this.peek([near.a, near.b]);
    }
    const row = box.createDiv("mind-row");
    const br = row.createEl("button", { text: t("branchesFromHub"), cls: "mod-cta" });
    br.onclick = () => void this.plugin.openBranches(i.hub);
    row.createEl("button", { text: t("makeCollection") }).onclick = () =>
      new CollectionModal(this.app, this.plugin, i.members, m.islandName(i)).open();
    row.createEl("button", { text: t("rename") }).onclick = () =>
      new RenameModal(this.app, m.islandName(i), (name) => void m.renameIsland(i, name)).open();
  }
}

export function renderCollections(el: HTMLElement, plugin: MindPlugin, peek: (p: string) => void): void {
  el.createDiv({ text: t("collections"), cls: "mind-label" });
  const cols = plugin.model.collections;
  const card = el.createDiv("mind-card");
  if (!cols.length) card.createDiv({ text: t("collectionsEmpty"), cls: "mind-small" });
  const list = card.createDiv("mind-recent");
  for (const f of cols) {
    const b = list.createEl("button", { cls: "mind-recent-item" });
    setIcon(b.createSpan("mind-card-icon"), "library");
    b.createSpan({ text: f.basename });
    b.onclick = () => peek(f.path);
  }
  const add = card.createEl("button", { text: t("newCollection"), cls: "mind-small-btn" });
  add.onclick = () => new CollectionModal(plugin.app, plugin, [], "").open();
}

/** Pick notes, name the collection, get a plain note with a list of links. */
export class CollectionModal extends Modal {
  private chosen: Set<string>;
  constructor(app: App, private plugin: MindPlugin, preset: string[], private name: string) {
    super(app);
    this.chosen = new Set(preset);
  }

  onOpen(): void {
    const c = this.contentEl;
    this.modalEl.addClass("mind-collection-modal");
    c.createEl("h3", { text: t("colTitle") });
    const nameLabel = c.createEl("label", { text: t("colName"), cls: "mind-label" });
    nameLabel.htmlFor = "mind-col-name";
    const name = c.createEl("input", { type: "text", cls: "mind-cap-input" });
    name.id = "mind-col-name";
    name.value = this.name;
    const search = c.createEl("input", { type: "search", cls: "mind-cap-input", attr: { placeholder: t("colSearch"), "aria-label": t("colSearch") } });
    const count = c.createDiv("mind-muted mind-small");
    const list = c.createDiv("mind-list");
    const files = [...this.plugin.model.files.values()].sort((a, b) =>
      Number(this.chosen.has(b.path)) - Number(this.chosen.has(a.path)) || a.basename.localeCompare(b.basename));
    const draw = () => {
      list.empty();
      const q = search.value.trim().toLowerCase();
      count.setText(t("colSelected", { n: this.chosen.size }));
      for (const f of files) {
        if (q && !f.basename.toLowerCase().includes(q)) continue;
        const row = list.createEl("label", { cls: "mind-check-row" });
        const cb = row.createEl("input", { type: "checkbox" });
        cb.checked = this.chosen.has(f.path);
        cb.onchange = () => { if (cb.checked) this.chosen.add(f.path); else this.chosen.delete(f.path); count.setText(t("colSelected", { n: this.chosen.size })); };
        row.createSpan({ text: f.basename });
      }
    };
    search.oninput = draw;
    draw();
    const row = c.createDiv("mind-row");
    const ok = row.createEl("button", { text: t("colCreate"), cls: "mod-cta" });
    ok.onclick = () => void this.create(name.value.trim());
    row.createEl("button", { text: t("cancel") }).onclick = () => this.close();
  }

  private async create(name: string): Promise<void> {
    if (!name || !this.chosen.size) return;
    const title = `${t("colPrefix")} — ${name}`.replace(/[\\/:*?"<>|#^[\]]/g, " ").trim();
    let path = normalizePath(`${title}.md`), n = 2;
    while (this.app.vault.getAbstractFileByPath(path)) path = normalizePath(`${title} ${n++}.md`);
    const titles = [...this.chosen].map((p) => (this.app.vault.getAbstractFileByPath(p) as TFile | null)?.basename).filter(Boolean);
    const body = `---\nmind: collection\n---\n\n## ${t("colListHead")}\n${titles.map((x) => `- [[${x}]]`).join("\n")}\n`;
    await this.app.vault.create(path, body);
    new Notice(t("colCreated", { t: name }));
    this.close();
  }

  onClose(): void { this.contentEl.empty(); }
}

class RenameModal extends Modal {
  constructor(app: App, private current: string, private done: (name: string) => void) { super(app); }
  onOpen(): void {
    const c = this.contentEl;
    c.createEl("h3", { text: t("renameTitle") });
    const i = c.createEl("input", { type: "text", cls: "mind-cap-input", attr: { "aria-label": t("renameTitle") } });
    i.value = this.current;
    const row = c.createDiv("mind-row");
    row.createEl("button", { text: t("save"), cls: "mod-cta" }).onclick = () => { this.done(i.value); this.close(); };
    row.createEl("button", { text: t("cancel") }).onclick = () => this.close();
    window.setTimeout(() => i.select(), 50);
  }
  onClose(): void { this.contentEl.empty(); }
}
