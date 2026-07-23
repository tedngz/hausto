// Quality-first per-image vibe analysis with Redis-backed TPM limiting
// and exponential backoff. NO fake/generic highlight fallbacks — failures
// are surfaced to the caller so the property stays in `pending` state.
import { logOpenAIUsage } from '../_shared/openai-usage.ts';

const UPSTASH_REDIS_REST_URL = Deno.env.get('UPSTASH_REDIS_REST_URL');
const UPSTASH_REDIS_REST_TOKEN = Deno.env.get('UPSTASH_REDIS_REST_TOKEN');

// gpt-4o-mini Tier 1 TPM is 200K. Stay well under 80% to leave room
// for other functions sharing the key. ~10K tokens per image-call.
const TPM_BUDGET = 160_000;
const PER_CALL_EST_TOKENS = 10_000;

async function redisIncrBy(key: string, value: number, ttlSeconds: number): Promise<number> {
  if (!UPSTASH_REDIS_REST_URL || !UPSTASH_REDIS_REST_TOKEN) return 0;
  try {
    const incr = await fetch(`${UPSTASH_REDIS_REST_URL}/incrby/${encodeURIComponent(key)}/${value}`, {
      headers: { Authorization: `Bearer ${UPSTASH_REDIS_REST_TOKEN}` },
    });
    const data = await incr.json();
    const current = Number(data.result || 0);
    if (current === value) {
      // First write of this minute → set TTL
      await fetch(`${UPSTASH_REDIS_REST_URL}/expire/${encodeURIComponent(key)}/${ttlSeconds}`, {
        headers: { Authorization: `Bearer ${UPSTASH_REDIS_REST_TOKEN}` },
      });
    }
    return current;
  } catch (e) {
    console.warn('[tpm] redis incr failed:', e);
    return 0;
  }
}

async function tpmReserve(estimatedTokens: number): Promise<void> {
  const minute = Math.floor(Date.now() / 60_000);
  const key = `vibe:tpm:${minute}`;
  for (let attempt = 0; attempt < 12; attempt++) {
    const used = await redisIncrBy(key, estimatedTokens, 75);
    if (used <= TPM_BUDGET) return;
    // Roll over to next minute
    const msUntilNextMinute = 60_000 - (Date.now() % 60_000) + 250;
    console.log(`[tpm] over budget (${used}/${TPM_BUDGET}), waiting ${msUntilNextMinute}ms`);
    await new Promise(r => setTimeout(r, msUntilNextMinute));
  }
}

async function fetchAsBase64(url: string): Promise<{ dataUrl: string } | null> {
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!resp.ok) return null;
    const ct = resp.headers.get('content-type') || '';
    const buf = await resp.arrayBuffer();
    const bytes = new Uint8Array(buf);
    if (bytes.length > 5 * 1024 * 1024) return null;
    let b64 = '';
    const chunk = 8192;
    for (let j = 0; j < bytes.length; j += chunk) {
      b64 += String.fromCharCode.apply(null, Array.from(bytes.subarray(j, Math.min(j + chunk, bytes.length))));
    }
    let mime = 'image/jpeg';
    if (ct.includes('png')) mime = 'image/png';
    else if (ct.includes('webp')) mime = 'image/webp';
    else if (ct.includes('gif')) mime = 'image/gif';
    return { dataUrl: `data:${mime};base64,${btoa(b64)}` };
  } catch {
    return null;
  }
}

function buildPrompt(index: number, total: number, previousHighlights: string[]): string {
  const prev = previousHighlights.length
    ? `\n\nPrevious highlights from this listing (do NOT repeat or paraphrase):\n- ${previousHighlights.join('\n- ')}`
    : '';
  return `You are analyzing image ${index + 1} of ${total} from a rental apartment listing.

Look at this single image and return a concise JSON analysis.${prev}

Rules for image_highlight:
- 7-12 words, no period
- MUST describe a specific feature visible in THIS image (visible furniture, materials, colors, layout, view)
- Must be DIFFERENT from previous highlights listed above
- No generic phrases like "modern living space", "spacious apartment", "well furnished"

Return ONLY valid JSON with this exact shape:
{
  "modern": 1-10,
  "cozy": 1-10,
  "luxurious": 1-10,
  "minimalist": 1-10,
  "colorful": 1-10,
  "spacious": 1-10,
  "natural_light": 1-10,
  "urban": 1-10,
  "rustic": 1-10,
  "elegant": 1-10,
  "image_highlight": "specific phrase about what's in THIS image (7-12 words, no period)",
  "suggested_amenities": ["Amenity1", "Amenity2"],
  "amenities": ["all visible amenities"],
  "suggested_activities": ["Working" | "Reading" | "Relaxing" | "Entertaining" | "Cooking" | "Exercising"],
  "detailed_analysis": "60-100 word description of what's visible"
}`;
}

