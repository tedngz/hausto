import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { propertyId, targetLanguage, title, description, highlights, vibe, location } =
      await req.json();

    if (!propertyId || !targetLanguage || !title) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const targetLang = targetLanguage === "vi" ? "Vietnamese" : "English";
    const sourceLang = targetLanguage === "vi" ? "English" : "Vietnamese";

    const prompt = `Translate the following real estate listing from ${sourceLang} to ${targetLang}. 
Keep it natural, concise, and professional. Preserve property-specific terms.
Return ONLY valid JSON with these exact keys: title, description, highlights (array), vibe, location.

Input:
Title: ${title}
Description: ${description || "N/A"}
Highlights: ${JSON.stringify(highlights || [])}
Vibe: ${vibe || "N/A"}
Location: ${location || "N/A"}`;

    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          {
            role: "system",
            content:
              "You are a professional translator for Vietnamese real estate listings. Always return valid JSON only, no markdown.",
          },
          { role: "user", content: prompt },
        ],
      }),
    });

    if (!aiResponse.ok) {
      const errText = await aiResponse.text();
      console.error("AI Gateway error:", aiResponse.status, errText);
      return new Response(JSON.stringify({ error: "Translation service unavailable" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiData = await aiResponse.json();
    const content = aiData.choices?.[0]?.message?.content || "";

    // Parse JSON from AI response (handle markdown code blocks)
    let parsed;
    try {
      const jsonStr = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      parsed = JSON.parse(jsonStr);
    } catch {
      console.error("Failed to parse AI translation:", content);
      return new Response(JSON.stringify({ error: "Translation parsing failed" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Cache in database using service role
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    await supabase.from("property_translations").upsert(
      {
        property_id: propertyId,
        property_type: "internal",
        target_language: targetLanguage,
        title_translated: parsed.title || title,
        description_translated: parsed.description || description,
        highlights_translated: parsed.highlights || highlights,
        vibe_translated: parsed.vibe || vibe,
        location_translated: parsed.location || location,
      },
      { onConflict: "property_id,property_type,target_language" }
    );

    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("translate-property error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
