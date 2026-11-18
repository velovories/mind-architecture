// Level 1 suggestions: shared rare words (TF-IDF over crude stems) and shared neighbours.
// Runs on the phone, sends nothing anywhere.

import { nfc, stripFrontmatter } from "./links";

export interface Doc {
  path: string;
  title: string;
  text: string;
  links: Set<string>; // resolved paths this note links to
}

export interface Suggestion {
  path: string;
  score: number;
  shared: string[];      // readable words both notes use
  neighbours: string[];  // paths both notes link with
}

const STOP = new Set(
  (
    "это этот эта эти того тому этом этой есть была были было быть будет может можно нужно надо " +
    "только тоже также даже если когда потому чтобы который которая которые которых своей своих свои " +
    "себя тебе меня мной очень более менее всего всех всем просто вообще почему какой какие какая кто " +
    "между через после перед около вместо здесь тогда сейчас потом всегда никогда опять ещё уже " +
    "человек человека люди людей вещи вещь пример например общем случае просто самое самый " +
    "date time написано дата время " +
    "також тому який яка які якщо коли щоб бути може треба дуже більше всього завжди тепер потім " +
    "його вона воно вони цей цього того свою свої своїх своє проте лише навіть саме тільки можна через після " +
    "перед кожен кожна людина людини людей люди життя ніколи досі тобто " +
    "этого этому этих тоже лично конкретно чему хотя хоть думаю думал сказать знаю понимать понял " +
    "чому хоча думаю думав сказати знаю розумію побачити побачили побачимо каже сказав якийсь насправді"
  ).split(/\s+/),
);
const STEM = 6;

export function tokenize(text: string): Map<string, { n: number; word: string }> {
  const body = stripFrontmatter(nfc(text)).body
    // template stamps like "Place: Lüneburg", "Date: 20.08.2025", "Написано: …" say nothing about the idea
    .replace(/^\s*(place|country|city|location|date|time|дата|время|место|написано|час|місце)\s*:.*$/gim, " ")
    .replace(/!?\[\[[^\]]*\]\]/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .toLowerCase();
  const out = new Map<string, { n: number; word: string }>();
  for (const w of body.match(/[a-zа-яёіїєґ]{4,}/g) ?? []) {
    if (STOP.has(w)) continue;
    const stem = w.slice(0, STEM);
    const cur = out.get(stem);
    if (cur) cur.n++;
    else out.set(stem, { n: 1, word: w });
  }
  return out;
}

export class SimilarityIndex {
  private vec = new Map<string, Map<string, number>>();
  private norm = new Map<string, number>();
  private words = new Map<string, Map<string, string>>();
  private docs = new Map<string, Doc>();
  private undirected = new Map<string, Set<string>>();

  constructor(docs: Doc[]) {
    const tfs = new Map<string, Map<string, { n: number; word: string }>>();
    const df = new Map<string, number>();
    for (const d of docs) {
      this.docs.set(d.path, d);
      const tf = tokenize(d.text);
      tfs.set(d.path, tf);
      for (const s of tf.keys()) df.set(s, (df.get(s) ?? 0) + 1);
      for (const t of d.links) {
        if (!this.undirected.has(d.path)) this.undirected.set(d.path, new Set());
        if (!this.undirected.has(t)) this.undirected.set(t, new Set());
        this.undirected.get(d.path)!.add(t);
        this.undirected.get(t)!.add(d.path);
      }
    }
    const N = docs.length || 1;
    for (const [path, tf] of tfs) {
      const v = new Map<string, number>();
      const w = new Map<string, string>();
      let sq = 0;
      for (const [s, { n, word }] of tf) {
        const d = df.get(s) ?? 0;
        if (d < 2 || d > N * 0.25) continue;   // unique words link nothing; everywhere-words mean nothing
        const x = (1 + Math.log(n)) * Math.log(N / d);
        v.set(s, x);
        w.set(s, word);
        sq += x * x;
      }
      this.vec.set(path, v);
      this.words.set(path, w);
      this.norm.set(path, Math.sqrt(sq) || 1);
    }
  }

