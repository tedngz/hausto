// The comparison engine: given 2-4 shortlisted listings and a question about
// them, answer from the listing data alone.
//
// Lives here because two callers need the same answer. The compare dialog has
// its own endpoint (compare-listings-ai), and the hub's one chat has to answer
// the same question when a renter pins listings and asks which to take - and
// that is where it kept going wrong. chat-ai's prompt is a shopping prompt:
// three thousand lines of scored candidates, priority ordering and "DEFAULT TO
// SHOPPING", with the comparison a paragraph inside it. Asked to compare, the
// model kept coming back with a fresh search, and each guard added downstream
// only removed listings from an answer that had already been written as one.
//
// So a comparison turn does not go through that prompt at all. It comes here
// instead: the listings are the whole world, there are no candidates to offer,
// and the reply shape has no "results" field to fill. It cannot answer with a
// search because there is nothing to search.
import { logOpenAIUsage } from './openai-usage.ts';

export interface CompareListing {
  title?: string | null;
  location?: string | null;
  /** Monthly rent in USD - what the browse table already holds */
  price_usd?: number | null;
  /** Monthly rent in VND - what the listing tables hold */
  price_vnd?: number | null;
  rooms?: string | number | null;
  size?: string | number | null;
  vibe?: string | null;
  amenities?: string[] | null;
  highlights?: string[] | null;
  last_verified_at?: string | null;
  posting_count?: number | null;
}

export interface CompareAnswer {
  answer: string;
  followups: string[];
}

/** Trimmed to what a comparison actually turns on, and capped so a long
 *  amenity list can't crowd out the question. */
const compact = (listings: CompareListing[]) =>
  listings.map((l, i) => {
    const row: Record<string, unknown> = {
      option: i + 1,
      title: String(l.title || '').slice(0, 120),
      location: String(l.location || '').slice(0, 120),
      rooms: l.rooms ?? null,
      size: l.size ?? null,
      vibe: l.vibe ?? null,
      amenities: (l.amenities || []).slice(0, 20),
      highlights: (l.highlights || []).slice(0, 8),
      last_verified_at: l.last_verified_at ?? null,
      postings_by_agents: l.posting_count ?? 1,
    };
    // Whichever currency the caller holds. Both are labelled, so the model
    // never has to guess which one it is reading.
    if (l.price_usd != null) row.price_usd_per_month = l.price_usd;
    if (l.price_vnd != null) row.price_vnd_per_month = l.price_vnd;
    return row;
  });

export const buildCompareSystemPrompt = (
  listings: CompareListing[],
  preferences?: unknown,
): string =>
  `You are Hausto's rental comparison assistant for expats in Vietnam. The renter has shortlisted these listings and needs help deciding. Answer ONLY from the provided listing data - if something isn't in the data (exact fees, pet policy, availability), say so and suggest confirming at the viewing. Be concise: 3-6 sentences or a short bullet list. Refer to listings by their option number and short name. When a recommendation is asked for, give one, with the tradeoff stated plainly.

This is an ongoing conversation - the renter may ask follow-ups that refer back to what you already said. Don't repeat a full comparison when they ask something narrow; just answer it.

Write plain conversational text. Do NOT use markdown: no **bold**, no *italics*, no ### headings, no tables. For a list, start each line with "- ". Use "-" not em dashes.

Reply with JSON only, shaped exactly:
{"answer": "your reply", "followups": ["...", "..."]}
"followups" holds 2-3 short questions the renter would plausibly ask next, in their voice ("Is Option 1 worth the extra $400?"), each under 45 characters. They must follow from what you just said and be answerable from the listing data. Never repeat a question already asked in this conversation. Use [] if nothing useful follows.

Listings:
${JSON.stringify(compact(listings), null, 1)}${preferences ? `\n\nRenter preferences: ${JSON.stringify(preferences).slice(0, 600)}` : ''}`;

/**
 * Ask the comparison question. Returns prose and follow-ups - never listings,
 * which is the whole point of routing a comparison here.
 *
 * Throws on a failed API call so the caller can decide what to say; a reply
 * that isn't the agreed JSON is salvaged rather than thrown away.
 */
export async function askCompare(opts: {
  question: string;
  listings: CompareListing[];
  preferences?: unknown;
  /** Prior turns, oldest first, so a follow-up doesn't restate the comparison */
  history?: { role: string; content: string }[];
  openaiKey: string;
  /** Label for the shared OpenAI spend log */
  fn: string;
}): Promise<CompareAnswer> {
  const priorTurns = (Array.isArray(opts.history) ? opts.history : [])
    .filter((m) => (m?.role === 'user' || m?.role === 'assistant') && typeof m?.content === 'string')
    .slice(-8)
    .map((m) => ({ role: m.role, content: String(m.content).slice(0, 1500) }));

  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${opts.openaiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      max_tokens: 500,
      temperature: 0.3,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: buildCompareSystemPrompt(opts.listings, opts.preferences) },
        ...priorTurns,
        { role: 'user', content: String(opts.question).slice(0, 500) },
      ],
    }),
  });

  if (!resp.ok) {
    const detail = await resp.text();
    console.error(`[${opts.fn}] OpenAI error:`, resp.status, detail.slice(0, 300));
    throw new Error(`AI request failed (${resp.status})`);
  }

  const data = await resp.json();
  logOpenAIUsage({ fn: opts.fn, model: 'gpt-4o-mini', usage: data?.usage });
  const raw = data.choices?.[0]?.message?.content?.trim() || '';

  // JSON mode should guarantee the shape, but a malformed reply must still
  // produce a usable answer rather than dumping braces into the chat.
  let answer = '';
  let followups: string[] = [];
  try {
    const parsed = JSON.parse(raw);
    answer = String(parsed?.answer || '').trim();
    followups = (Array.isArray(parsed?.followups) ? parsed.followups : [])
      .filter((f: unknown) => typeof f === 'string' && f.trim())
      .slice(0, 3)
      .map((f: string) => f.trim().slice(0, 80));
  } catch {
    console.error(`[${opts.fn}] Non-JSON reply:`, raw.slice(0, 200));
    answer = raw;
  }
  if (!answer) answer = 'Sorry, I could not analyze these listings.';

  return { answer, followups };
}
