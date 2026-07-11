import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.4";
import { Resend } from "npm:resend@2.0.0";

// Hausto concierge: answers every renter message in a matched thread as a
// clearly-labeled AI, or escalates to the realtor when the question needs a
// human (availability, negotiation, contracts, anything not grounded in data).
// Runs server-side with the service role so the reply lands even if the renter
// closes the tab right after sending.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ADMIN_EMAIL = "ted.ngz@gmail.com";
const HISTORY_LIMIT = 10;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

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
      console.error("Missing env vars");
      return json({ error: "Server not configured" }, 500);
    }

    // Verify the JWT and identify the caller
    const supabaseAuth = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authErr } = await supabaseAuth.auth.getUser(
      authHeader.replace("Bearer ", "")
    );
    if (authErr || !user) {
      return json({ error: "Unauthorized" }, 401);
    }

    // forceEscalate: the renter explicitly asked for a human ("Talk to a
    // human" button) — skip the LLM and escalate their latest message.
    const { conversationId, messageId, forceEscalate } = await req.json();
    if (!conversationId || (!messageId && !forceEscalate)) {
      return json({ error: "conversationId and messageId are required" }, 400);
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    // Load conversation and verify the caller is the renter in it
    const { data: conv, error: convErr } = await supabase
      .from("match_conversations")
      .select("id, renter_id, realtor_id")
      .eq("id", conversationId)
      .maybeSingle();
    if (convErr || !conv) {
      return json({ error: "Conversation not found" }, 404);
    }
    if (conv.renter_id !== user.id) {
      return json({ error: "Forbidden" }, 403);
    }

    // Load the triggering message: the given one, or (forceEscalate without a
    // messageId) the renter's latest message in the thread.
    let sourceMsg: { id: string; sender_id: string; content: string; created_at: string; metadata: Record<string, unknown> | null } | null = null;
    if (messageId) {
      const { data } = await supabase
        .from("direct_messages")
        .select("id, sender_id, content, created_at, metadata")
        .eq("id", messageId)
        .eq("conversation_id", conversationId)
        .maybeSingle();
      sourceMsg = data;
    } else {
      const { data } = await supabase
        .from("direct_messages")
        .select("id, sender_id, content, created_at, metadata")
        .eq("conversation_id", conversationId)
        .eq("sender_id", conv.renter_id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      sourceMsg = data;
    }
    if (!forceEscalate && (!sourceMsg || sourceMsg.sender_id !== conv.renter_id)) {
      return json({ skipped: true, reason: "Source message not a renter message" });
    }

    // Idempotency + realtor-is-live guard: skip if anyone (AI or human) has
    // already replied after this message. An explicit human request always
    // goes through — the renter wants a person even if the AI already answered.
    if (!forceEscalate && sourceMsg) {
      const { data: newer } = await supabase
        .from("direct_messages")
        .select("id, sender_id, metadata")
        .eq("conversation_id", conversationId)
        .gt("created_at", sourceMsg.created_at)
        .neq("sender_id", conv.renter_id)
        .limit(1);
      if (newer && newer.length > 0) {
        return json({ skipped: true, reason: "Already answered" });
      }
    }

    // ---- Assemble context server-side ----

    // Recent conversation history (mapped to LLM messages further down, once
    // property titles are available to label each message's property tag).
    const { data: history } = await supabase
      .from("direct_messages")
      .select("sender_id, content, metadata, created_at")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: false })
      .limit(HISTORY_LIMIT);

    // Properties matched between this renter/realtor pair (internal + external
    // — external matches all funnel through the Hausto agent conversation).
    const { data: matches } = await supabase
      .from("property_matches")
      .select("property_id, property_type, realtor_id")
      .eq("renter_id", conv.renter_id)
      .or(`realtor_id.eq.${conv.realtor_id},property_type.eq.external`)
      .order("created_at", { ascending: false })
      .limit(10);
    const internalIds = (matches || []).filter((m) => m.property_type !== "external").map((m) => m.property_id);
    const externalIds = (matches || []).filter((m) => m.property_type === "external").map((m) => m.property_id);

    const [internalRes, externalRes] = await Promise.all([
      internalIds.length > 0
        ? supabase.from("properties")
            .select("id, title, location, price, size, vibe, description, highlights, amenities, vibe_analysis, rooms, property_source_provider_name")
            .in("id", internalIds)
        : Promise.resolve({ data: [] }),
      externalIds.length > 0
        ? supabase.from("external_properties")
            .select("id, title, location, price, size, vibe, description, highlights, amenities, vibe_analysis, contact_name")
            .in("id", externalIds)
        : Promise.resolve({ data: [] }),
    ]);
    const properties = [...(internalRes.data || []), ...(externalRes.data || [])];

    // Which listing the renter tagged via "Ask about this" — resolved here so
    // its details land in the property context below. The matched-properties
    // query is capped, so fetch the tagged listing directly if it fell outside.
    const taggedPropertyId = (sourceMsg?.metadata as Record<string, unknown> | null)?.property_id as string | undefined;
    let taggedProperty = taggedPropertyId ? properties.find((p) => p.id === taggedPropertyId) : undefined;
    if (taggedPropertyId && !taggedProperty) {
      const [{ data: internal }, { data: external }] = await Promise.all([
        supabase.from("properties")
          .select("id, title, location, price, size, vibe, description, highlights, amenities, vibe_analysis, rooms, property_source_provider_name")
          .eq("id", taggedPropertyId).maybeSingle(),
        supabase.from("external_properties")
          .select("id, title, location, price, size, vibe, description, highlights, amenities, vibe_analysis, contact_name")
          .eq("id", taggedPropertyId).maybeSingle(),
      ]);
      taggedProperty = internal ?? external ?? undefined;
      if (taggedProperty) properties.unshift(taggedProperty);
    }

    // Complex profiles whose name/alias appears in a property title/location
    let complexContext = "";
    if (properties.length > 0) {
      const { data: complexes } = await supabase
        .from("complexes")
        .select("name, aliases, district, city, description, pet_policy, insider_pros, insider_cons, amenities, average_rent_brackets")
        .eq("is_published", true);
      const haystack = properties.map((p) => `${p.title} ${p.location}`).join(" ").toLowerCase();
      const matched = (complexes || []).filter((c) =>
        [c.name, ...(c.aliases || [])].some((n) => n && haystack.includes(n.toLowerCase()))
      ).slice(0, 3);
      complexContext = matched.map((c) =>
        `Complex "${c.name}" (${c.district}, ${c.city}): ${c.description ?? ""}. Pet policy: ${c.pet_policy ?? "unknown"}. Pros: ${(c.insider_pros || []).join("; ")}. Cons: ${(c.insider_cons || []).join("; ")}. Amenities: ${(c.amenities || []).join(", ")}. Rent brackets: ${JSON.stringify(c.average_rent_brackets ?? {})}`
      ).join("\n");
    }

    const propertyContext = properties.map((p, i) => {
      const va = p.vibe_analysis ? JSON.stringify(p.vibe_analysis).slice(0, 600) : "";
      const marker = p.id === taggedPropertyId ? " ← THE PROPERTY THE RENTER IS ASKING ABOUT" : "";
      return `Property ${i + 1} [id ${p.id}]${marker}: ${p.title} at ${p.location} — ${Number(p.price).toLocaleString()} VND/mo, ${p.size ?? "size n/a"}, rooms: ${(p as Record<string, unknown>).rooms ?? "n/a"}. Vibe: ${p.vibe ?? "n/a"}. Highlights: ${(p.highlights || []).join(", ")}. Amenities: ${(p.amenities || []).join(", ")}. ${p.description ? `Description: ${String(p.description).slice(0, 400)}` : ""} ${va ? `Analysis: ${va}` : ""}`;
    }).join("\n");

    // Map history to LLM messages, labeling each with the property it was
    // tagged with at send time — so when the renter switches the pinned
    // property mid-conversation, the model can tell old context from new.
    const titleById = new Map(properties.map((p) => [p.id, p.title as string]));
    const chatHistory = (history || [])
      .reverse()
      .map((m) => {
        const meta = (m.metadata ?? {}) as Record<string, unknown>;
        const isAi = meta.is_ai === true || String(meta.type ?? "").startsWith("ai-");
        const role = m.sender_id === conv.renter_id ? "user" : "assistant";
        const msgPropertyId = meta.property_id as string | undefined;
        const propLabel = msgPropertyId
          ? `[about: ${titleById.get(msgPropertyId) ?? `property ${msgPropertyId}`}] `
          : "";
        const aiLabel = isAi ? "[Hausto AI] " : "";
        return { role, content: `${aiLabel}${propLabel}${m.content}` };
      });

    // Premium status (so the AI pitches Fast-Track appropriately)
    const { data: sub } = await supabase
      .from("subscribers")
      .select("subscription_tier")
      .eq("user_id", conv.renter_id)
      .maybeSingle();
    const isPremium = sub?.subscription_tier === "premium";

    // Which listing the renter tagged via "Ask about this" — the LLM must be
    // told explicitly, or it has no way to know which matched property the
    // question refers to.
    // ---- LLM: answer or escalate (skipped entirely on an explicit human request) ----
    let decision: { action?: string; reply?: string; suggest_fast_track?: boolean } = { action: "escalate", reply: "" };
    if (!forceEscalate) {
      const taggedNote = taggedProperty
        ? `\nIMPORTANT: The renter's CURRENT question is about "${taggedProperty.title}" (${taggedProperty.location}). Earlier messages in the conversation may be labeled [about: …] with a DIFFERENT property — that context is stale; do not carry its details over. Answer about "${taggedProperty.title}" specifically unless the renter's latest message clearly names another property.\n`
        : "";
      const systemPrompt = `You are Hausto AI, the concierge assistant for Hausto, a vetted rental platform in Vietnam. You are an AI — never claim to be the realtor, the property owner, or a human, and never invent facts.
${taggedNote}

You are replying inside a renter's post-match conversation. Decide between:
- "answer": STRONGLY PREFERRED. Answer whenever the property/complex data below covers the question, even partially — give the helpful partial answer and say plainly what you're not sure about. Greetings, small talk, general questions about the area, the platform, or the rental process are always "answer". Be warm, concise (2-4 sentences), and concrete.
- "escalate": ONLY when the question genuinely requires the property team — confirming current availability or a specific move-in date, negotiating price, contracts/deposits/legal terms — AND you cannot give a useful answer from the data. Escalation interrupts a human, so treat it as a last resort, never a default. When escalating, "reply" should briefly acknowledge the question in one sentence (the system appends the hand-off notice separately — do not promise response times yourself).

Set "suggest_fast_track" to true when scheduling a viewing is the natural next step${isPremium ? "" : " (the renter is on the free tier; Fast-Track viewing coordination is a premium feature — you may mention that)"}.

Matched properties:
${propertyContext || "None on record."}

${complexContext ? `Complex knowledge:\n${complexContext}` : ""}

Respond ONLY with JSON: {"action": "answer" | "escalate", "reply": string, "suggest_fast_track": boolean}`;

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
          max_tokens: 300,
          response_format: { type: "json_object" },
        }),
      });
      if (!aiRes.ok) {
        const errText = await aiRes.text();
        console.error("OpenAI error:", aiRes.status, errText);
        throw new Error(`OpenAI error: ${aiRes.status}`);
      }
      const aiData = await aiRes.json();
      try {
        decision = JSON.parse(aiData.choices[0].message.content);
      } catch {
        decision = { action: "escalate", reply: "" };
      }
    }
    const propertyId = taggedPropertyId ?? properties[0]?.id;

    if (decision.action === "answer" && decision.reply) {
      const { error: insertErr } = await supabase.from("direct_messages").insert({
        conversation_id: conversationId,
        sender_id: conv.realtor_id,
        receiver_id: conv.renter_id,
        content: decision.reply,
        metadata: {
          is_ai: true,
          type: "ai-answer",
          ...(propertyId ? { property_id: propertyId } : {}),
          ...(decision.suggest_fast_track ? { suggest_fast_track: true } : {}),
        },
      });
      if (insertErr) {
        console.error("Insert ai-answer error", insertErr);
        return json({ error: "Failed to insert reply" }, 500);
      }
      await supabase.from("match_conversations")
        .update({ last_message_at: new Date().toISOString(), last_message_preview: decision.reply.slice(0, 100) })
        .eq("id", conversationId);
      return json({ ok: true, action: "answer" });
    }

    // ---- Escalate ----
    const { data: escalation, error: escErr } = await supabase
      .from("concierge_escalations")
      .insert({
        conversation_id: conversationId,
        renter_id: conv.renter_id,
        realtor_id: conv.realtor_id,
        property_id: propertyId ?? null,
        question: forceEscalate
          ? `Renter asked to speak with a human.${sourceMsg ? ` Their latest message: "${sourceMsg.content}"` : ""}`
          : sourceMsg!.content,
        source_message_id: sourceMsg?.id ?? null,
      })
      .select("id")
      .single();
    if (escErr) {
      console.error("Insert escalation error", escErr);
      return json({ error: "Failed to create escalation" }, 500);
    }

    const ack = decision.reply?.trim() ? `${decision.reply.trim()} ` : "";
    const notice = forceEscalate
      ? "You're being connected with our team — a real person will reply here within a few hours."
      : `${ack}I've passed this to our team — expect a reply within a few hours.`;
    const { error: noticeErr } = await supabase.from("direct_messages").insert({
      conversation_id: conversationId,
      sender_id: conv.realtor_id,
      receiver_id: conv.renter_id,
      content: notice,
      metadata: {
        is_ai: true,
        type: "ai-escalation-notice",
        escalation_id: escalation.id,
        ...(propertyId ? { property_id: propertyId } : {}),
      },
    });
    if (noticeErr) {
      console.error("Insert escalation notice error", noticeErr);
    }
    await supabase.from("match_conversations")
      .update({ last_message_at: new Date().toISOString(), last_message_preview: notice.slice(0, 100) })
      .eq("id", conversationId);

    // Email the realtor (best-effort; fall back to admin)
    try {
      const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
      if (RESEND_API_KEY) {
        const resend = new Resend(RESEND_API_KEY);
        const [{ data: realtorProfile }, { data: renterProfile }] = await Promise.all([
          supabase.from("profiles").select("email, name").eq("id", conv.realtor_id).maybeSingle(),
          supabase.from("profiles").select("name").eq("id", conv.renter_id).maybeSingle(),
        ]);
        const to = realtorProfile?.email || ADMIN_EMAIL;
        const propertyTitle = properties.find((p) => p.id === propertyId)?.title;
        await resend.emails.send({
          from: "Hausto <hello@hausto.com>",
          to: [to],
          subject: "❓ Renter question needs your reply — Hausto Concierge",
          html: `
            <h1>A renter question was escalated to you</h1>
            <p><strong>Renter:</strong> ${renterProfile?.name || "A renter"}</p>
            ${propertyTitle ? `<p><strong>Property:</strong> <a href="https://hausto.lovable.app/property/${propertyId}">${propertyTitle}</a></p>` : ""}
            <p><strong>Question:</strong></p>
            <blockquote style="border-left: 4px solid #ea580c; padding-left: 12px; color: #374151;">${sourceMsg?.content ?? "(no message — the renter used the Talk to a human button)"}</blockquote>
            <p>${forceEscalate ? "The renter explicitly asked to speak with a human." : "Hausto AI could not answer this from the listing data."} Please reply from your dashboard's Concierge Queue — the renter has been told to expect a response within a few hours.</p>
          `,
        });
      }
    } catch (emailErr) {
      console.error("Escalation email error", emailErr);
    }

    return json({ ok: true, action: "escalate", escalationId: escalation.id });
  } catch (e) {
    console.error("concierge-reply error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});
