// The home screen: a greeting with the day's question and live tiles.
// A tile shows the thing itself; a tap opens it in place; «Открыть» goes to its full screen.

import { App, Modal, setIcon } from "obsidian";
import type MindPlugin from "../main";
import { analyzeLinkLines } from "../core/links";
import { pickForDay } from "../core/similarity";
import { TILE_IDS, type TileId } from "../model";
import { MindView, ListModal, type ListItem } from "./base";
import { VIEW_TODAY, VIEW_STATS, VIEW_ISLANDS } from "./views";
import { LinkModal } from "./link-modal";
import { CaptureModal } from "./capture";
import { WalkModal, walkStart } from "./walk";
import { ThoughtModal } from "./thought";
import { t } from "../i18n";

type Tile = { wide?: boolean; render: (el: HTMLElement, open: boolean) => void; full?: () => void };

export class HubView extends MindView {
  private expanded = new Set<TileId>();
  getViewType(): string { return VIEW_TODAY; }
  getDisplayText(): string { return "Mind Architecture"; }

  render(): void {
    const el = this.root();
    el.addClass("mind-hub");
    if (this.loading(el)) return;
    const tiles = this.tiles();
    const grid = el.createDiv("mind-tiles");
    for (const id of this.order()) {
      const tile = tiles[id];
      if (!tile) continue;
      const open = this.expanded.has(id);
      const box = grid.createDiv(`mind-tile2 ${tile.wide || open ? "is-wide" : ""} ${open ? "is-open" : ""} mind-tile-${id}`);
      tile.render(box, open);
      if (open && tile.full) {
        const b = box.createEl("button", { text: t("open"), cls: "mind-small-btn mind-open-full" });
        b.onclick = tile.full;
      }
    }
    const setup = el.createEl("button", { cls: "mind-setup" });
    setIcon(setup.createSpan("mind-card-icon"), "sliders-horizontal");
    setup.createSpan({ text: t("tilesSetup") });
    setup.onclick = () => new TileSettingsModal(this.app, this.plugin, () => this.safeRender()).open();
  }

  /** Saved order, minus hidden; with auto-order the time of day lifts a few tiles. */
  private order(): TileId[] {
    const cfg = this.plugin.data.tiles;
    let ids = cfg.order.filter((x) => !cfg.hidden.includes(x)) as TileId[];
    if (cfg.auto) {
      const h = new Date().getHours();
      const lift: TileId[] = h < 12 ? ["pair", "next"] : h >= 18 ? ["recent", "walk"] : [];
      const rest = ids.filter((x) => x !== "greeting" && !lift.includes(x));
      ids = [...(ids.includes("greeting") ? ["greeting" as TileId] : []), ...lift.filter((x) => ids.includes(x)), ...rest];
    }
    return ids;
  }

  private toggle(id: TileId): void {
    if (this.expanded.has(id)) this.expanded.delete(id); else this.expanded.add(id);
    this.safeRender();
  }

  /** Clickable tile header: icon, big number or title, subtitle. */
  private head(el: HTMLElement, id: TileId, icon: string, color: string, big: string, label: string, sub?: string): void {
    const h = el.createEl("button", { cls: "mind-tile2-head" });
    const top = h.createDiv("mind-tile2-top");
    const ic = top.createSpan("mind-card-icon");
    setIcon(ic, icon);
    ic.style.color = color;
    if (big) top.createSpan({ text: big, cls: "mind-tile2-n" });
    h.createDiv({ text: label, cls: "mind-tile2-title" });
    if (sub) h.createDiv({ text: sub, cls: "mind-muted mind-small" });
    h.onclick = () => this.toggle(id);
  }

