// "Почему они связаны?" / "Чому вони пов'язані?" — writes one plain line into the note, only on the user's button.

import { App, Modal, Notice, TFile } from "obsidian";
import { applyExplanation, explanationSuffix } from "../core/links";
import { SECTION_NAMES, confidences, kinds, t } from "../i18n";
import { PreviewModal } from "./preview";
import type MindPlugin from "../main";

export class LinkModal extends Modal {
  private kind = kinds()[0];
  private confidence = confidences()[1];
  private statement = "";

  constructor(app: App, private from: TFile, private toTitle: string, private onDone?: () => void, private plugin?: MindPlugin) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    this.modalEl.addClass("mind-link-modal");
    contentEl.createEl("h3", { text: t("modalTitle") });
    const pair = contentEl.createDiv("mind-pair");
    const to = this.app.metadataCache.getFirstLinkpathDest(this.toTitle, this.from.path);
    const peek = (el: HTMLElement, path: string | undefined) => {
      if (!path) return;
      el.addClass("mind-peek");
      el.onclick = () => new PreviewModal(this.app, to ? [path, path === to.path ? this.from.path : to.path] : [path],
        (p) => this.plugin?.remember(p)).open();
    };
    peek(pair.createSpan({ text: this.from.basename }), this.from.path);
    pair.createSpan({ text: " → ", cls: "mind-muted" });
    peek(pair.createSpan({ text: this.toTitle, cls: "mind-accent" }), to?.path);
    if (to) contentEl.createDiv({ text: t("tapToPeek"), cls: "mind-muted mind-small" });

    contentEl.createDiv({ text: t("kindLabel"), cls: "mind-label" });
    const preview = () => this.renderPreview(previewEl, save);
    this.chips(contentEl, kinds(), this.kind, (k) => { this.kind = k; preview(); });

    const label = contentEl.createEl("label", { text: t("whyLabel"), cls: "mind-label" });
    label.htmlFor = "mind-why";
    const ta = contentEl.createEl("textarea", { cls: "mind-why" });
    ta.id = "mind-why";
    ta.rows = 3;
    ta.placeholder = t("whyPlaceholder");
    ta.oninput = () => { this.statement = ta.value; preview(); };

    contentEl.createDiv({ text: t("confLabel"), cls: "mind-label" });
    this.chips(contentEl, confidences(), this.confidence, (c) => { this.confidence = c; preview(); });

    contentEl.createDiv({ text: t("previewLabel"), cls: "mind-muted mind-small" });
    const previewEl = contentEl.createEl("pre", { cls: "mind-preview" });

    const row = contentEl.createDiv("mind-row");
    const save = row.createEl("button", { text: t("save"), cls: "mod-cta" });
    save.onclick = () => void this.write();
    const cancel = row.createEl("button", { text: t("cancel") });
    cancel.onclick = () => this.close();
    preview();
    window.setTimeout(() => ta.focus(), 50);
  }

  private chips(parent: HTMLElement, values: string[], active: string, pick: (v: string) => void): void {
    const box = parent.createDiv("mind-chips");
    for (const v of values) {
      const b = box.createEl("button", { text: v, cls: "mind-chip" });
      if (v === active) b.addClass("is-active");
      b.onclick = () => {
        box.querySelectorAll(".mind-chip").forEach((x) => x.removeClass("is-active"));
        b.addClass("is-active");
        pick(v);
      };
    }
  }

  private renderPreview(el: HTMLElement, save: HTMLButtonElement): void {
    const s = this.statement.trim() || "…";
    el.setText(`[[${this.toTitle}]] — ${explanationSuffix(this.kind, s, this.confidence)}`);
    save.disabled = !this.statement.trim();
  }

  private async write(): Promise<void> {
    if (!this.statement.trim()) return;
    const suffix = explanationSuffix(this.kind, this.statement, this.confidence);
    const heading = t("section");
    const result: { mode: "line" | "append" } = { mode: "append" };
    await this.app.vault.process(this.from, (text) => {
      const r = applyExplanation(text, this.toTitle, suffix, heading, SECTION_NAMES);
      result.mode = r.mode;
      return r.text;
    });
    new Notice(result.mode === "line" ? t("savedLine") : t("savedAppend", { h: heading }));
    this.close();
    this.onDone?.();
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