  neighbours(path: string): Set<string> {
    return this.undirected.get(path) ?? new Set();
  }

  linked(a: string, b: string): boolean {
    return this.neighbours(a).has(b);
  }

  score(a: string, b: string): { score: number; shared: string[]; neighbours: string[] } {
    const va = this.vec.get(a), vb = this.vec.get(b);
    if (!va || !vb) return { score: 0, shared: [], neighbours: [] };
    const common: [string, number][] = [];
    let dot = 0;
    for (const [s, x] of va) {
      const y = vb.get(s);
      if (y === undefined) continue;
      dot += x * y;
      common.push([s, x * y]);
    }
    const na = this.neighbours(a), nb = this.neighbours(b);
    const neighbours = [...na].filter((p) => nb.has(p) && p !== a && p !== b);
    const textScore = dot / (this.norm.get(a)! * this.norm.get(b)!);
    const score = textScore + 0.08 * Math.min(neighbours.length, 3);
    common.sort((p, q) => q[1] - p[1]);
    const wa = this.words.get(a)!;
    return { score, shared: common.slice(0, 4).map(([s]) => wa.get(s)!), neighbours };
  }

  /** Unlinked notes most like `path`, strongest first. */
  suggest(path: string, limit = 3, minScore = 0.09, skip: (a: string, b: string) => boolean = () => false): Suggestion[] {
    const out: Suggestion[] = [];
    for (const other of this.docs.keys()) {
      if (other === path || this.linked(path, other) || skip(path, other)) continue;
      const s = this.score(path, other);
      if (s.score >= minScore && (s.shared.length >= 2 || s.neighbours.length)) out.push({ path: other, ...s });
    }
    return out.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  /** Graph distance, capped. */
  distance(a: string, b: string, cap = 3): number {
    if (a === b) return 0;
    let frontier = new Set([a]);
    const seen = new Set([a]);
    for (let d = 1; d <= cap; d++) {
      const next = new Set<string>();
      for (const p of frontier) for (const q of this.neighbours(p)) {
        if (q === b) return d;
        if (!seen.has(q)) { seen.add(q); next.add(q); }
      }
      frontier = next;
    }
    return cap + 1;
  }

  /**
   * A pair worth thinking about: similar in words but far apart in the graph (≥3 steps or unconnected),
   * and with different-looking titles. One pick per day from the top candidates.
   */
  discoveryPairs(skip: (a: string, b: string) => boolean, limit = 12): (Suggestion & { from: string })[] {
    const paths = [...this.docs.keys()];
    const cands: (Suggestion & { from: string })[] = [];
    for (let i = 0; i < paths.length; i++) for (let j = i + 1; j < paths.length; j++) {
      const a = paths[i], b = paths[j];
      if (this.linked(a, b) || skip(a, b)) continue;
      if (this.wordCount(a) < 40 || this.wordCount(b) < 40) continue;   // stubs make empty pairs
      const s = this.score(a, b);
      if (s.score < 0.1 || s.shared.length < 2 || s.neighbours.length) continue;
      if (titleOverlap(this.docs.get(a)!.title, this.docs.get(b)!.title)) continue;
      if (this.distance(a, b) < 3) continue;
      cands.push({ from: a, path: b, ...s });
    }
    return cands.sort((x, y) => y.score - x.score).slice(0, limit);
  }

  wordCount(path: string): number {
    return (this.docs.get(path)?.text.match(/\S+/g) ?? []).length;
  }

  title(path: string): string {
    return this.docs.get(path)?.title ?? path;
  }
}

function titleOverlap(a: string, b: string): boolean {
  const w = (t: string) => new Set((t.toLowerCase().match(/[a-zа-яёіїєґ]{4,}/g) ?? []).map((x) => x.slice(0, STEM)));
  const A = w(a);
  return [...w(b)].some((x) => A.has(x));
}

/** Stable pick for a given day. */
export function pickForDay<T>(items: T[], date: Date): T | undefined {
  if (!items.length) return undefined;
  const day = Math.floor(date.getTime() / 86_400_000);
  return items[day % items.length];
}
