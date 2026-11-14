// Pulls block JSON the model wrote into its prose back out of it.
//
// The chat reply is meant to be one JSON object, { blocks: [...] }. Sometimes
// the model writes its answer as plain prose instead and tacks the blocks on
// the end - "...if you tap \"Request viewing\".\n[{\"type\":\"followups\",
// \"suggestions\":[...]}]" - or puts that array inside a text block's body.
// Neither parses as a reply, so the renter saw the raw JSON as part of the
// answer. This finds such JSON, cuts it out of the prose and hands back the
// blocks it held, so they render as blocks.

const BLOCK_TYPES = new Set(['text', 'complex', 'district', 'distance', 'followups']);

const isBlock = (v: unknown): v is { type: string } =>
  !!v && typeof v === 'object' && !Array.isArray(v) &&
  typeof (v as any).type === 'string' && BLOCK_TYPES.has((v as any).type);

/** The blocks a parsed JSON value carries, or null when it is not blocks. */
function blocksOf(v: unknown): any[] | null {
  if (Array.isArray(v)) return v.length > 0 && v.every(isBlock) ? v : null;
  if (isBlock(v)) return [v];
  if (v && typeof v === 'object' && Array.isArray((v as any).blocks)) {
    const inner = (v as any).blocks;
    return inner.length > 0 && inner.every(isBlock) ? inner : null;
  }
  return null;
}

/** Index just past the JSON value opening at `start`, or -1 if unbalanced. */
function matchingClose(s: string, start: number): number {
  let depth = 0;
  let inString = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inString) {
      if (c === '\\') i++;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === '[' || c === '{') depth++;
    else if (c === ']' || c === '}') {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

// Where a blocks payload can open: an array of objects, or an object whose
// first key is "type" or "blocks".
const OPENER = /\[\s*\{\s*"type"\s*:|\{\s*"(?:type|blocks)"\s*:/g;

export function splitEmbeddedBlocks(text: string): { prose: string; blocks: any[] } {
  if (typeof text !== 'string' || !text) return { prose: text ?? '', blocks: [] };
  const blocks: any[] = [];
  let prose = text;
  let from = 0;
  for (;;) {
    OPENER.lastIndex = from;
    const m = OPENER.exec(prose);
    if (!m) break;
    const start = m.index;
    const end = matchingClose(prose, start);
    let found: any[] | null = null;
    if (end !== -1) {
      try {
        found = blocksOf(JSON.parse(prose.slice(start, end)));
      } catch {
        found = null;
      }
    }
    if (!found) {
      from = start + 1;
      continue;
    }
    blocks.push(...found);
    // Take a ```json fence wrapped around the payload with it.
    let cutStart = start;
    let cutEnd = end;
    const fenceBefore = prose.slice(0, cutStart).match(/```[a-z]*\s*$/i);
    const fenceAfter = prose.slice(cutEnd).match(/^\s*```/);
    if (fenceBefore && fenceAfter) {
      cutStart -= fenceBefore[0].length;
      cutEnd += fenceAfter[0].length;
    }
    prose = prose.slice(0, cutStart) + prose.slice(cutEnd);
    from = cutStart;
  }
  if (blocks.length === 0) return { prose: text, blocks };
  return { prose: prose.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim(), blocks };
}
