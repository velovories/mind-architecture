// Islands: groups of notes that your own links hold together.
// Connected components first; a component too big to read at a glance is split with Louvain
// (modularity), deterministic so the map does not reshuffle between opens.

export interface Island {
  id: string;          // the hub's path — stable while the hub stays the hub
  hub: string;         // most connected note inside the island
  members: string[];   // paths, hub first, then by degree
}

export interface IslandMap {
  islands: Island[];   // two notes or more, biggest first
  alone: string[];     // notes with no link to any other note
}

type Adj = Map<string, Map<string, number>>;

function addEdge(adj: Adj, a: string, b: string, w = 1): void {
  if (a === b) return;
  if (!adj.has(a)) adj.set(a, new Map());
  if (!adj.has(b)) adj.set(b, new Map());
  adj.get(a)!.set(b, (adj.get(a)!.get(b) ?? 0) + w);
  adj.get(b)!.set(a, (adj.get(b)!.get(a) ?? 0) + w);
}

function components(nodes: string[], adj: Adj): string[][] {
  const seen = new Set<string>();
  const out: string[][] = [];
  for (const n of nodes) {
    if (seen.has(n)) continue;
    const comp: string[] = [];
    const stack = [n];
    seen.add(n);
    while (stack.length) {
      const x = stack.pop()!;
      comp.push(x);
      for (const y of adj.get(x)?.keys() ?? []) if (!seen.has(y)) { seen.add(y); stack.push(y); }
    }
    out.push(comp.sort());
  }
  return out;
}

/** One-graph Louvain: local moves, then aggregate, until nothing changes. Returns groups of original nodes. */
export function louvain(nodes: string[], adj: Adj): string[][] {
  // `self` keeps the weight that became internal after aggregation; without it merged groups look
  // weightless and everything collapses back into one island.
  let level: { nodes: string[]; adj: Adj; self: Map<string, number>; members: Map<string, string[]> } = {
    nodes: [...nodes].sort(),
    adj,
    self: new Map(),
    members: new Map(nodes.map((n) => [n, [n]])),
  };
  for (let pass = 0; pass < 10; pass++) {
    const { nodes: ns, adj: g, self } = level;
    const k = new Map(ns.map((n) => [n, [...(g.get(n)?.values() ?? [])].reduce((a, b) => a + b, 0) + (self.get(n) ?? 0)]));
    const m2 = [...k.values()].reduce((a, b) => a + b, 0);
    if (!m2) break;
    const comm = new Map(ns.map((n) => [n, n]));
    const tot = new Map(ns.map((n) => [n, k.get(n)!]));
    let moved = true, anyMove = false, guard = 0;
    while (moved && guard++ < 50) {
      moved = false;
      for (const n of ns) {
        const cur = comm.get(n)!;
        const kn = k.get(n)!;
        const toComm = new Map<string, number>();
        for (const [nb, w] of g.get(n) ?? []) {
          if (nb === n) continue;
          const c = comm.get(nb)!;
          toComm.set(c, (toComm.get(c) ?? 0) + w);
        }
        tot.set(cur, tot.get(cur)! - kn);
        let best = cur;
        let bestGain = (toComm.get(cur) ?? 0) - (tot.get(cur)! * kn) / m2;
        for (const [c, w] of [...toComm].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
          const gain = w - (tot.get(c)! * kn) / m2;
          if (gain > bestGain + 1e-12) { bestGain = gain; best = c; }
        }
        tot.set(best, tot.get(best)! + kn);
        if (best !== cur) { comm.set(n, best); moved = true; anyMove = true; }
      }
    }
    if (!anyMove) break;
    // aggregate
    const groups = new Map<string, string[]>();
    for (const n of ns) {
      const c = comm.get(n)!;
      if (!groups.has(c)) groups.set(c, []);
      groups.get(c)!.push(n);
    }
    const nextAdj: Adj = new Map();
    const nextSelf = new Map<string, number>();
    for (const [n, w] of self) { const c = comm.get(n)!; nextSelf.set(c, (nextSelf.get(c) ?? 0) + w); }
    for (const [a, nbs] of g) for (const [b, w] of nbs) {
      if (a >= b) continue;
      const ca = comm.get(a)!, cb = comm.get(b)!;
      if (ca !== cb) addEdge(nextAdj, ca, cb, w);
      else nextSelf.set(ca, (nextSelf.get(ca) ?? 0) + 2 * w);
    }
    for (const c of groups.keys()) if (!nextAdj.has(c)) nextAdj.set(c, new Map());
    const nextMembers = new Map<string, string[]>();
    for (const [c, list] of groups) nextMembers.set(c, list.flatMap((x) => level.members.get(x)!));
    level = { nodes: [...groups.keys()].sort(), adj: nextAdj, self: nextSelf, members: nextMembers };
    if (groups.size === ns.length) break;
  }
  return level.nodes.map((n) => level.members.get(n)!.sort());
}

