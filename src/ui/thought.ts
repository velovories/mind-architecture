// A thought about two notes: free writing or a few guiding questions — a switch, remembered between uses.

import { App, Modal, Notice, normalizePath, setIcon } from "obsidian";
import type MindPlugin from "../main";
import { confidences, t } from "../i18n";
import { PreviewModal } from "./preview";

export type ThoughtMode = "free" | "guided";

export class ThoughtModal extends Modal {
  private mode: ThoughtMode;
  private values: Record<string, string> = { free: "", common: "", differ: "", conclusion: "" };
  private confidence = confidences()[1];
  private body!: HTMLElement;

  constructor(app: App, private plugin: MindPlugin, private a: string, private b: string, private shared: string[]) {
    super(app);
    this.mode = plugin.data.thoughtMode ?? "free";
  }

  private title(p: string): string {
    return this.plugin.model.index?.title(p) ?? p;
  }

  onOpen(): void {
    const c = this.contentEl;
    this.modalEl.addClass("mind-capture-modal");
    c.createEl("h3", { text: t("thTitle") });

    // the two notes, each opens over this window
    const pair = c.createDiv("mind-pair-list");
    for (const p of [this.a, this.b]) {
      const a = pair.createEl("a", { text: this.title(p), cls: "mind-note-link", href: "#" });
      a.onclick = (e) => { e.preventDefault(); new PreviewModal(this.app, p === this.a ? [this.a, this.b] : [this.b, this.a], (x) => this.plugin.remember(x)).open(); };
    }
    if (this.shared.length) c.createDiv({ text: t("sharedWords", { w: this.shared.join(" · ") }), cls: "mind-muted mind-small" });

    // the switch
    const sw = c.createDiv("mind-segment");
    sw.setAttr("role", "radiogroup");
    sw.setAttr("aria-label", t("thModeLabel"));
    const opts: [ThoughtMode, string, string][] = [["free", "pen-line", t("thFree")], ["guided", "list-checks", t("thGuided")]];
    for (const [m, icon, label] of opts) {
      const b = sw.createEl("button", { cls: `mind-segment-btn ${this.mode === m ? "is-active" : ""}`, attr: { role: "radio", "aria-checked": String(this.mode === m) } });
      setIcon(b.createSpan("mind-card-icon"), icon);
      b.createSpan({ text: label });
      b.onclick = () => {
        this.mode = m;
        this.plugin.data.thoughtMode = m;
        void this.plugin.saveData(this.plugin.data);
        sw.querySelectorAll(".mind-segment-btn").forEach((x, i) => {
          x.toggleClass("is-active", opts[i][0] === m);
          x.setAttr("aria-checked", String(opts[i][0] === m));
        });
        this.draw();
      };
    }

    const nameLabel = c.createEl("label", { text: t("thName"), cls: "mind-label" });
    nameLabel.htmlFor = "mind-th-name";
    const name = c.createEl("input", { type: "text", cls: "mind-cap-input" });
    name.id = "mind-th-name";
    name.value = t("thoughtName", { a: this.title(this.a), b: this.title(this.b) });

    this.body = c.createDiv("mind-th-body");
    this.draw();

    const row = c.createDiv("mind-row");
    row.createEl("button", { text: t("capSave"), cls: "mod-cta" }).onclick = () => void this.save(name.value.trim());
    row.createEl("button", { text: t("cancel") }).onclick = () => this.close();
  }

  /** Both modes keep what was typed, so switching never loses words. */
  private draw(): void {
    const el = this.body;
    el.empty();
    const area = (key: string, label: string, rows: number, placeholder = "") => {
      const id = `mind-th-${key}`;
      const l = el.createEl("label", { text: label, cls: "mind-label" });
      l.htmlFor = id;
      const ta = el.createEl("textarea", { cls: "mind-why" });
      ta.id = id;
      ta.rows = rows;
      ta.placeholder = placeholder;
      ta.value = this.values[key];
      ta.oninput = () => (this.values[key] = ta.value);
      return ta;
    };
    if (this.mode === "free") {
      const ta = area("free", t("thFreeLabel"), 9, t("thFreeHint"));
      window.setTimeout(() => ta.focus(), 30);
      return;
    }
    const first = area("common", t("thCommon"), 3);
    area("differ", t("thDiffer"), 3);
    area("conclusion", t("thConclusion"), 3);
    el.createDiv({ text: t("confLabel"), cls: "mind-label" });
    const box = el.createDiv("mind-chips");
    for (const v of confidences()) {
      const b = box.createEl("button", { text: v, cls: `mind-chip ${v === this.confidence ? "is-active" : ""}` });
      b.onclick = () => { this.confidence = v; box.querySelectorAll(".mind-chip").forEach((x) => x.toggleClass("is-active", x === b)); };
    }
    window.setTimeout(() => first.focus(), 30);
  }

  private async save(rawName: string): Promise<void> {
    const v = this.values;
    const hasText = this.mode === "free" ? v.free.trim() : (v.common + v.differ + v.conclusion).trim();
    if (!hasText) { new Notice(t("thEmpty")); return; }
    const A = this.title(this.a), B = this.title(this.b);
    const parts: string[] = [];
    if (this.mode === "free") {
      parts.push(v.free.trim());
    } else {
      const sec = (h: string, x: string) => { if (x.trim()) parts.push(`## ${h}\n${x.trim()}`); };
      sec(t("thCommon"), v.common);
      sec(t("thDiffer"), v.differ);
      const conf = this.confidence === confidences()[1] ? "" : ` (${this.confidence})`;
      sec(t("thConclusion") + conf, v.conclusion);
    }
    // the two sources, each with a reason, so they count as explained links
    parts.push(`## ${t("section")}\n- [[${A}]] — ${t("thSource")}\n- [[${B}]] — ${t("thSource")}`);
    parts.push(t("written", { d: new Date().toLocaleDateString("ru-RU") }));

    const base = (rawName || t("thoughtName", { a: A, b: B })).replace(/[\\/:*?"<>|#^[\]]/g, " ").replace(/\s+/g, " ").trim().slice(0, 150);
    let path = normalizePath(`${base}.md`), n = 2;
    while (this.app.vault.getAbstractFileByPath(path)) path = normalizePath(`${base} ${n++}.md`);
    const file = await this.app.vault.create(path, parts.join("\n\n") + "\n");
    new Notice(t("thoughtCreated"));
    this.close();
    await this.app.workspace.getLeaf("tab").openFile(file);
  }

  onClose(): void { this.contentEl.empty(); }
}
