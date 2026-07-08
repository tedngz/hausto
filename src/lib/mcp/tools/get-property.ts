import { defineTool, type ToolContext } from "@lovable.dev/mcp-js";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

const BASE_URL = "https://hausto.lovable.app";
const VND_TO_USD = 24500;

declare const process: { env: Record<string, string | undefined> };

function sbForUser(ctx: ToolContext) {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_PUBLISHABLE_KEY!,
    {
      global: { headers: { Authorization: `Bearer ${ctx.getToken()}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
}

export default defineTool({
  name: "get_property",
  title: "Get property details",
  description:
    "Fetch full details for a single rental property by its Hausto id, including price, amenities, highlights, images and the share URL.",
  inputSchema: {
    id: z.string().describe("Hausto property UUID."),
  },
  annotations: { readOnlyHint: true, openWorldHint: true },
  handler: async ({ id }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return {
        content: [{ type: "text", text: "Not authenticated" }],
        isError: true,
      };
    }
    const { data, error } = await sbForUser(ctx)
      .from("properties")
      .select(
        "id, title, location, price, size, vibe, rooms, images, description, highlights, amenities, is_active",
      )
      .eq("id", id)
      .maybeSingle();

    if (error) {
      return {
        content: [{ type: "text", text: `Lookup failed: ${error.message}` }],
        isError: true,
      };
    }
    if (!data) {
      return {
        content: [{ type: "text", text: `No property with id ${id}.` }],
        isError: true,
      };
    }

    const price_usd = Math.round(Number(data.price) / VND_TO_USD);
    const url = `${BASE_URL}/property/${data.id}`;

    return {
      content: [
        {
          type: "text",
          text: `${data.title}\n${data.location}\n${data.rooms ?? ""} ${data.size ?? ""} · $${price_usd}/mo\n\n${data.description ?? ""}\n\n${url}`,
        },
      ],
      structuredContent: {
        ...data,
        price_vnd: Number(data.price),
        price_usd,
        url,
      },
    };
  },
});