/**
 * @param nodes   every note path
 * @param links   pairs of linked paths (direction ignored)
 * @param splitAbove  components larger than this are split into communities
 */
export function findIslands(nodes: string[], links: [string, string][], splitAbove = 20): IslandMap {
  const adj: Adj = new Map();
  for (const n of nodes) adj.set(n, new Map());
  for (const [a, b] of links) if (adj.has(a) && adj.has(b) && a !== b) {
    // one edge per pair: links in both directions are still one connection
    if (!adj.get(a)!.has(b)) addEdge(adj, a, b);
  }
  const degree = (n: string) => adj.get(n)?.size ?? 0;
  const islands: Island[] = [];
  const alone: string[] = [];
  for (const comp of components([...nodes].sort(), adj)) {
    if (comp.length === 1) { alone.push(comp[0]); continue; }
    const parts = comp.length > splitAbove
      ? louvain(comp, new Map(comp.map((n) => [n, adj.get(n)!])))
      : [comp];
    for (const p of parts) {
      const members = [...p].sort((a, b) => degree(b) - degree(a) || (a < b ? -1 : 1));
      if (members.length === 1) { alone.push(members[0]); continue; }
      islands.push({ id: members[0], hub: members[0], members });
    }
  }
  islands.sort((a, b) => b.members.length - a.members.length || (a.hub < b.hub ? -1 : 1));
  return { islands, alone: alone.sort() };
}

/** Carry a user's island names over when islands shift: same name if half the notes are the same. */
export function matchNames(islands: Island[], saved: { members: string[]; name: string }[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const s of saved) {
    const set = new Set(s.members);
    let best: Island | undefined, bestJ = 0;
    for (const isl of islands) {
      const inter = isl.members.filter((m) => set.has(m)).length;
      const j = inter / (set.size + isl.members.length - inter);
      if (j > bestJ) { bestJ = j; best = isl; }
    }
    if (best && bestJ >= 0.5 && !out.has(best.id)) out.set(best.id, s.name);
  }
  return out;
}

// ---------------- branches: where a note fans out ----------------

export interface BranchNode { path: string; explanation?: string; children: { path: string; explanation?: string }[] }

export interface Branches {
  root: string;
  first: BranchNode[];
  converge: { path: string; via: string[] }[];   // second-ring notes reached from two or more branches
}

export function branchesOf(
  root: string,
  neighbours: (p: string) => Iterable<string>,
  explain: (a: string, b: string) => string | undefined,
): Branches {
  const firstSet = new Set(neighbours(root));
  firstSet.delete(root);
  const via = new Map<string, string[]>();
  const first: BranchNode[] = [...firstSet].sort().map((p) => {
    const children = [...neighbours(p)]
      .filter((c) => c !== root && !firstSet.has(c))
      .sort()
      .map((c) => {
        if (!via.has(c)) via.set(c, []);
        via.get(c)!.push(p);
        return { path: c, explanation: explain(p, c) };
      });
    return { path: p, explanation: explain(root, p), children };
  });
  // explained branches first, then the busiest
  first.sort((a, b) => Number(!!b.explanation) - Number(!!a.explanation) || b.children.length - a.children.length);
  const converge = [...via].filter(([, v]) => v.length >= 2).map(([path, v]) => ({ path, via: v }))
    .sort((a, b) => b.via.length - a.via.length);
  return { root, first, converge };
}

// ---------------- open questions written in notes ----------------

const QUESTION_HEADINGS = /^#{1,6}\s+(вопросы|какие вопросы остались\??|открытые вопросы|питання|які питання лишилися\??|відкриті питання)\s*$/i;

/** List items under a "Вопросы" / "Питання" heading. */
export function openQuestions(text: string): string[] {
  const out: string[] = [];
  let inside = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^#{1,6}\s/.test(line)) { inside = QUESTION_HEADINGS.test(line.trim()); continue; }
    if (!inside) continue;
    const m = /^\s*(?:[-*+]|\d+[.)])\s+(?:\[ \]\s+)?(.+?)\s*$/.exec(line);
    if (m && m[1].length > 3) out.push(m[1]);
  }
  return out;
}
