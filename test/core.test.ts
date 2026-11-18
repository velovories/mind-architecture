import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, basename } from "node:path";
import { analyzeLinkLines, applyExplanation, explanationSuffix, linkTarget } from "../src/core/links.ts";
import { SimilarityIndex, tokenize, type Doc } from "../src/core/similarity.ts";
import { computeStats, type NoteInfo } from "../src/core/stats.ts";

// ---------- link lines ----------

test("bare list links are not explained, sentences are", () => {
  const text = "Вступление\n\n[[Кошки]]\n1. [[Собаки]]\nСвязано с [[Птицы]] потому что все они животные\n";
  const l = analyzeLinkLines(text);
  assert.equal(l.length, 3);
  assert.deepEqual(l.map((x) => x.explained), [false, false, true]);
  assert.equal(l[2].targets[0], "Птицы");
});

test("frontmatter is skipped and line numbers stay true", () => {
  const text = "---\ntags: [a]\nrelated: \"[[X]]\"\n---\nтекст\n[[Y]]\n";
  const l = analyzeLinkLines(text);
  assert.equal(l.length, 1);
  assert.equal(l[0].targets[0], "Y");
  assert.equal(text.split("\n")[l[0].line], "[[Y]]");
});

test("alias, heading and NFD forms resolve to the same target", () => {
  const nfd = "Мой путь".normalize("NFD");
  assert.equal(linkTarget(`${nfd}|алиас`), "Мой путь");
  assert.equal(linkTarget("Заметка#Раздел"), "Заметка");
});

test("explaining a bare link edits only that line, keeps marker and alias", () => {
  const text = "Текст.\n\n2. [[Глава первая|раздел]].\n[[Другое]]\n\nDate: 20.08.2025";
  const r = applyExplanation(text, "Глава первая", explanationSuffix("часть целого", "одна из глав", "мой вывод"));
  assert.equal(r.mode, "line");
  const lines = r.text.split("\n");
  assert.equal(lines[2], "2. [[Глава первая|раздел]] — часть целого: одна из глав");
  assert.deepEqual([lines[0], lines[3], lines[5]], ["Текст.", "[[Другое]]", "Date: 20.08.2025"]);
  assert.equal(lines.length, text.split("\n").length);
});

test("a link inside a sentence is never rewritten; a new line goes under ## Связи", () => {
  const text = "Это то же что и [[Похожая идея]] по сути";
  const r = applyExplanation(text, "Похожая идея", explanationSuffix("аналогия", "  одно   и то же ", "гипотеза"));
  assert.equal(r.mode, "append");
  assert.ok(r.text.startsWith(text));
  assert.ok(r.text.endsWith("## Связи\n- [[Похожая идея]] — аналогия (гипотеза): одно и то же\n"));
});

test("an existing Связи section gets the new line at its end", () => {
  const text = "Текст\n\n## Связи\n- [[А]] — пример: x\n\n## Другое\nтам";
  const r = applyExplanation(text, "Б", "дополнение: y");
  assert.equal(r.text, "Текст\n\n## Связи\n- [[А]] — пример: x\n- [[Б]] — дополнение: y\n\n## Другое\nтам");
});

test("CRLF notes keep CRLF", () => {
  const r = applyExplanation("а\r\n[[Б]]\r\nв", "Б", "пример: z");
  assert.equal(r.text, "а\r\n[[Б]] — пример: z\r\nв");
});

test("tokenize groups word forms and drops links and stop words", () => {
  const t = tokenize("Искажение искажения искажений [[Ссылка тут]] это когнитивное");
  assert.equal(t.get("искаже")?.n, 3);
  assert.ok(!t.has("ссылка"));
  assert.ok(!t.has("это"));
});

// ---------- a real vault (local only) ----------
// MIND_VAULT=/path/to/vault npm test — checks the core against real notes without naming any of them here.

const VAULT = process.env.MIND_VAULT ?? "";