  private tiles(): Partial<Record<TileId, Tile>> {
    const m = this.plugin.model;
    const index = m.index!, stats = m.stats!;
    const hour = new Date().getHours();
    const next = [
      ...m.questions.map((q) => ({ kind: "q" as const, text: q.text, path: q.path })),
      ...stats.planned.map((p) => ({ kind: "p" as const, text: p.name, path: "" })),
    ];
    const walkFrom = walkStart(this.plugin);

    return {
      greeting: {
        wide: true,
        render: (el) => {
          el.addClass("mind-greeting");
          el.createDiv({ text: hour < 12 ? t("goodMorning") : hour < 18 ? t("goodDay") : t("goodEvening"), cls: "mind-greet-title" });
          el.createDiv({ text: t("askToday"), cls: "mind-question" });
          const input = el.createEl("input", { type: "text", cls: "mind-cap-input", attr: { placeholder: t("topicPlaceholder"), "aria-label": t("capTopic") } });
          if (next.length) {
            el.createDiv({ text: t("orContinue"), cls: "mind-muted mind-small" });
            const chips = el.createDiv("mind-chips");
            for (const n of next.filter((x) => x.kind === "p").slice(0, 3)) {
              chips.createEl("button", { text: n.text, cls: "mind-chip" }).onclick = () => new CaptureModal(this.app, this.plugin, n.text).open();
            }
          }
          const go = el.createEl("button", { text: t("captureBtn"), cls: "mod-cta mind-wide-btn" });
          go.onclick = () => new CaptureModal(this.app, this.plugin, input.value.trim()).open();
        },
      },

      totals: {
        render: (el, open) => {
          const h = el.createEl("button", { cls: "mind-tile2-head" });
          const top = h.createDiv("mind-tile2-top");
          setIcon(top.createSpan("mind-card-icon"), "files");
          top.createSpan({ text: t("totals"), cls: "mind-card-head" });
          const row = h.createDiv("mind-totals");
          for (const [n, w] of [[stats.notes, t("notesW")], [m.words, t("wordsW")], [stats.linkLines, t("linksW")]] as [number, string][]) {
            const c = row.createDiv();
            c.createDiv({ text: n.toLocaleString("ru-RU"), cls: "mind-tile2-n" });
            c.createDiv({ text: w, cls: "mind-muted mind-small" });
          }
          h.onclick = () => this.toggle("totals");
          if (!open) return;
          const week = Date.now() - 7 * 86_400_000;
          let wn = 0, ww = 0, longest = { p: "", w: 0 };
          for (const [p, f] of m.files) {
            const words = (m.texts.get(p)?.match(/\S+/g) ?? []).length;
            if (f.stat.ctime >= week) { wn++; ww += words; }
            if (words > longest.w) longest = { p, w: words };
          }
          el.createDiv({ text: t("weekAdded", { n: wn, w: ww }), cls: "mind-small" });
          if (longest.p) {
            const l = el.createDiv("mind-small");
            this.noteLink(l, longest.p, t("longest", { t: index.title(longest.p), w: longest.w }));
          }
          el.createDiv({ text: t("templatesNote"), cls: "mind-muted mind-small" });
        },
      },

      pair: {
        wide: true,
        render: (el) => {
          const p = this.dayPair();
          const head = el.createDiv("mind-card-head is-warm-text");
          setIcon(head.createSpan("mind-card-icon"), "git-compare-arrows");
          head.createSpan({ text: t("pairTitle") });
          if (!p) { el.createDiv({ text: t("pairEmpty"), cls: "mind-muted mind-small" }); return; }
          const names = el.createDiv("mind-pair-list");
          this.noteLink(names.createDiv(), p.from, index.title(p.from), p.path);
          this.noteLink(names.createDiv(), p.path, index.title(p.path), p.from);
          el.createDiv({ text: t("pairWhyA") + p.shared.join(" · ") + t("pairWhyB"), cls: "mind-muted mind-small" });
          const row = el.createDiv("mind-row");
          row.createEl("button", { text: t("compare"), cls: "mod-cta" }).onclick = () => this.peek([p.from, p.path]);
          row.createEl("button", { text: t("writeThought") }).onclick = () => new ThoughtModal(this.app, this.plugin, p.from, p.path, p.shared).open();
          row.createEl("button", { text: t("link") }).onclick = () => {
            const f = m.files.get(p.from);
            if (f) new LinkModal(this.app, f, index.title(p.path), undefined, this.plugin).open();
          };
          row.createEl("button", { text: t("notThis") }).onclick = () => void m.reject(p.from, p.path);
        },
      },

      next: {
        render: (el, open) => {
          this.head(el, "next", "compass", "var(--color-blue)", String(next.length), t("nextTitle"), open ? undefined : t("nextSub"));
          if (!open) return;
          if (!next.length) { el.createDiv({ text: t("nextEmpty"), cls: "mind-muted mind-small" }); return; }
          const list = el.createDiv("mind-recent");
          for (const n of next.slice(0, 6)) {
            const b = list.createEl("button", { cls: "mind-recent-item" });
            b.createSpan({ text: n.kind === "q" ? t("kindQuestion") : t("kindTopic"), cls: "mind-badge" });
            b.createSpan({ text: n.text });
            b.onclick = () => n.kind === "q" ? this.peek([n.path]) : new CaptureModal(this.app, this.plugin, n.text).open();
          }
          if (next.length > 6) el.createDiv({ text: t("more", { n: next.length - 6 }), cls: "mind-muted mind-small" });
        },
        full: () => new ListModal(this.app, t("nextTitle"), next.map((n): ListItem => ({
          label: n.text, hint: n.kind === "q" ? t("kindQuestion") : t("kindTopic"),
          open: () => n.kind === "q" ? this.peek([n.path]) : new CaptureModal(this.app, this.plugin, n.text).open(),
        }))).open(),
      },

      islands: {
        render: (el, open) => {
          const isl = m.islands.islands;
          this.head(el, "islands", "map", "var(--color-green)", String(isl.length), t("islandsTitle"),
            open ? undefined : t("islandsSub", { n: isl.length, a: m.islands.alone.length }));
          if (!open) return;
          const chips = el.createDiv("mind-chips");
          for (const i of isl.slice(0, 8)) {
            const b = chips.createEl("button", { cls: "mind-island-chip" });
            b.createSpan({ cls: "mind-dot" }).style.background = m.islandColor(i);
            b.createSpan({ text: `${m.islandName(i)} · ${i.members.length}` });
            b.onclick = () => void this.plugin.open(VIEW_ISLANDS);
          }
        },
        full: () => void this.plugin.open(VIEW_ISLANDS),
      },

      walk: {
        render: (el, open) => {
          this.head(el, "walk", "footprints", "var(--color-green)", "", t("walkTitle"),
            walkFrom ? t("walkSub", { t: index.title(walkFrom) }) : undefined);
          if (!open || !walkFrom) return;
          el.createEl("button", { text: t("walkStart"), cls: "mod-cta mind-small-btn" }).onclick = () =>
            new WalkModal(this.app, this.plugin, walkFrom).open();
        },
      },

      bare: {
        render: (el, open) => {
          this.head(el, "bare", "link", "var(--color-pink)", String(stats.bare), t("bareTile"),
            stats.mostBare ? t("mostIn", { t: stats.mostBare.title }) : undefined);
          if (!open) return;
          const list = el.createDiv("mind-recent");
          for (const it of this.bareList().slice(0, 5)) {
            const b = list.createEl("button", { cls: "mind-recent-item" });
            b.createSpan({ text: it.label });
            b.createSpan({ text: it.hint ?? "", cls: "mind-muted mind-small" });
            b.onclick = () => void it.open();
          }
        },
        full: () => new ListModal(this.app, t("bareList"), this.bareList()).open(),
      },

      quality: {
        render: (el) => {
          const pct = stats.linkLines ? Math.round((100 * stats.explained) / stats.linkLines) : 0;
          this.head(el, "quality", "gauge", "var(--text-accent)", `${pct}%`, t("stats"));
          const bar = el.createDiv("mind-bar");
          bar.createDiv("mind-bar-fill").style.width = `${pct}%`;
        },
        full: () => void this.plugin.open(VIEW_STATS),
      },

      recent: {
        wide: true,
        render: (el) => {
          const head = el.createDiv("mind-card-head");
          setIcon(head.createSpan("mind-card-icon"), "history");
          head.createSpan({ text: t("recent") });
          const list = this.plugin.recent(3);
          if (!list.length) { el.createDiv({ text: t("recentEmpty"), cls: "mind-muted mind-small" }); return; }
          const box = el.createDiv("mind-recent");
          for (const p of list) {
            const b = box.createEl("button", { cls: "mind-recent-item" });
            setIcon(b.createSpan("mind-card-icon"), "file-text");
            b.createSpan({ text: index.title(p) });
            b.onclick = () => this.peek([p]);
          }
        },
      },
    };
  }

