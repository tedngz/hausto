// English rewriting for listings that arrive as raw source text.
//
// Every marketplace except nhatot goes through the Phase 3 AI extraction step,
// which already outputs an English title and a tidy 2-3 sentence description.
// nhatot is built straight from chotot's ad payload (cheaper and far more
// reliable for photos, price and bedroom count), so the seller's Vietnamese
// headline and their full emoji-strewn advert text land in the database exactly
// as posted. This module is the missing writing step: text in, English out.
//
// It never fails a listing - on any error the caller keeps the original text.
import { logOpenAIUsage } from './openai-usage.ts';
import { chat, hasClaudeKey, parseJsonReply } from './claude.ts';

export interface ListingCopy {
  title: string;
  description: string;
  amenities: string[];
}

// Detect Vietnamese *prose*, not Vietnamese place names. English listings
// commonly mention places such as “Phú Nhuận” and “Thảo Cầm Viên”; matching
// diacritics alone would send those clean rows through the writer again.
// These are seller-ad terms, including the common unaccented spellings.
const VN_COPY_PATTERN =
  /(?:^|[^\p{L}])(?:cho\s*thu[êe]|c[aă]n\s*h[ộo]|ph[oò]ng\s*ng[uủ]|n[ộo]i\s*th[ấa]t|li[êe]n\s*h[ệe]|di[ệe]n\s*t[ií]ch|ph[oò]ng\s*kh[aá]ch|ph[oò]ng\s*b[ếe]p|nh[aà]\s*v[ệe]\s*sinh|ti[ệe]n\s*[ií]ch|v[ịi]\s*tr[ií]|g[ửu]i\s*xe|d[ựu]\s*[aá]n|gi[aá]\s*thu[êe]|tri[ệe]u\s*(?:\/?\s*)?th[aá]ng|y\s*h[iì]nh|[đd][ầa]y\s*[đd][ủu]|ch[ií]nh\s*ch[ủu])(?=$|[^\p{L}])/iu;

export function looksVietnamese(text: string | null | undefined): boolean {
  return !!text && VN_COPY_PATTERN.test(text);
}

function clean(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

// Rewrites headline, advert body and amenity lines into English. Location,
// price, size and bedroom count are never touched - they come from the feed
// already structured and correct.
export async function normalizeListingCopy(input: {
  title: string;
  description: string;
  amenities?: string[];
  location?: string;
  rooms?: string;
  size?: string;
  fn: string;
  sourceUrl?: string;
}): Promise<ListingCopy | null> {
  if (!hasClaudeKey()) return null;
  const body = (input.description || '').substring(0, 6000);
  if (!input.title && !body) return null;

  const prompt = `Rewrite this Vietnamese rental listing for an English-speaking expat audience.

ORIGINAL HEADLINE: ${input.title || '(none)'}
ORIGINAL ADVERT TEXT: ${body || '(none)'}
AMENITY LINES: ${(input.amenities ?? []).join(', ') || '(none)'}
LOCATION (do not translate, do not repeat verbatim in the title): ${input.location || '(unknown)'}
BEDROOMS: ${input.rooms || '(unknown)'} | SIZE: ${input.size || '(unknown)'}

RULES
1. title: an evocative English title capturing style and atmosphere (e.g. "Sun-Drenched Minimalist One-Bedroom with Rooftop Jacuzzi"). Never all-caps, never a bare address, never generic like "Apartment for rent".
2. description: 2-3 English sentences on how the place feels to live in - light, materials, atmosphere - plus one or two practical details. No emoji, no phone numbers, no Zalo/WhatsApp or contact lines, no price, no bullet symbols, no closing summary sentence.
3. amenities: English physical features only (Air Conditioning, Balcony, Rooftop Pool, Washing Machine, Parking, Elevator, Gym...). Exclude deposits, rental terms, prices, floor numbers, room counts and contact details. Empty array if none are stated.
4. Never invent facts that are not in the original text.

RESPOND WITH VALID JSON ONLY:
{"title":"...","description":"...","amenities":["..."]}`;

  try {
    const r = await chat({
      json: true,
      maxTokens: 1200,
      timeoutMs: 30_000,
      messages: [
        {
          role: 'system',
          content:
            'You rewrite Vietnamese property adverts as clean English copy. Keep Vietnamese place names untranslated. Respond with valid JSON only.',
        },
        { role: 'user', content: prompt },
      ],
    });

    if (!r.ok) {
      console.warn(`[listing-language] ${r.error}`);
      return null;
    }

    logOpenAIUsage({
      fn: input.fn,
      model: r.model,
      usage: r.usage,
      metadata: { step: 'listing-language', sourceUrl: input.sourceUrl },
    });

    if (!r.text) return null;
    const parsed = parseJsonReply(r.text) as { title?: unknown; description?: unknown; amenities?: unknown };

    const title = clean(parsed.title);
    const description = clean(parsed.description);
    if (!title && !description) return null;

    return {
      title: title || input.title,
      description: description || input.description,
      amenities: Array.isArray(parsed.amenities)
        ? [...new Set(parsed.amenities.map(clean).filter(Boolean))].slice(0, 15)
        : (input.amenities ?? []),
    };
  } catch (e) {
    console.warn('[listing-language] rewrite failed:', String(e).substring(0, 200));
    return null;
  }
}
