// Shared pieces of every plugin screen.

import { ItemView, Modal, TFile, WorkspaceLeaf, setIcon } from "obsidian";
import type MindPlugin from "../main";
import { PreviewModal } from "./preview";
import { t } from "../i18n";

export abstract class MindView extends ItemView {
  private off?: () => void;
  constructor(leaf: WorkspaceLeaf, protected plugin: MindPlugin) { super(leaf); }
  getIcon(): string { return "brain-circuit"; }
  async onOpen(): Promise<void> {
    this.off = this.plugin.model.onChange(() => this.safeRender());
    this.safeRender();
  }

  /** A broken screen says what broke instead of staying white. */
  protected safeRender(): void {
    try {
      this.render();
    } catch (e) {
      console.error("Mind Architecture:", e);
      const el = this.contentEl;
      el.empty();
      el.createEl("pre", { text: `Mind Architecture: ${(e as Error)?.stack ?? e}`, cls: "mind-preview" });
    }
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

  /** A note name: tap = quick look over this screen; the preview has "open fully" and "back to the question". */
  protected noteLink(parent: HTMLElement, path: string, title: string, compareWith?: string): HTMLElement {
    const a = parent.createEl("a", { text: title, cls: "mind-note-link", href: "#" });
    a.onclick = (e) => { e.preventDefault(); this.peek(compareWith ? [path, compareWith] : [path]); };
    return a;
  }

  protected peek(paths: string[]): void {
    new PreviewModal(this.app, paths, (p) => this.plugin.remember(p)).open();
  }

  protected recentCard(parent: HTMLElement, except?: string): void {
    const c = this.card(parent, "history", t("recent"));
    const list = this.plugin.recent(3, except);
    if (!list.length) { c.createDiv({ text: t("recentEmpty"), cls: "mind-muted mind-small" }); return; }
    const box = c.createDiv("mind-recent");
    for (const p of list) {
      const f = this.app.vault.getAbstractFileByPath(p) as TFile;
      const b = box.createEl("button", { cls: "mind-recent-item" });
      setIcon(b.createSpan("mind-card-icon"), "file-text");
      b.createSpan({ text: f.basename });
      b.onclick = () => this.peek([p]);
    }
  }

  protected loading(el: HTMLElement): boolean {
    if (this.plugin.model.index && this.plugin.model.stats) return false;
    el.createDiv({ text: t("loading"), cls: "mind-muted" });
    return true;
  }
}


export interface ListItem { label: string; hint?: string; open: () => unknown; n?: number }

export class ListModal extends Modal {
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

