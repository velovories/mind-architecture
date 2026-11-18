// «Прогулка по картотеке» — Luhmann walked his slip-box instead of searching it.
// Start somewhere quiet, follow links for a few steps, then write down what you noticed.

import { App, Component, MarkdownRenderer, Modal, Notice, TFile, normalizePath } from "obsidian";
import type MindPlugin from "../main";
import { t } from "../i18n";

export class WalkModal extends Modal {
  private path: string[] = [];
  private component = new Component();

  constructor(app: App, private plugin: MindPlugin, private start: string) { super(app); }

  onOpen(): void {
    this.modalEl.addClass("mind-preview-modal");
    this.component.load();
    this.path = [this.start];
    void this.show();
  }

  private title(p: string): string {
    const f = this.app.vault.getAbstractFileByPath(p);
    return f instanceof TFile ? f.basename : p;
  }

  private async show(): Promise<void> {
    const c = this.contentEl;
    c.empty();
    const here = this.path[this.path.length - 1];
    this.plugin.remember(here);
    const top = c.createDiv("mind-walk-top");
    top.createSpan({ text: t("walkStep", { n: this.path.length }), cls: "mind-badge" });
    top.createSpan({ text: this.path.map((p) => this.title(p)).join(" → "), cls: "mind-muted mind-small mind-walk-trail" });
    c.createEl("h3", { text: this.title(here) });
    const body = c.createDiv("mind-preview-body markdown-rendered");
    const f = this.app.vault.getAbstractFileByPath(here);
    if (f instanceof TFile) await MarkdownRenderer.render(this.app, await this.app.vault.cachedRead(f), body, f.path, this.component);
    body.addEventListener("click", (e) => {
      const a = (e.target as HTMLElement).closest("a.internal-link");
      if (!a) return;
      e.preventDefault(); e.stopPropagation();
      const dest = this.app.metadataCache.getFirstLinkpathDest((a.getAttribute("data-href") ?? "").split("#")[0], here);
      if (dest) { this.path.push(dest.path); void this.show(); }
    });

    const next = [...(this.plugin.model.index?.neighbours(here) ?? [])].filter((p) => !this.path.includes(p));
    c.createDiv({ text: next.length ? t("walkNext") : t("walkDead"), cls: "mind-label" });
    const chips = c.createDiv("mind-chips");
    for (const p of next.slice(0, 8)) {
      const b = chips.createEl("button", { text: this.title(p), cls: "mind-chip" });
      b.onclick = () => { this.path.push(p); void this.show(); };
    }
    const row = c.createDiv("mind-row mind-preview-actions");
    if (this.path.length > 1) row.createEl("button", { text: t("back") }).onclick = () => { this.path.pop(); void this.show(); };
    const fin = row.createEl("button", { text: t("walkFinish"), cls: this.path.length >= 5 ? "mod-cta" : "" });
    fin.onclick = () => this.finish();
  }

  private finish(): void {
    const c = this.contentEl;
    c.empty();
    c.createEl("h3", { text: t("walkAsk") });
    c.createDiv({ text: this.path.map((p) => this.title(p)).join(" → "), cls: "mind-muted mind-small" });
    const ta = c.createEl("textarea", { cls: "mind-why", attr: { "aria-label": t("walkAsk") } });
    ta.rows = 5;
    const row = c.createDiv("mind-row");
    row.createEl("button", { text: t("walkSave"), cls: "mod-cta" }).onclick = () => void this.save(ta.value.trim());
    row.createEl("button", { text: t("close") }).onclick = () => this.close();
    window.setTimeout(() => ta.focus(), 50);
  }

  private async save(text: string): Promise<void> {
    const d = new Date().toLocaleDateString("ru-RU");
    const name = t("walkName", { d }).replace(/[\\/:*?"<>|#^[\]]/g, " ");
    let path = normalizePath(`${name}.md`), n = 2;
    while (this.app.vault.getAbstractFileByPath(path)) path = normalizePath(`${name} ${n++}.md`);
    const body = `${text}\n\n## ${t("walkPath")}\n${this.path.map((p, i) => `${i + 1}. [[${this.title(p)}]]`).join("\n")}\n\n${t("written", { d })}\n`;
    const file = await this.app.vault.create(path, body);
    new Notice(t("walkSaved"));
    this.close();
    await this.app.workspace.getLeaf("tab").openFile(file);
  }

  onClose(): void { this.component.unload(); this.contentEl.empty(); }
}

/** A quiet place to start: an orphan or a note not opened for a long time, different each day. */
export function walkStart(plugin: MindPlugin): string | undefined {
  const m = plugin.model;
  const recent = new Set(plugin.data.recent);
  const linked = [...m.files.keys()].filter((p) => (m.index?.neighbours(p).size ?? 0) > 0 && !recent.has(p));
  const pool = linked.length ? linked : [...m.files.keys()];
  if (!pool.length) return;
  pool.sort();
  return pool[Math.floor(Date.now() / 86_400_000) % pool.length];
}
