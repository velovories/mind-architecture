// Link lines: which [[links]] carry an explanation, and how to write one.
// Pure functions — no Obsidian API — so they are tested against the real vault in Node.

export interface LinkLine {
  line: number;          // 0-based line index in the note
  targets: string[];     // link targets as written (before | and #), NFC
  explained: boolean;    // the line says something besides the links
  explanation: string;   // the line with links and list markers removed
}

/** Confidence words that mean "my own conclusion" — the default, so it is not written out. */
const DEFAULT_CONFIDENCE = new Set(["мой вывод", "мій висновок"]);

const LINK_RE = /!?\[\[([^\]]+)\]\]/g;
const MIN_WORDS = 3;

export const nfc = (s: string) => s.normalize("NFC");

/** "Target|alias" or "Target#heading" → "Target" */
export function linkTarget(inner: string): string {
  return nfc(inner.split("|")[0].split("#")[0].trim());
}

export function stripFrontmatter(text: string): { body: string; offset: number } {
  if (!text.startsWith("---")) return { body: text, offset: 0 };
  const m = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(text);
  if (!m) return { body: text, offset: 0 };
  return { body: text.slice(m[0].length), offset: m[0].split("\n").length - 1 };
}

function restOfLine(line: string): string {
  return line
    .replace(LINK_RE, " ")
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "")   // list marker
    .replace(/^\s*>\s?/, "")                    // quote
    .replace(/[\s.,;:—–\-]+/g, " ")
    .trim();
}

/** The line as a person reads it: [[A|b]] → b, [[A]] → A, list marker gone, punctuation kept. */
function readable(line: string): string {
  return line
    .replace(/!?\[\[([^\]]+)\]\]/g, (_, inner: string) => {
      const [target, alias] = inner.split("|");
      return (alias ?? target.split("#")[0]).trim();
    })
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "")
    .replace(/^\s*>\s?/, "")
    .trim();
}

export function analyzeLinkLines(text: string): LinkLine[] {
  const { body, offset } = stripFrontmatter(text);
  const out: LinkLine[] = [];
  body.split("\n").forEach((line, i) => {
    const targets = [...line.matchAll(LINK_RE)]
      .filter((m) => !m[0].startsWith("!"))     // embeds are not thinking links
      .map((m) => linkTarget(m[1]));
    if (!targets.length) return;
    const rest = restOfLine(line);
    const words = rest.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w));
    out.push({ line: i + offset, targets, explained: words.length >= MIN_WORDS, explanation: readable(line) });
  });
  return out;
}

/** The text that goes after the link: "аналогия (гипотеза): ..." */
export function explanationSuffix(kind: string, statement: string, confidence: string): string {
  const conf = DEFAULT_CONFIDENCE.has(confidence) ? "" : ` (${confidence})`;
  const s = statement.trim().replace(/\s+/g, " ");
  return `${kind}${conf}: ${s}`;
}

/**
 * Write an explanation for the link note→target.
 * - If a line holds that link and nothing else (a bare list item), the explanation is appended to that line,
 *   keeping its list marker and the link exactly as written.
 * - Otherwise a new line "- [[target]] — …" is added under the links heading at the end
 *   (an existing heading with any of `known` names is reused, else `heading` is created).
 * Everything else in the note stays byte-for-byte the same.
 */
export function applyExplanation(
  text: string, target: string, suffix: string, heading = "Связи", known: string[] = [heading],
): { text: string; mode: "line" | "append" } {
  const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const headRe = new RegExp(`^#{1,6}\\s+(?:${[heading, ...known].map(esc).join("|")})\\s*$`);
  const want = nfc(target).toLowerCase();
  const nl = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  const { offset } = stripFrontmatter(text);
  for (let i = offset; i < lines.length; i++) {
    const line = lines[i];
    const links = [...line.matchAll(LINK_RE)].filter((m) => !m[0].startsWith("!"));
    if (links.length !== 1 || linkTarget(links[0][1]).toLowerCase() !== want) continue;
    if (restOfLine(line).length > 0) continue;            // the line already says something: leave it alone
    lines[i] = line.replace(/[\s.,;:]+$/, "") + " — " + suffix;
    return { text: lines.join(nl), mode: "line" };
  }
  const entry = `- [[${target}]] — ${suffix}`;
  const hasHeading = lines.some((l) => headRe.test(l));
  let body = text.replace(/\s+$/, "");
  if (hasHeading) {
    // add right after the last line of the existing links section
    const idx = lines.findIndex((l) => headRe.test(l));
    let end = idx + 1;
    while (end < lines.length && !/^#{1,6}\s/.test(lines[end])) end++;
    while (end > idx + 1 && lines[end - 1].trim() === "") end--;
    lines.splice(end, 0, entry);
    return { text: lines.join(nl), mode: "append" };
  }
  body += `${nl}${nl}## ${heading}${nl}${entry}${nl}`;
  return { text: body, mode: "append" };
}
