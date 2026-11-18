// «Ветви»: where one note fans out — first ring, second ring, where branches meet, where they leave the island.

import { TFile, ViewStateResult, setIcon } from "obsidian";
import { branchesOf } from "../core/islands";
import { MindView } from "./base";
import { VIEW_BRANCHES } from "./views";
import { LinkModal } from "./link-modal";
import { t } from "../i18n";

export class BranchesView extends MindView {
  private path = "";
  getViewType(): string { return VIEW_BRANCHES; }
  getDisplayText(): string {
    const f = this.app.vault.getAbstractFileByPath(this.path);
    return f instanceof TFile ? `${t("branches")}: ${f.basename}` : t("branches");
  }
  getIcon(): string { return "git-fork"; }

  getState(): Record<string, unknown> { return { path: this.path }; }
  async setState(state: { path?: string }, result: ViewStateResult): Promise<void> {
    if (state?.path) this.path = state.path;
    this.safeRender();
    await super.setState(state, result);
  }

  render(): void {
    const el = this.root();
    if (this.loading(el)) return;
    const m = this.plugin.model;
    const index = m.index!;
    if (!this.path || !m.files.has(this.path)) { el.createDiv({ text: t("openNote"), cls: "mind-muted" }); return; }

    const b = branchesOf(this.path, (p) => index.neighbours(p), m.explanation);
    const myIsland = m.islandOf.get(this.path);
    el.createDiv({ text: t("branches"), cls: "mind-label" });
    const root = el.createDiv("mind-branch-root");
    if (myIsland) root.createSpan({ cls: "mind-dot" }).style.background = m.islandColor(myIsland);
    const rt = root.createDiv();
    this.noteLink(rt, this.path, index.title(this.path)).addClass("mind-branch-root-title");
    const explained = b.first.filter((x) => x.explanation).length;
    rt.createDiv({
      text: t("branchesSub", { n: b.first.length, e: explained }) + (myIsland ? t("inIsland", { i: m.islandName(myIsland) }) : ""),
      cls: "mind-muted mind-small",
    });
    if (!b.first.length) { el.createDiv({ text: t("noBranches"), cls: "mind-muted" }); return; }

    const exits = new Map<string, string>();   // island name → colour
    const meet = new Set(b.converge.map((c) => c.path));
    const tree = el.createDiv("mind-tree");
    for (const br of b.first) {
      const node = tree.createDiv("mind-tree-node");
      this.noteLink(node, br.path, index.title(br.path)).addClass("mind-tree-title");
      if (br.explanation) node.createDiv({ text: `«${br.explanation}»`, cls: "mind-small mind-explain" });
      else {
        const line = node.createDiv("mind-muted mind-small");
        line.createSpan({ text: `${t("noWhy")} · ` });
        const add = line.createEl("a", { text: t("addWhyShort"), href: "#" });
        add.onclick = (e) => {
          e.preventDefault();
          const f = m.files.get(this.path);
          if (f) new LinkModal(this.app, f, index.title(br.path), undefined, this.plugin).open();
        };
      }
      this.exitBadge(node, br.path, myIsland?.id, exits);
      if (br.children.length) {
        const kids = node.createDiv("mind-tree-kids");
        for (const k of br.children) {
          const row = kids.createDiv("mind-tree-kid");
          const a = this.noteLink(row, k.path, index.title(k.path));
          if (meet.has(k.path)) a.addClass("is-meet");
          this.exitBadge(row, k.path, myIsland?.id, exits);
        }
      }
    }

    if (b.converge.length || exits.size) {
      const c = this.card(el, "sparkles", t("insights"), "is-warm");
      for (const cv of b.converge.slice(0, 2)) {
        c.createDiv({ text: t("convergeText", { n: cv.via.length, t: index.title(cv.path) }), cls: "mind-small" });
      }
      if (exits.size) c.createDiv({ text: t("exitsText", { list: [...exits.keys()].map((x) => `«${x}»`).join(", ") }), cls: "mind-small" });
    }
  }

  private exitBadge(parent: HTMLElement, path: string, home: string | undefined, exits: Map<string, string>): void {
    const m = this.plugin.model;
    const isl = m.islandOf.get(path);
    if (!isl || isl.id === home) return;
    const name = m.islandName(isl);
    exits.set(name, m.islandColor(isl));
    const badge = parent.createSpan({ text: t("toIsland", { i: name }), cls: "mind-badge" });
    badge.style.borderColor = m.islandColor(isl);
  }
}

/** Shown on notes in the walk and elsewhere: a small fork icon button. */
export function branchesButton(parent: HTMLElement, onClick: () => void): HTMLButtonElement {
  const b = parent.createEl("button", { cls: "mind-small-btn", attr: { "aria-label": t("branchesBtn") } });
  setIcon(b.createSpan("mind-card-icon"), "git-fork");
  b.createSpan({ text: t("branchesBtn") });
  b.onclick = onClick;
  return b;
}
