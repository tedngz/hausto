

## Making Hausto Agent-Friendly for AI Bots (ChatGPT, Claude, etc.)

Great idea. AI agents are increasingly used by renters to search for listings, and there are concrete standards emerging to make websites discoverable and queryable by these agents. Here's what we can do:

### What We'd Build

**1. `llms.txt` — The AI-readable site manifest**
A new standard (llms.txt) that AI agents check to understand what a site offers. We'd create `public/llms.txt` describing Hausto's purpose, available listings, and how to query them.

**2. Public Property API endpoint (no auth required)**
A new Supabase Edge Function `public-property-search` that AI agents can call directly. It would accept query parameters (city, district, budget range, rooms, vibe style) and return structured JSON with active listings. This is the key piece — it lets ChatGPT/Claude actually fetch and recommend Hausto listings to users.

**3. JSON-LD structured data on property pages**
Add Schema.org `RealEstateListing` markup to `/property/:id` pages so search engines and AI crawlers can parse individual listings with structured fields (price, location, size, images).

**4. `robots.txt` updates**
Explicitly allow AI crawlers (GPTBot, ClaudeBot, PerplexityBot) and point them to the sitemap.

**5. Dynamic sitemap**
A new Edge Function `sitemap` that generates an XML sitemap of all active property pages, so AI crawlers can discover listings.

**6. OpenAPI spec**
A `public/openapi.json` describing the public search API, which ChatGPT plugins and other agent frameworks can consume directly.

### Files to Create/Modify

| File | Action |
|------|--------|
| `public/llms.txt` | Create — AI-readable site description with API docs |
| `public/robots.txt` | Update — add AI bot user-agents + sitemap link |
| `public/openapi.json` | Create — OpenAPI 3.0 spec for public search API |
| `supabase/functions/public-property-search/index.ts` | Create — public read-only search endpoint |
| `supabase/functions/sitemap/index.ts` | Create — dynamic XML sitemap of active properties |
| `src/pages/PropertyDetail.tsx` | Update — inject JSON-LD structured data in head |
| `index.html` | Update — add base JSON-LD for the site |

### Public Search API Design

```
GET /functions/v1/public-property-search?city=hcmc&district=quan-1&min_budget=300&max_budget=800&rooms=2&style=modern&limit=10
```

Returns:
```json
{
  "results": [
    {
      "id": "...",
      "title": "Modern 2BR in Thao Dien",
      "url": "https://hausto.lovable.app/property/...",
      "location": "Thao Dien, District 2, HCMC",
      "price_usd": 650,
      "rooms": "2",
      "size": "75 sqm",
      "vibe": "modern",
      "images": ["..."],
      "highlights": ["rooftop pool", "gym"],
      "source": "hausto.lovable.app"
    }
  ],
  "total": 42,
  "query": { ... }
}
```

No authentication required. Read-only. Rate-limited. Only returns active, non-expired listings.

### Security Considerations
- Public API is strictly read-only with rate limiting (e.g., 60 req/min per IP)
- No user data exposed — only published property fields
- Provider contact info excluded from public API responses

