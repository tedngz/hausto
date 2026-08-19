import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.4";
import { Redis } from "https://esm.sh/@upstash/redis@latest";
import { logOpenAIUsage, isOpenAIBudgetExhausted } from "../_shared/openai-usage.ts";

// Hausto Assistant: the platform-wide floating AI chat. Answers renter
// questions (advice, property info, rental process) grounded in the user's
// matched properties and complex knowledge, and reveals owner/realtor
// contacts on request - free users get 10 reveals per day, premium unlimited.
// It deliberately does NOT search or recommend new listings; that stays in
// the main AI Search experience.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const HISTORY_LIMIT = 16;
const FREE_DAILY_CONTACT_REVEALS = 10;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

interface ClientMessage {
  role: "user" | "assistant";
  content: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json({ error: "Unauthorized" }, 401);
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
    const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SERVICE_ROLE_KEY || !OPENAI_API_KEY) {
      console.error("[ai-assistant] Missing env vars");
      return json({ error: "Server not configured" }, 500);
    }

    const supabaseAuth = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authErr } = await supabaseAuth.auth.getUser(
      authHeader.replace("Bearer ", "")
    );
    if (authErr || !user) {
      return json({ error: "Unauthorized" }, 401);
    }

    if (await isOpenAIBudgetExhausted()) {
      return json({
        reply: "I'm taking a short break right now - please try again a bit later.",
      });
    }

    const { messages, contextPropertyId } = await req.json() as {
      messages: ClientMessage[];
      contextPropertyId?: string | null;
    };
    if (!Array.isArray(messages) || messages.length === 0) {
      return json({ error: "messages are required" }, 400);
    }
    const chatHistory = messages
      .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
      .slice(-HISTORY_LIMIT)
      .map((m) => ({ role: m.role, content: m.content.slice(0, 2000) }));

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    // ---- Context: subscription tier, preferences, matched properties ----
    const [{ data: sub }, { data: prefRow }, { data: matches }] = await Promise.all([
      supabase.from("subscribers")
        .select("subscribed, subscription_tier")
        .eq("user_id", user.id)
        .maybeSingle(),
      supabase.from("user_preferences")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle(),
      supabase.from("property_matches")
        .select("property_id, property_type")
        .eq("renter_id", user.id)
        .order("created_at", { ascending: false })
        .limit(12),
    ]);
    const isPremium = !!sub?.subscribed && sub.subscription_tier === "premium";

    const internalIds = (matches || []).filter((m) => m.property_type !== "external").map((m) => m.property_id);
    const externalIds = (matches || []).filter((m) => m.property_type === "external").map((m) => m.property_id);

    const INTERNAL_COLS = "id, title, location, price, size, rooms, vibe, description, highlights, amenities, property_source_provider_name, property_source_provider_phone, is_active";
    const EXTERNAL_COLS = "id, title, location, price, size, vibe, description, highlights, amenities, contact_name, contact_phone, is_active";

    const [internalRes, externalRes] = await Promise.all([
      internalIds.length > 0
        ? supabase.from("properties").select(INTERNAL_COLS).in("id", internalIds)
        : Promise.resolve({ data: [] as Record<string, unknown>[] }),
      externalIds.length > 0
        ? supabase.from("external_properties").select(EXTERNAL_COLS).in("id", externalIds)
        : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    ]);
    const properties: Record<string, unknown>[] = [
      ...(internalRes.data || []),
      ...(externalRes.data || []),
    ];