function loadVault(): { docs: Doc[]; infos: NoteInfo[] } {
  const files: string[] = [];
  const walk = (d: string) => {
    for (const f of readdirSync(d)) {
      if (f.startsWith(".")) continue;
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (f.endsWith(".md")) files.push(p);
    }
  };
  walk(VAULT);
  const byName = new Map(files.map((p) => [basename(p, ".md").normalize("NFC").toLowerCase(), p]));
  const docs: Doc[] = [];
  const raw = new Map<string, { text: string; out: string[]; unresolved: string[] }>();
  for (const p of files) {
    const text = readFileSync(p, "utf8");
    const out: string[] = [], unresolved: string[] = [];
    for (const l of analyzeLinkLines(text)) for (const t of l.targets) {
      const hit = byName.get(t.toLowerCase());
      if (hit) out.push(hit); else unresolved.push(t);
    }
    raw.set(p, { text, out, unresolved });
    docs.push({ path: p, title: basename(p, ".md").normalize("NFC"), text, links: new Set(out) });
  }
  const inCount = new Map<string, number>();
  for (const { out } of raw.values()) for (const t of new Set(out)) inCount.set(t, (inCount.get(t) ?? 0) + 1);
  const infos = files.map((p) => ({
    path: p, title: basename(p, ".md").normalize("NFC"), text: raw.get(p)!.text,
    outResolved: raw.get(p)!.out, unresolved: raw.get(p)!.unresolved, inCount: inCount.get(p) ?? 0,
  }));
  return { docs, infos };
}

test("real vault: every planned link really has no note (NFD/NFC safe)", { skip: !VAULT || !existsSync(VAULT) }, () => {
  const { infos } = loadVault();
  const names = new Set(infos.map((n) => n.title.toLowerCase()));
  const s = computeStats(infos);
  console.log("stats", { notes: s.notes, explained: s.explained, bare: s.bare, conclusions: s.conclusions, orphans: s.orphans.length, planned: s.planned.length });
  for (const p of s.planned) assert.ok(!names.has(p.name.toLowerCase()), `resolves but counted as planned: ${p.name}`);
  assert.equal(s.explained + s.bare, s.linkLines);
});

test("real vault: suggestions and discovery pairs are never already linked", { skip: !VAULT || !existsSync(VAULT) }, () => {
  const { docs } = loadVault();
  const ix = new SimilarityIndex(docs);
  for (const d of docs) for (const s of ix.suggest(d.path, 3)) assert.ok(!ix.linked(d.path, s.path));
  const pairs = ix.discoveryPairs(() => false);
  console.log("discovery pairs:", pairs.length);
  for (const p of pairs) assert.ok(ix.distance(p.from, p.path) >= 3);
});

test("explanation shown to the user keeps link names and punctuation", () => {
  const [l] = analyzeLinkLines("1. Это то же что и [[Похожая идея]] и [[Вторая идея|привязанность]].");
  assert.equal(l.explanation, "Это то же что и Похожая идея и привязанность.");
});

test("a Ukrainian heading is created, and an existing Russian one is reused", () => {
  const made = applyExplanation("Текст", "Б", "приклад: z", "Зв'язки", ["Связи", "Зв'язки"]);
  assert.equal(made.text, "Текст\n\n## Зв'язки\n- [[Б]] — приклад: z\n");
  const reused = applyExplanation("Текст\n\n## Связи\n- [[А]] — пример: x", "Б", "приклад: z", "Зв'язки", ["Связи", "Зв'язки"]);
  assert.equal(reused.text, "Текст\n\n## Связи\n- [[А]] — пример: x\n- [[Б]] — приклад: z");
});

test("default confidence is not written in either language", () => {
  assert.equal(explanationSuffix("аналогія", "x", "мій висновок"), "аналогія: x");
  assert.equal(explanationSuffix("аналогия", "x", "гипотеза"), "аналогия (гипотеза): x");
});
