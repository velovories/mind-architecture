// Numbers about thinking, not about volume.

import { analyzeLinkLines } from "./links";

export interface NoteInfo {
  path: string;
  title: string;
  text: string;
  outResolved: string[];   // paths
  unresolved: string[];    // link names with no note
  inCount: number;         // notes linking here
}

export interface ThinkingStats {
  notes: number;
  conclusions: number;
  linkLines: number;
  explained: number;
  bare: number;
  orphans: string[];
  planned: { name: string; mentions: number }[];
  mostBare?: { path: string; title: string; bare: number };
}

export const CONCLUSION_RE = /^(вывод|выводы|первые выводы|мысль|мысли|связь|разница|теория|гипотеза|висновок|думка|зв'язок|різниця)(?=[\s,.:!?]|$)/iu;

export function computeStats(notes: NoteInfo[]): ThinkingStats {
  let linkLines = 0, explained = 0;
  let mostBare: ThinkingStats["mostBare"];
  const planned = new Map<string, number>();
  const orphans: string[] = [];
  let conclusions = 0;
  for (const n of notes) {
    if (CONCLUSION_RE.test(n.title)) conclusions++;
    const lines = analyzeLinkLines(n.text);
    let bareHere = 0;
    for (const l of lines) {
      linkLines++;
      if (l.explained) explained++;
      else bareHere += l.targets.length;
    }
    if (bareHere && (!mostBare || bareHere > mostBare.bare)) mostBare = { path: n.path, title: n.title, bare: bareHere };
    for (const u of n.unresolved) {
      if (/\.(png|jpe?g|gif|webp|pdf|mp3|mp4)$/i.test(u)) continue;
      planned.set(u, (planned.get(u) ?? 0) + 1);
    }
    if (!n.outResolved.length && !n.inCount && !n.unresolved.length) orphans.push(n.path);
  }
  return {
    notes: notes.length,
    conclusions,
    linkLines,
    explained,
    bare: linkLines - explained,
    orphans,
    planned: [...planned].map(([name, mentions]) => ({ name, mentions })).sort((a, b) => b.mentions - a.mentions),
    mostBare,
  };
}
