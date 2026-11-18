// «Что я сегодня узнал» — the daily note, with connections made while the thought is fresh.

import { App, Modal, Notice, TFile, debounce, normalizePath } from "obsidian";
import type MindPlugin from "../main";
import { explanationSuffix } from "../core/links";
import { confidences, kinds, t } from "../i18n";
import { PreviewModal } from "./preview";

interface Link { title: string; path: string; suffix?: string }

export class CaptureModal extends Modal {
  private links: Link[] = [];
  private fields: Record<string, HTMLTextAreaElement | HTMLInputElement> = {};
  private sugBox!: HTMLElement;

  constructor(app: App, private plugin: MindPlugin, private topic = "") {
    super(app);
  }

  onOpen(): void {
    this.modalEl.addClass("mind-capture-modal");
    const c = this.contentEl;
    c.createEl("h3", { text: t("capTitle") });
    c.createDiv({ text: t("capOptional"), cls: "mind-muted mind-small" });

    this.fields.topic = this.input(c, t("capTopic"), this.topic);
    this.fields.learned = this.area(c, t("capLearned"), 4);
    this.fields.surprised = this.area(c, t("capSurprised"), 2);
    this.fields.understood = this.area(c, t("capUnderstood"), 2);

    c.createDiv({ text: t("capConnect"), cls: "mind-label" });
    c.createDiv({ text: t("capConnectHint"), cls: "mind-muted mind-small" });
    this.sugBox = c.createDiv("mind-cap-sug");

    this.fields.questions = this.area(c, t("capQuestions"), 2);
    this.fields.source = this.input(c, t("capSource"), "");

    const row = c.createDiv("mind-row");
    const save = row.createEl("button", { text: t("capSave"), cls: "mod-cta" });
    save.onclick = () => void this.save();
    const cancel = row.createEl("button", { text: t("cancel") });
    cancel.onclick = () => this.close();

    const refresh = debounce(() => this.suggest(), 400, true);
    for (const k of ["topic", "learned", "surprised", "understood"]) this.fields[k].addEventListener("input", refresh);
    this.suggest();
    window.setTimeout(() => (this.topic ? this.fields.learned : this.fields.topic).focus(), 50);
  }

  private input(parent: HTMLElement, label: string, value: string): HTMLInputElement {
    const id = `mind-cap-${Math.random().toString(36).slice(2)}`;
    const l = parent.createEl("label", { text: label, cls: "mind-label" });
    l.htmlFor = id;
    const i = parent.createEl("input", { type: "text", cls: "mind-cap-input" });
    i.id = id;
    i.value = value;
    return i;
  }

  private area(parent: HTMLElement, label: string, rows: number): HTMLTextAreaElement {
    const id = `mind-cap-${Math.random().toString(36).slice(2)}`;
    const l = parent.createEl("label", { text: label, cls: "mind-label" });
    l.htmlFor = id;
    const a = parent.createEl("textarea", { cls: "mind-why" });
    a.id = id;
    a.rows = rows;
    return a;
  }

  private text(): string {
    return ["topic", "learned", "surprised", "understood"].map((k) => this.fields[k].value).join("\n");
  }

  private suggest(): void {
    const box = this.sugBox;
    box.empty();
    for (const l of this.links) {
      const r = box.createDiv("mind-link-card");
      r.createSpan({ text: `✓ ${l.title}`, cls: "mind-accent" });
      r.createDiv({ text: l.suffix ?? t("capLinked"), cls: "mind-muted mind-small" });
    }
    const index = this.plugin.model.index;
    if (!index || this.text().trim().length < 12) return;
    const taken = new Set(this.links.map((l) => l.path));
    const found = index.suggestText(this.text(), 3, 0.06, taken);
    if (!found.length && !this.links.length) box.createDiv({ text: t("capNoSimilar"), cls: "mind-muted mind-small" });
    for (const s of found) {
      const r = box.createDiv("mind-link-card");
      const a = r.createEl("a", { text: index.title(s.path), cls: "mind-note-link", href: "#" });
      a.onclick = (e) => { e.preventDefault(); new PreviewModal(this.app, [s.path], (p) => this.plugin.remember(p)).open(); };
      r.createDiv({ text: t("sharedWords", { w: s.shared.join(" · ") }), cls: "mind-muted mind-small" });
      const b = r.createEl("button", { text: t("link"), cls: "mind-small-btn" });
      b.onclick = () => new WhyModal(this.app, index.title(s.path), (suffix) => {
        this.links.push({ title: index.title(s.path), path: s.path, suffix });
        this.suggest();
      }).open();
    }
  }

