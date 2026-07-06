import { defineTool } from "@lovable.dev/mcp-js";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

const BASE_URL = "https://hausto.lovable.app";
const VND_TO_USD = 24500;

function sb() {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

export default defineTool({
  name: "search_properties",
  title: "Search rental properties",
  description:
    "Search rental apartments and houses in Vietnam (Ho Chi Minh City, Hanoi, Da Nang). Filter by city, district, budget range in USD, number of rooms, and style/vibe. Returns listings with title, location, price (VND + USD), size, images and a hausto.lovable.app share link.",
  inputSchema: {
    city: z
      .enum(["hcmc", "hanoi", "danang"])
      .optional()
      .describe("City slug. Use 'hcmc' for Ho Chi Minh City."),
    district: z.string().optional().describe("District name filter."),
    min_budget_usd: z.number().int().min(0).optional(),
    max_budget_usd: z.number().int().min(0).optional(),
    rooms: z
      .string()
      .optional()
      .describe("e.g. 'Studio', '1 Bed', '2 Bed', '3 Bed', 'Penthouse'."),
    style: z
      .string()
      .optional()
      .describe("Style/vibe keyword such as modern, luxury, vintage, urban."),
    limit: z.number().int().min(1).max(50).optional().default(10),
  },
  annotations: { readOnlyHint: true, openWorldHint: true },
  handler: async (input) => {
    const supabase = sb();
    const tenDaysAgo = new Date(
      Date.now() - 10 * 24 * 60 * 60 * 1000,
    ).toISOString();

    let q = supabase
      .from("properties")
      .select(
        "id, title, location, price, size, vibe, rooms, images, description",
      )
      .eq("is_active", true)
      .gte("last_activated_at", tenDaysAgo)
      .order("created_at", { ascending: false })
      .limit(input.limit ?? 10);

    if (input.city) {
      const cityMap: Record<string, string> = {
        hcmc: "Ho Chi Minh",
        hanoi: "Hanoi",
        danang: "Da Nang",
      };
      q = q.ilike("location", `%${cityMap[input.city]}%`);
    }
    if (input.district) q = q.ilike("location", `%${input.district}%`);
    if (input.rooms) q = q.eq("rooms", input.rooms);
    if (input.style) q = q.ilike("vibe", `%${input.style}%`);
    if (input.min_budget_usd)
      q = q.gte("price", input.min_budget_usd * VND_TO_USD);
    if (input.max_budget_usd)
      q = q.lte("price", input.max_budget_usd * VND_TO_USD);

    const { data, error } = await q;
    if (error) {
      return {
        content: [{ type: "text", text: `Search failed: ${error.message}` }],
        isError: true,
      };
    }

    const results = (data ?? []).map((p: any) => ({
      id: p.id,
      title: p.title,
      location: p.location,
      price_vnd: Number(p.price),
      price_usd: Math.round(Number(p.price) / VND_TO_USD),
      size: p.size,
      rooms: p.rooms,
      vibe: p.vibe,
      image: p.images?.[0] ?? null,
      url: `${BASE_URL}/property/${p.id}`,
    }));

    return {
      content: [
        {
          type: "text",
          text:
            results.length === 0
              ? "No matching properties found."
              : `Found ${results.length} propert${results.length === 1 ? "y" : "ies"}:\n\n${results
                  .map(
                    (r) =>
                      `• ${r.title} — ${r.location}\n  ${r.rooms ?? ""} ${r.size ?? ""} · $${r.price_usd}/mo (${r.price_vnd.toLocaleString()} VND)\n  ${r.url}`,
                  )
                  .join("\n\n")}`,
        },
      ],
      structuredContent: { results },
    };
  },
});
