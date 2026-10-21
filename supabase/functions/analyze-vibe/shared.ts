// Quality-first per-image vibe analysis with Redis-backed TPM limiting
// and exponential backoff. NO fake/generic highlight fallbacks — failures
// are surfaced to the caller so the property stays in `pending` state.
import { logOpenAIUsage } from '../_shared/openai-usage.ts';
import { chat, MAX_IMAGE_BYTES, type ChatMessage } from '../_shared/claude.ts';

import { Image } from 'https://deno.land/x/imagescript@1.2.15/mod.ts';

const UPSTASH_REDIS_REST_URL = Deno.env.get('UPSTASH_REDIS_REST_URL');
const UPSTASH_REDIS_REST_TOKEN = Deno.env.get('UPSTASH_REDIS_REST_TOKEN');

// Claude downsizes any photo larger than it needs before reading it, so
// shipping the full-resolution file is pure upload egress (and encode time) for
// bytes the model throws away. 1024px on the longest side is plenty for a vibe
// read and costs roughly 1,000-1,400 input tokens a photo.
const MAX_EDGE = 1024;
const JPEG_QUALITY = 82;

// A self-imposed ceiling on input tokens a minute, shared through Redis by every
// worker. 10K a call is a generous estimate for one photo plus this prompt; it
// keeps a burst of workers inside the account's Claude rate limit.
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

function bytesToBase64(bytes: Uint8Array): string {
  let b64 = '';
  const chunk = 8192;
  for (let j = 0; j < bytes.length; j += chunk) {
    b64 += String.fromCharCode.apply(null, Array.from(bytes.subarray(j, Math.min(j + chunk, bytes.length))));
  }
  return btoa(b64);
}

// Shrink to MAX_EDGE on the longest side and re-encode as JPEG. Returns
// null (caller falls back to the original bytes) when the image is already
// small enough or can't be decoded - e.g. webp, which imagescript doesn't read.
async function downscale(bytes: Uint8Array): Promise<{ dataUrl: string } | null> {
  try {
    const img = await Image.decode(bytes);
    const longest = Math.max(img.width, img.height);
    if (longest <= MAX_EDGE) return null;
    const scale = MAX_EDGE / longest;
    img.resize(Math.round(img.width * scale), Math.round(img.height * scale));
    const jpeg = await img.encodeJPEG(JPEG_QUALITY);
    return { dataUrl: `data:image/jpeg;base64,${bytesToBase64(jpeg)}` };
  } catch {
    return null;
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
    // Downscale before sending; pass the original through if it's already small
    // or in a format we can't decode.
    const shrunk = await downscale(bytes);
    if (shrunk) return shrunk;
    // Claude refuses an image over 5 MB as sent; one we could not shrink and
    // is still that large cannot be read at all.
    if (bytes.length > MAX_IMAGE_BYTES) return null;
    let mime = 'image/jpeg';
    if (ct.includes('png')) mime = 'image/png';
    else if (ct.includes('webp')) mime = 'image/webp';
    else if (ct.includes('gif')) mime = 'image/gif';
    return { dataUrl: `data:${mime};base64,${bytesToBase64(bytes)}` };
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

Scoring calibration — these scores drive search ranking, so they MUST discriminate:
- 5 means "typical for a mid-range Vietnamese rental apartment". Most images should score 3-6 on most dimensions.
- Reserve 8-10 for genuinely exceptional evidence visible in THIS image (e.g. luxurious=9 needs marble, designer furniture, or premium finishes — not just "clean and new").
- At most TWO dimensions may score 7 or higher. Decide which one or two qualities most distinguish this space, and keep the rest at or below their honest level.
- Opposing dimensions constrain each other: a space cannot be both highly minimalist and highly colorful, or highly modern and highly rustic. Pick a side.

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
  propertyInfo?: any;
}

export interface AnalyzeResult {
  allSucceeded: boolean;
  analyses: any[];      // Only successful per-image analyses (image_index aligned to source)
  failures: { image_index: number; reason: string }[];
}

async function callModelWithBackoff(
  messages: ChatMessage[],
  imageIndex: number,
): Promise<{ ok: true; content: string } | { ok: false; reason: string }> {
  const delays = [1000, 2000, 4000, 8000];
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    await tpmReserve(PER_CALL_EST_TOKENS);

    // This loop is the retry policy, so the SDK's own retries are off.
    const r = await chat({ messages, maxTokens: 1500, maxRetries: 0 });
    if (r.ok) {
      logOpenAIUsage({ fn: 'analyze-vibe', model: r.model, usage: r.usage, images: 1 });
      if (r.text) return { ok: true, content: r.text };
      return { ok: false, reason: 'empty_response' };
    }

    // Out of credit is not transient - retrying just burns worker CPU (it
    // took down scheduled-crawl runs). Fail immediately; vibe_status stays
    // pending and the queue retries after a top-up.
    if (r.quota) return { ok: false, reason: 'model_quota_exhausted' };

    if (r.status === null || r.status === 429 || r.status >= 500) {
      const reason = `http_${r.status ?? 'network'}`;
      console.warn(`[analyze-vibe] image ${imageIndex} attempt ${attempt + 1} failed ${reason}: ${r.error}`);
      if (attempt === delays.length) return { ok: false, reason };
      const jitter = 0.8 + Math.random() * 0.4;
      await new Promise(res => setTimeout(res, Math.round(delays[attempt] * jitter)));
      continue;
    }

    return { ok: false, reason: `http_${r.status}: ${r.error.substring(0, 100)}` };
  }
  return { ok: false, reason: 'exhausted_retries' };
}

export async function analyzeImagesQualityFirst(args: AnalyzeArgs): Promise<AnalyzeResult> {
  const { imageUrls } = args;
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

    const messages: ChatMessage[] = [{
      role: 'user',
      content: [
        { type: 'text', text: buildPrompt(i, imageUrls.length, previousHighlights) },
        { type: 'image_url', image_url: { url: fetched.dataUrl } },
      ],
    }];

    const result = await callModelWithBackoff(messages, i);
    if (!result.ok) {
      failures.push({ image_index: i, reason: result.reason });
      // Account-level quota exhaustion affects every image - stop wasting
      // fetch/encode work on the rest of the batch.
      if (result.reason === 'model_quota_exhausted') {
        for (let j = i + 1; j < imageUrls.length; j++) {
          failures.push({ image_index: j, reason: 'model_quota_exhausted' });
        }
        break;
      }
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