interface AnalyzeArgs {
  imageUrls: string[];
  openaiKey: string;
  propertyInfo?: any;
}

export interface AnalyzeResult {
  allSucceeded: boolean;
  analyses: any[];      // Only successful per-image analyses (image_index aligned to source)
  failures: { image_index: number; reason: string }[];
}

async function callOpenAIWithBackoff(
  body: any,
  openaiKey: string,
  imageIndex: number,
): Promise<{ ok: true; content: string } | { ok: false; reason: string }> {
  const delays = [1000, 2000, 4000, 8000];
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    await tpmReserve(PER_CALL_EST_TOKENS);

    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (resp.ok) {
      const data = await resp.json();
      const content = data?.choices?.[0]?.message?.content;
      if (typeof content === 'string' && content.trim()) {
        return { ok: true, content };
      }
      return { ok: false, reason: 'empty_response' };
    }

    if (resp.status === 429 || resp.status >= 500) {
      const txt = await resp.text().catch(() => '');
      const reason = `http_${resp.status}`;
      console.warn(`[analyze-vibe] image ${imageIndex} attempt ${attempt + 1} failed ${reason}: ${txt.substring(0, 200)}`);
      if (attempt === delays.length) return { ok: false, reason };
      const jitter = 0.8 + Math.random() * 0.4;
      await new Promise(r => setTimeout(r, Math.round(delays[attempt] * jitter)));
      continue;
    }

    const txt = await resp.text().catch(() => '');
    return { ok: false, reason: `http_${resp.status}: ${txt.substring(0, 100)}` };
  }
  return { ok: false, reason: 'exhausted_retries' };
}

export async function analyzeImagesQualityFirst(args: AnalyzeArgs): Promise<AnalyzeResult> {
  const { imageUrls, openaiKey } = args;
  const analyses: any[] = [];
  const failures: { image_index: number; reason: string }[] = [];

  for (let i = 0; i < imageUrls.length; i++) {
    const url = imageUrls[i];
    const fetched = await fetchAsBase64(url);
    if (!fetched) {
      failures.push({ image_index: i, reason: 'fetch_failed' });
      continue;
    }

    const previousHighlights = analyses
      .map(a => String(a?.image_highlight || '').trim())
      .filter(Boolean);

    const body = {
      model: 'gpt-4o-mini',
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: buildPrompt(i, imageUrls.length, previousHighlights) },
          { type: 'image_url', image_url: { url: fetched.dataUrl, detail: 'auto' } },
        ],
      }],
      max_tokens: 500,
      temperature: 0.4,
    };

    const result = await callOpenAIWithBackoff(body, openaiKey, i);
    if (!result.ok) {
      failures.push({ image_index: i, reason: result.reason });
      continue;
    }

    try {
      const jsonMatch = result.content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        failures.push({ image_index: i, reason: 'no_json_in_response' });
        continue;
      }
      const parsed = JSON.parse(jsonMatch[0]);
      const highlight = String(parsed.image_highlight || '').trim();
      if (!highlight || highlight.length < 4) {
        failures.push({ image_index: i, reason: 'empty_highlight' });
        continue;
      }
      analyses.push({
        ...parsed,
        image_index: i,
        image_highlight: highlight,
      });
    } catch (e) {
      failures.push({ image_index: i, reason: `parse_error: ${String(e).substring(0, 80)}` });
    }
  }

  return {
    allSucceeded: failures.length === 0 && analyses.length === imageUrls.length,
    analyses,
    failures,
  };
}
