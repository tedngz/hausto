// One real call per shape the edge functions send through _shared/claude.ts:
// Haiku with JSON, Haiku with a photo, Sonnet with JSON. Run it with the key
// before merging the switch, since the merge deploys every function at once.
//
//   ANTHROPIC_API_KEY=sk-ant-... deno run --allow-env --allow-net scripts/claude-smoke.ts [photo-url]
//
// Costs well under a cent. Prints each reply and its token counts.

import { CAREFUL_MODEL, chat, FAST_MODEL, parseJsonReply } from '../supabase/functions/_shared/claude.ts';

// A mirrored listing photo, sent by URL as deep-vibe-analysis sends them. Pass
// another public photo URL if this listing has gone.
const PHOTO = Deno.args[0] ??
  'https://gbgrwjdmytaksrztcyzs.supabase.co/storage/v1/object/public/external-property-images/rentapartment-ra2199-522e58838ac3e04f/0.jpg';

const cases = [
  {
    name: 'haiku json',
    model: FAST_MODEL,
    messages: [
      { role: 'system', content: 'Extract rental search filters.' },
      { role: 'user', content: 'Return {"district": string, "bedrooms": number}. Message: 2PN Thảo Điền dưới 20 triệu' },
    ],
  },
  {
    name: 'haiku photo',
    model: FAST_MODEL,
    messages: [{
      role: 'user',
      content: [
        { type: 'text' as const, text: 'Return {"is_interior": boolean, "highlight": "7-12 words"} for this photo.' },
        { type: 'image_url' as const, image_url: { url: PHOTO } },
      ],
    }],
  },
  {
    name: 'sonnet json',
    model: CAREFUL_MODEL,
    messages: [
      { role: 'system', content: 'Read an agent reply about a viewing.' },
      { role: 'user', content: 'Return {"available": boolean, "time": string|null}. Reply: "Dạ chiều thứ 3 lúc 3h xem được ạ"' },
    ],
  },
];

let failed = 0;
for (const c of cases) {
  const r = await chat({ model: c.model, json: true, maxTokens: 300, messages: c.messages });
  if (!r.ok) {
    failed++;
    console.log(`FAIL ${c.name}: ${r.error}`);
    continue;
  }
  let parsed: unknown;
  try {
    parsed = parseJsonReply(r.text);
  } catch {
    failed++;
    console.log(`FAIL ${c.name}: reply was not JSON: ${r.text.slice(0, 200)}`);
    continue;
  }
  console.log(`ok   ${c.name} (${r.usage.prompt_tokens} in / ${r.usage.completion_tokens} out):`, JSON.stringify(parsed));
}
if (failed) Deno.exit(1);
