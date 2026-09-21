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

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
const MODEL = 'gpt-4o-mini';

export interface ListingCopy {
  title: string;
  description: string;
  amenities: string[];
}

// Vietnamese diacritics, or the handful of unaccented phrases sellers type.
const VN_PATTERN =
  /[ăâđêôơưàáảãạằắẳẵặầấẩẫậèéẻẽẹềếểễệìíỉĩịòóỏõọồốổỗộờớởỡợùúủũụừứửữựỳýỷỹỵ]|\b(cho thue|can ho|phong ngu|noi that|lien he|dien tich)\b/i;

export function looksVietnamese(text: string | null | undefined): boolean {
  return !!text && VN_PATTERN.test(text);
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
  if (!OPENAI_API_KEY) return null;
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
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          {
            role: 'system',
            content:
              'You rewrite Vietnamese property adverts as clean English copy. Keep Vietnamese place names untranslated. Respond with valid JSON only.',
          },
          { role: 'user', content: prompt },
        ],
        max_tokens: 600,
        temperature: 0.4,
        response_format: { type: 'json_object' },
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!resp.ok) {
      console.warn(`[listing-language] OpenAI ${resp.status}: ${(await resp.text()).substring(0, 200)}`);
      return null;
    }

    const data = await resp.json();
    logOpenAIUsage({
      fn: input.fn,
      model: MODEL,
      usage: data?.usage,
      metadata: { step: 'listing-language', sourceUrl: input.sourceUrl },
    });

    const raw = data.choices?.[0]?.message?.content;
    if (!raw) return null;
    const parsed = JSON.parse(String(raw).replace(/```json\n?/g, '').replace(/```\n?/g, '').trim());

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
