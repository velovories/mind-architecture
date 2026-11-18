// Quick look at notes without leaving where you are.
// Opens over any plugin screen (or over the link dialog), keeps its own back-history,
// and closing it returns you exactly to the question you were on.

import { App, Component, MarkdownRenderer, Modal, TFile, setIcon } from "obsidian";
import { t } from "../i18n";

export class PreviewModal extends Modal {
  private stack: string[] = [];           // paths visited inside this window, last = shown
  private component = new Component();
  private body!: HTMLElement;
  private head!: HTMLElement;
  private tabs?: HTMLElement;

  /**
   * @param paths one note, or two notes to compare (shown as switchable tabs A | B)
   */
  constructor(app: App, private paths: string[], private onVisit?: (path: string) => void) {
    super(app);
  }

  onOpen(): void {
    this.modalEl.addClass("mind-preview-modal");
    this.component.load();
    const { contentEl } = this;
    if (this.paths.length > 1) {
      this.tabs = contentEl.createDiv("mind-preview-tabs");
      this.paths.forEach((p) => {
        const b = this.tabs!.createEl("button", { text: this.title(p), cls: "mind-preview-tab" });
        b.onclick = () => { this.stack = [p]; void this.show(); };
      });
    }
    this.head = contentEl.createDiv("mind-preview-head");
    this.body = contentEl.createDiv("mind-preview-body markdown-rendered");
    this.body.addEventListener("click", (e) => this.onBodyClick(e));
    const row = contentEl.createDiv("mind-row mind-preview-actions");
    const open = row.createEl("button", { text: t("openFull") });
    open.onclick = () => void this.openFull();
    const close = row.createEl("button", { text: t("backToQuestion"), cls: "mod-cta" });
    close.onclick = () => this.close();
    this.stack = [this.paths[0]];
    void this.show();
  }

  private title(path: string): string {
    const f = this.app.vault.getAbstractFileByPath(path);
    return f instanceof TFile ? f.basename : path.replace(/\.md$/, "");
  }

  private async show(): Promise<void> {
    const path = this.stack[this.stack.length - 1];
    this.onVisit?.(path);
    this.tabs?.querySelectorAll(".mind-preview-tab").forEach((b, i) => b.toggleClass("is-active", this.paths[i] === this.stack[0]));
    this.head.empty();
    if (this.stack.length > 1) {
      const back = this.head.createEl("button", { cls: "mind-preview-back", attr: { "aria-label": t("back") } });
      setIcon(back, "arrow-left");
      back.createSpan({ text: this.title(this.stack[this.stack.length - 2]) });
      back.onclick = () => { this.stack.pop(); void this.show(); };
    }
    this.head.createEl("h3", { text: this.title(path) });
    this.body.empty();
    const f = this.app.vault.getAbstractFileByPath(path);
    if (!(f instanceof TFile)) {
      this.body.createDiv({ text: t("notWritten", { t: this.title(path) }), cls: "mind-muted" });
      return;
    }
    const text = await this.app.vault.cachedRead(f);
    await MarkdownRenderer.render(this.app, text, this.body, f.path, this.component);
    this.body.scrollTop = 0;
  }

  /** A [[link]] inside the preview opens inside the preview, with a way back. */
  private onBodyClick(e: MouseEvent): void {
    const a = (e.target as HTMLElement).closest("a.internal-link") as HTMLAnchorElement | null;
    if (!a) return;
    e.preventDefault();
    e.stopPropagation();
    const href = a.getAttribute("data-href") ?? a.getAttribute("href") ?? "";
    const from = this.stack[this.stack.length - 1];
    const dest = this.app.metadataCache.getFirstLinkpathDest(href.split("#")[0], from);
    this.stack.push(dest ? dest.path : href);
    void this.show();
  }

  private async openFull(): Promise<void> {
    const path = this.stack[this.stack.length - 1];
    const f = this.app.vault.getAbstractFileByPath(path);
    this.close();
    // A new tab, so the plugin screen you came from stays one tap away.
    if (f instanceof TFile) await this.app.workspace.getLeaf("tab").openFile(f);
  }

  onClose(): void {
    this.component.unload();
    this.contentEl.empty();
  }
}
