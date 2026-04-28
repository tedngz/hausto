## Root cause

External listings *do* get scored correctly for "D1" (location strings like `"…, Quận 1, Tp Hồ Chí Minh"` already match the Vietnamese token `quận 1` used in the filter). The Vietnamese addresses are **not** the problem.

The real causes are in `supabase/functions/chat-ai/index.ts` at the data-loading layer:

### 1. External property fetch is capped and unordered
```ts
supabase.from('external_properties')
  .select('*')
  .eq('is_active', true)
  .gt('expires_at', new Date().toISOString())
  .limit(200)            // ← cap
                         // ← no .order(), so Postgres returns rows in arbitrary order
```

There are currently **228** active external properties (159 in HCMC, 19 in District 1). The arbitrary `.limit(200)` silently drops ~28 listings, and with no `ORDER BY`, the dropped slice is non-deterministic — D1 listings are often among those silently excluded before scoring even runs.

### 2. Top-N slice starves externals
After scoring, only `maxResults + 2` (= 7) properties are passed to the LLM:
```ts
const topProperties = scoredProperties.slice(0, maxResults + 2);
```
For a "D1" query there are 5 internal D1 listings + ~13 loaded external D1 listings. Internal listings tend to score similarly or higher (more complete amenities/vibe), so externals get pushed out of the top 7 entirely.

### 3. Hanoi-district false positives in the city filter (secondary)
The hard city filter at line 730–744 marks a property as Hanoi if its location text contains a Hanoi district name as a word-bounded token. HCMC street names like **"Đường Hai Bà Trưng"** (a major D1/D3 street) collide with Hanoi's `'hai ba trung'` district name and cause those HCMC listings to be excluded as "wrong city". Same risk for other shared street names.

---

## Plan

Edit `supabase/functions/chat-ai/index.ts` only.

### Change 1 — Load all active externals, prioritised

Remove the silent cap and add deterministic ordering so newer D1 listings aren't dropped:

```ts
.from('external_properties')
.select('*')
.eq('is_active', true)
.gt('expires_at', new Date().toISOString())
.order('crawled_at', { ascending: false })
.limit(500)
```

500 is a safe ceiling for current scale (228 active) and leaves headroom; we still order so any future overflow drops oldest first, not random.

### Change 2 — Guarantee external representation in the top slice

Replace the simple `slice(0, maxResults + 2)` with a quota-aware selection that keeps the top scored properties **and** ensures at least 2–3 externals when externals exist among matches:

```ts
const allTop = scoredProperties.slice(0, maxResults + 2);
const externalsInScored = scoredProperties.filter(p => p.isExternal);
const externalsInTop = allTop.filter(p => p.isExternal).length;
const externalQuota = Math.min(3, externalsInScored.length);

let topProperties = allTop;
if (externalsInTop < externalQuota && externalsInScored.length > 0) {
  // Reserve `externalQuota` slots for externals, fill the rest with best non-external
  const topExternals = externalsInScored.slice(0, externalQuota);
  const topInternals = scoredProperties
    .filter(p => !p.isExternal)
    .slice(0, (maxResults + 2) - externalQuota);
  topProperties = [...topInternals, ...topExternals]
    .sort((a, b) => {
      if (a.isExactSubAreaMatch !== b.isExactSubAreaMatch) return a.isExactSubAreaMatch ? -1 : 1;
      return b.matchScore - a.matchScore;
    });
}
```

This preserves overall sort priority but prevents externals from being completely starved.

### Change 3 — Stop Hanoi-district false positives from HCMC street names

In the `filterAndScoreProperties` city filter (line 730–744), only treat a property as belonging to another city if **either**:
- its location string contains that city's **alias** (`hanoi`, `hà nội`, `da nang`, `đà nẵng`), OR
- its district token appears **after a comma** (i.e. in the admin tail of the address, not as a street name).

Concretely, change the Hanoi/Da Nang district check to require comma-prefixed context:

```ts
// Replace bare matchesWord(locLower, d) for non-target cities with:
const matchesAdminDistrict = (loc: string, term: string) => {
  // Match ", <term>," or ", <term>$" — i.e. district as administrative segment
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`,\\s*${escaped}(?=\\s*,|\\s*$)`, 'i').test(loc);
};

// In the loop:
if (cityData.aliases.some(a => matchesWord(locLower, a)) ||
    Object.values(cityData.districts).some(tier =>
      tier.names.some(d => matchesAdminDistrict(locLower, d))
    )) {
  isOtherCity = true;
  break;
}
```

This keeps HCMC properties on streets like "Đường Hai Bà Trưng, Phường Bến Nghé, Quận 1, Tp Hồ Chí Minh" from being misclassified as Hanoi, while still excluding genuine Hanoi listings whose tail reads `…, Hai Bà Trưng, Hà Nội`.

### Change 4 — Add diagnostic log

Add one console.log right after scoring so future regressions are easy to spot:
```ts
console.log(`[Filtering] externals in scored=${scoredProperties.filter(p=>p.isExternal).length}, in topProperties=${topProperties.filter(p=>p.isExternal).length}`);
```

---

## Files touched

- `supabase/functions/chat-ai/index.ts` (only)

## Out of scope

- No DB migrations.
- No changes to scraping, vibe queue, or the public-property-search function.
- No changes to address normalisation in the crawler — Vietnamese addresses are already correctly matched by the existing tokens.

## Outcome

When a user asks for "D1", external HCMC listings stored as `"…, Quận 1, Tp Hồ Chí Minh"` reliably appear in the AI results: all active externals are considered, at least up to 3 are guaranteed in the top slice when they qualify, and HCMC streets sharing names with Hanoi districts are no longer wrongly filtered out.