  private async save(): Promise<void> {
    const topic = this.fields.topic.value.trim();
    if (!topic) { this.fields.topic.focus(); new Notice(t("capTopic")); return; }
    const v = (k: string) => this.fields[k].value.trim();
    const parts: string[] = [];
    const sec = (title: string, body: string) => { if (body) parts.push(`## ${title}\n${body}`); };
    sec(t("secLearned"), v("learned"));
    sec(t("secSurprised"), v("surprised"));
    sec(t("secUnderstood"), v("understood"));
    sec(t("secQuestions"), v("questions").split("\n").map((x) => x.trim()).filter(Boolean).map((x) => `- ${x}`).join("\n"));
    sec(t("secSources"), v("source") ? `- ${v("source")}` : "");
    sec(t("section"), this.links.map((l) => `- [[${l.title}]] — ${l.suffix}`).join("\n"));
    parts.push(t("written", { d: new Date().toLocaleDateString("ru-RU") }));
    const body = parts.join("\n\n") + "\n";

    // A planned topic keeps its exact name, so the links already pointing at it start working.
    const name = topic.replace(/[\\/:*?"<>|#^[\]]/g, " ").replace(/\s+/g, " ").trim().slice(0, 150);
    const folder = this.plugin.data.captureFolder.trim();
    const existing = this.app.metadataCache.getFirstLinkpathDest(name, "");
    let file: TFile;
    if (existing) {
      await this.app.vault.process(existing, (old) => old.replace(/\s*$/, "") + "\n\n" + body);
      file = existing;
      new Notice(t("capAppended", { t: name }));
    } else {
      if (folder && !this.app.vault.getAbstractFileByPath(folder)) await this.app.vault.createFolder(folder);
      file = await this.app.vault.create(normalizePath(folder ? `${folder}/${name}.md` : `${name}.md`), body);
      new Notice(t("capCreated", { t: name }));
    }
    this.close();
    await this.app.workspace.getLeaf("tab").openFile(file);
  }

  onClose(): void { this.contentEl.empty(); }
}

/** A small "why" step for a link made from the capture form. */
class WhyModal extends Modal {
  constructor(app: App, private title: string, private done: (suffix: string) => void) { super(app); }
  onOpen(): void {
    const c = this.contentEl;
    c.createEl("h3", { text: t("capWhy") });
    c.createDiv({ text: this.title, cls: "mind-accent" });
    let kind = kinds()[0], conf = confidences()[1];
    const chips = (vals: string[], cur: string, pick: (v: string) => void) => {
      const box = c.createDiv("mind-chips");
      for (const v of vals) {
        const b = box.createEl("button", { text: v, cls: "mind-chip" });
        if (v === cur) b.addClass("is-active");
        b.onclick = () => { box.querySelectorAll(".mind-chip").forEach((x) => x.removeClass("is-active")); b.addClass("is-active"); pick(v); };
      }
    };
    chips(kinds(), kind, (v) => (kind = v));
    const ta = c.createEl("textarea", { cls: "mind-why" });
    ta.rows = 2;
    ta.placeholder = t("whyPlaceholder");
    chips(confidences(), conf, (v) => (conf = v));
    const row = c.createDiv("mind-row");
    const ok = row.createEl("button", { text: t("save"), cls: "mod-cta" });
    ok.onclick = () => {
      if (!ta.value.trim()) { ta.focus(); return; }
      this.done(explanationSuffix(kind, ta.value, conf));
      this.close();
    };
    row.createEl("button", { text: t("cancel") }).onclick = () => this.close();
    window.setTimeout(() => ta.focus(), 50);
  }
  onClose(): void { this.contentEl.empty(); }
}