  /** The day's pair stays the same all day, even when new notes shift the candidate list. */
  private dayPair() {
    const m = this.plugin.model, index = m.index!;
    const today = new Date().toDateString();
    const saved = this.plugin.data.dayPair;
    const pairs = index.discoveryPairs(m.hidden);
    if (saved?.day === today) {
      const keep = pairs.find((p) => p.from === saved.a && p.path === saved.b);
      if (keep) return keep;
      if (m.files.has(saved.a) && m.files.has(saved.b) && !m.hidden(saved.a, saved.b) && !index.linked(saved.a, saved.b)) {
        const s = index.score(saved.a, saved.b);
        return { from: saved.a, path: saved.b, ...s };
      }
    }
    const p = pickForDay(pairs, new Date());
    if (p) {
      this.plugin.data.dayPair = { day: today, a: p.from, b: p.path };
      void this.plugin.saveData(this.plugin.data);
    }
    return p;
  }

  private bareList(): ListItem[] {
    const items: ListItem[] = [];
    for (const p of this.plugin.model.files.keys()) {
      const bare = analyzeLinkLines(this.plugin.textCache.get(p) ?? "").filter((l) => !l.explained).reduce((n, l) => n + l.targets.length, 0);
      if (bare) items.push({ label: this.plugin.model.index!.title(p), hint: t("bareN", { n: bare }), open: () => this.peek([p]), n: bare });
    }
    return items.sort((a, b) => (b.n ?? 0) - (a.n ?? 0));
  }


}