// The listing the user is asking about - the page they are on, or the card
    // whose sparkle summoned the assistant - joins the context so "get me the
    // contact for this one" resolves without a match.
    if (contextPropertyId && !properties.some((p) => p.id === contextPropertyId)) {
      const [{ data: internal }, { data: external }] = await Promise.all([
        supabase.from("properties").select(INTERNAL_COLS).eq("id", contextPropertyId).maybeSingle(),
        supabase.from("external_properties").select(EXTERNAL_COLS).eq("id", contextPropertyId).maybeSingle(),
      ]);
      if (internal) properties.unshift(internal);
      else if (external) properties.unshift(external);
    }

    // Complex knowledge matched against property titles/locations
    let complexContext = "";
    if (properties.length > 0) {
      const { data: complexes } = await supabase
        .from("complexes")
        .select("name, aliases, district, city, description, pet_policy, insider_pros, insider_cons, amenities, average_rent_brackets")
        .eq("is_published", true);
      const haystack = properties.map((p) => `${p.title} ${p.location}`).join(" ").toLowerCase();
      const matched = (complexes || []).filter((c) =>
        [c.name, ...(c.aliases || [])].some((n) => n && haystack.includes(String(n).toLowerCase()))
      ).slice(0, 3);
      complexContext = matched.map((c) =>
        `Complex "${c.name}" (${c.district}, ${c.city}): ${c.description ?? ""}. Pet policy: ${c.pet_policy ?? "unknown"}. Pros: ${(c.insider_pros || []).join("; ")}. Cons: ${(c.insider_cons || []).join("; ")}. Amenities: ${(c.amenities || []).join(", ")}. Rent brackets: ${JSON.stringify(c.average_rent_brackets ?? {})}`
      ).join("\n");
    }

    const propertyContext = properties.map((p, i) => {
      const marker = p.id === contextPropertyId ? " ← CURRENT SUBJECT" : "";
      const hasContact = !!(p.property_source_provider_phone || p.property_source_provider_name || p.contact_phone || p.contact_name);
      return `Property ${i + 1} [id ${p.id}]${marker}: ${p.title} at ${p.location} — ${Number(p.price).toLocaleString()} VND/mo, ${p.size ?? "size n/a"}, rooms: ${p.rooms ?? "n/a"}. Vibe: ${p.vibe ?? "n/a"}. Highlights: ${((p.highlights as string[]) || []).join(", ")}. Amenities: ${((p.amenities as string[]) || []).join(", ")}. Contact on file: ${hasContact ? "yes" : "no"}. ${p.description ? `Description: ${String(p.description).slice(0, 300)}` : ""}`;
    }).join("\n");

    // Naming the subject on its own, above the list, is what stops the model
    // asking "which property?" when the user has clearly already pointed at one
    // by opening the assistant from its card.
    const subject = contextPropertyId
      ? properties.find((p) => p.id === contextPropertyId)
      : undefined;
    const subjectContext = subject
      ? `CURRENT SUBJECT - the user opened this assistant from this listing, so any request that does not name a property ("get the owner's contact", "is it still available?", "can I view it?") is about THIS one. Act on it; do not ask them which property they mean.
Property [id ${subject.id}]: ${subject.title} at ${subject.location}. Contact on file: ${
          (subject.property_source_provider_phone || subject.property_source_provider_name ||
            subject.contact_phone || subject.contact_name) ? "yes" : "no"
        }.`
      : "";

    const prefsContext = prefRow
      ? `User preferences on file: ${JSON.stringify(prefRow).slice(0, 500)}`
      : "";

    // ---- LLM call ----
    const systemPrompt = `You are the Hausto Assistant, the always-available AI helper on Hausto, a vetted rental platform in Vietnam. You are an AI - never claim to be a human, a realtor, or a property owner, and never invent facts.

What you do:
- Give renting advice (neighborhoods, budgeting in VND, lease norms, deposits, what to check at viewings, living in Vietnam).
- Answer questions about the user's matched properties and the listing they are viewing, using the data below.
- Share the owner/realtor contact for a specific property when the user asks for it.

What you do NOT do:
- You cannot search for or recommend new listings. If the user asks you to find homes, point them to the AI Search ("Describe Your Dream Home") or the Browse page instead.
- Never reveal contact details yourself in "reply". To share a contact, set "reveal_contact_property_id" to that property's id and the system will attach the contact (it enforces the user's daily reveal allowance). Only do this when the user clearly asks for a contact AND the property is identifiable from the data below. If the property has "Contact on file: no", say Hausto doesn't have a direct contact for it and suggest Fast-Track viewing coordination instead.
- If the user asks for a contact but you cannot tell which property they mean, ask them to name the property (or open its listing page) - do not guess. This does not apply when a CURRENT SUBJECT is given below: that is the property they mean, so act on it rather than asking.

Style: warm, concise (2-4 sentences), concrete. Prices in VND. The user is on the ${isPremium ? "PREMIUM" : "FREE"} plan.${isPremium ? "" : ` Free plan users can reveal up to ${FREE_DAILY_CONTACT_REVEALS} owner/realtor contacts per day; premium is unlimited. Only mention this when relevant.`}

${subjectContext}

${prefsContext}

Matched properties${subject ? " (the current subject is marked)" : ""}:
${propertyContext || "None on record yet - the user hasn't matched with any listings."}

${complexContext ? `Complex knowledge:\n${complexContext}` : ""}

Respond ONLY with JSON: {"reply": string, "reveal_contact_property_id": string | null}`;

    const aiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          ...chatHistory,
        ],
        temperature: 0.5,
        max_tokens: 400,
        response_format: { type: "json_object" },
      }),
    });
    if (!aiRes.ok) {
      const errText = await aiRes.text();
      console.error("[ai-assistant] OpenAI error:", aiRes.status, errText);
      throw new Error(`OpenAI error: ${aiRes.status}`);
    }
    const aiData = await aiRes.json();
    logOpenAIUsage({ fn: "ai-assistant", model: "gpt-4o-mini", usage: aiData?.usage });

    let decision: { reply?: string; reveal_contact_property_id?: string | null } = {};
    try {
      decision = JSON.parse(aiData.choices[0].message.content);
    } catch {
      decision = { reply: "Sorry, something went wrong on my side - could you rephrase that?" };
    }
    let reply = (decision.reply || "").trim() || "Sorry, I didn't catch that - could you rephrase?";

    // ---- Contact reveal with daily allowance ----
    let contactsRemaining: number | null = isPremium ? null : FREE_DAILY_CONTACT_REVEALS;
    let limitReached = false;

    const revealId = decision.reveal_contact_property_id || null;
    const revealProperty = revealId ? properties.find((p) => p.id === revealId) : null;

    // Redis SET of property ids revealed today: re-revealing the same listing
    // never consumes allowance. Fails open if Redis is down (best-effort, same
    // stance as the rest of usage tracking).
    const today = new Date().toISOString().split("T")[0];
    const revealsKey = `usage:${user.id}:${today}:contact-reveals`;
    let redis: Redis | null = null;
    try {
      redis = new Redis({
        url: Deno.env.get("UPSTASH_REDIS_REST_URL")!,
        token: Deno.env.get("UPSTASH_REDIS_REST_TOKEN")!,
      });
    } catch {
      redis = null;
    }

    if (!isPremium && redis) {
      try {
        const used = await redis.scard(revealsKey);
        contactsRemaining = Math.max(0, FREE_DAILY_CONTACT_REVEALS - used);
      } catch (e) {
        console.warn("[ai-assistant] redis read failed:", String(e).slice(0, 160));
        contactsRemaining = null;
      }
    }

    if (revealProperty) {
      const name = (revealProperty.property_source_provider_name ?? revealProperty.contact_name) as string | null;
      const phone = (revealProperty.property_source_provider_phone ?? revealProperty.contact_phone) as string | null;

      if (!name && !phone) {
        reply += `\n\nI don't have a direct owner/realtor contact on file for "${revealProperty.title}". Fast-Track viewing coordination can reach the listing provider for you.`;
      } else {
        // Enforce the free-tier allowance server-side
        let allowed = true;
        let alreadyRevealed = false;
        if (!isPremium && redis) {
          try {
            alreadyRevealed = (await redis.sismember(revealsKey, revealId!)) === 1;
            if (!alreadyRevealed) {
              const used = await redis.scard(revealsKey);
              if (used >= FREE_DAILY_CONTACT_REVEALS) {
                allowed = false;
                limitReached = true;
              }
            }
          } catch (e) {
            console.warn("[ai-assistant] redis check failed (allowing):", String(e).slice(0, 160));
          }
        }

        if (allowed) {
          const lines = [`📞 Contact for "${revealProperty.title}":`];
          if (name) lines.push(`Name: ${name}`);
          lines.push(phone ? `Phone: ${phone}` : "Phone: not listed");
          reply += `\n\n${lines.join("\n")}`;
          if (!isPremium && redis && !alreadyRevealed) {
            try {
              await redis.sadd(revealsKey, revealId!);
              await redis.expire(revealsKey, 60 * 60 * 48);
              const used = await redis.scard(revealsKey);
              contactsRemaining = Math.max(0, FREE_DAILY_CONTACT_REVEALS - used);
            } catch (e) {
              console.warn("[ai-assistant] redis write failed:", String(e).slice(0, 160));
            }
          }
        } else {
          reply += `\n\nYou've used all ${FREE_DAILY_CONTACT_REVEALS} of today's free contact reveals. Upgrade to Premium for unlimited contact reveals, or come back tomorrow.`;
          contactsRemaining = 0;
        }
      }
    }

    return json({
      reply,
      revealedPropertyId: revealProperty && !limitReached ? revealId : null,
      contactsRemaining, // null = unlimited (premium) or unknown
      limitReached,
    });
  } catch (e) {
    console.error("[ai-assistant] error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});
