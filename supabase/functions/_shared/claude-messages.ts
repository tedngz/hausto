// How a prompt built for OpenAI's chat format reaches Claude, and how its JSON
// comes back. Pure, so vitest can run it; the SDK call itself is in claude.ts.

/** Claude refuses a single image over 5 MB as sent, which base64 inflates by a third. */
export const MAX_IMAGE_BYTES = Math.floor((5 * 1024 * 1024 * 3) / 4);
/** More than this many images in one request and each must be at most 2000px a side. */
export const MAX_IMAGES_PER_CALL = 20;
/** The request limit is 32 MB; images stop being attached well before it. */
const MAX_REQUEST_IMAGE_CHARS = 24 * 1024 * 1024;
const MEDIA_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

export type ChatPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail?: string } };

export interface ChatMessage {
  role: string;
  content: string | ChatPart[];
}

function imageBlock(url: string, budget: { chars: number }): Record<string, unknown> | string {
  const data = /^data:([^;,]+);base64,(.*)$/s.exec(url);
  if (data) {
    let mediaType = data[1].toLowerCase();
    if (mediaType === 'image/jpg') mediaType = 'image/jpeg';
    if (!MEDIA_TYPES.has(mediaType)) return `[image not sent: ${mediaType} is not a supported format]`;
    if (data[2].length > (MAX_IMAGE_BYTES * 4) / 3) return '[image not sent: over 5 MB]';
    if (data[2].length > budget.chars) return '[image not sent: request size limit]';
    budget.chars -= data[2].length;
    return { type: 'image', source: { type: 'base64', media_type: mediaType, data: data[2] } };
  }
  if (/^https?:\/\//i.test(url)) return { type: 'image', source: { type: 'url', url } };
  return '[image not sent: unreadable reference]';
}

/**
 * OpenAI-shaped messages to Claude's: system turns lifted into `system`, image
 * parts turned into image blocks, empty turns dropped (Claude rejects them),
 * and the conversation started on a user turn (Claude requires it - a history
 * cut to its last ten turns can begin with the assistant). An image Claude
 * would refuse becomes a line of text in its place, so the images after it
 * keep their positions.
 */
export function toClaude(messages: ChatMessage[]): { system: string; messages: Array<{ role: 'user' | 'assistant'; content: unknown }> } {
  const system: string[] = [];
  const out: Array<{ role: 'user' | 'assistant'; content: unknown }> = [];
  const budget = { chars: MAX_REQUEST_IMAGE_CHARS };

  for (const m of messages) {
    if (m.role === 'system') {
      const text = typeof m.content === 'string'
        ? m.content
        : m.content.map(p => (p.type === 'text' ? p.text : '')).join('\n');
      if (text.trim()) system.push(text);
      continue;
    }
    const role = m.role === 'assistant' ? 'assistant' : 'user';
    if (typeof m.content === 'string') {
      if (m.content.trim()) out.push({ role, content: m.content });
      continue;
    }
    const blocks: Record<string, unknown>[] = [];
    for (const p of m.content) {
      if (p.type === 'text') {
        if (p.text.trim()) blocks.push({ type: 'text', text: p.text });
      } else if (p.type === 'image_url') {
        const b = imageBlock(p.image_url?.url ?? '', budget);
        blocks.push(typeof b === 'string' ? { type: 'text', text: b } : b);
      }
    }
    if (blocks.length) out.push({ role, content: blocks });
  }

  while (out.length && out[0].role !== 'user') out.shift();
  return { system: system.join('\n\n'), messages: out };
}

/**
 * The JSON object in a reply. Claude is asked for bare JSON, but a fenced or
 * prefaced reply is salvaged rather than thrown away. Throws when there is none.
 */
export function parseJsonReply(text: string): unknown {
  const t = text.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
  try {
    return JSON.parse(t);
  } catch {
    const start = t.indexOf('{');
    const end = t.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(t.slice(start, end + 1));
    throw new Error('no JSON object in the reply');
  }
}