/** Reorder with arrows (works on a phone, unlike drag), hide with the eye, auto-order switch. */
class TileSettingsModal extends Modal {
  constructor(app: App, private plugin: MindPlugin, private done: () => void) { super(app); }

  onOpen(): void { this.draw(); }

  private draw(): void {
    const c = this.contentEl;
    c.empty();
    const cfg = this.plugin.data.tiles;
    c.createEl("h3", { text: t("tilesTitle") });
    const auto = c.createEl("label", { cls: "mind-check-row" });
    const cb = auto.createEl("input", { type: "checkbox" });
    cb.checked = cfg.auto;
    const txt = auto.createDiv();
    txt.createDiv({ text: t("autoOrder") });
    txt.createDiv({ text: t("autoOrderDesc"), cls: "mind-muted mind-small" });
    cb.onchange = () => { cfg.auto = cb.checked; void this.persist(); };

    const list = c.createDiv("mind-tile-list");
    cfg.order.forEach((id, i) => {
      const hidden = cfg.hidden.includes(id);
      const row = list.createDiv(`mind-tile-row ${hidden ? "is-hidden" : ""}`);
      row.createSpan({ text: t(`tile_${id}` as "tile_greeting") + (hidden ? t("hiddenMark") : ""), cls: "mind-tile-row-name" });
      const btn = (icon: string, label: string, fn: () => void, disabled = false) => {
        const b = row.createEl("button", { cls: "mind-icon-btn", attr: { "aria-label": label } });
        setIcon(b, icon);
        b.disabled = disabled;
        b.onclick = fn;
      };
      btn("arrow-up", t("up"), () => this.move(i, -1), i === 0);
      btn("arrow-down", t("down"), () => this.move(i, 1), i === cfg.order.length - 1);
      btn(hidden ? "eye-off" : "eye", hidden ? t("showTile") : t("hideTile"), () => {
        cfg.hidden = hidden ? cfg.hidden.filter((x) => x !== id) : [...cfg.hidden, id];
        void this.persist();
      });
    });
    c.createDiv({ text: t("hiddenNote"), cls: "mind-muted mind-small" });
    c.createDiv("mind-row").createEl("button", { text: t("close"), cls: "mod-cta" }).onclick = () => this.close();
  }

  private move(i: number, d: number): void {
    const o = this.plugin.data.tiles.order;
    [o[i], o[i + d]] = [o[i + d], o[i]];
    void this.persist();
  }

  private async persist(): Promise<void> {
    await this.plugin.saveData(this.plugin.data);
    this.draw();
    this.done();
  }

  onClose(): void { this.contentEl.empty(); }
}

export { TILE_IDS };
