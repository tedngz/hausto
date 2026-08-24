import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.4";
import { Redis } from "https://esm.sh/@upstash/redis@latest";
import { logOpenAIUsage, isOpenAIBudgetExhausted } from "../_shared/openai-usage.ts";
import { Resend } from "npm:resend@2.0.0";
import { ADMIN_EMAIL, CONCIERGE_FROM, esc, SITE_URL, textToHtml } from "../_shared/concierge-email.ts";

// Hausto Assistant: the platform-wide floating AI chat. Answers renter
// questions (advice, property info, rental process) grounded in the user's
// matched properties and complex knowledge, and hands over owner/realtor
// contacts and original listing links on request - free users get 10 listing
// unlocks per day, premium unlimited. Both kinds of handover draw on that one
// allowance, per listing, because the source posting carries the phone number
// too: gating one and not the other would gate neither.
// It deliberately does NOT search or recommend new listings; that stays in
// the main AI Search experience.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const HISTORY_LIMIT = 16;
const FREE_DAILY_CONTACT_REVEALS = 10;
// The admin account that owns crawled inventory; captured questions are filed
// against it so they surface in the existing concierge queue.
const HAUSTO_AGENT_ID = "734bd05c-a381-4267-b823-88a84c79a40e";
// Ceiling on captured questions per user per day, so one frustrated session
// cannot flood the queue.
const MAX_DAILY_CAPTURES = 5;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

interface ClientMessage {
  role: "user" | "assistant";
  content: string;
}

// Best-effort operator notice for a captured question. Never throws: a mail
// failure must not cost us the capture or the user's reply.
async function notifyAdmin(
  question: string,
  propertyId: string | null,
  properties: Record<string, unknown>[],
  renterEmail: string | null,
): Promise<void> {
  try {
    const key = Deno.env.get("RESEND_API_KEY");
    if (!key) return;
    const p = propertyId ? properties.find((x) => x.id === propertyId) : undefined;
    const name = (p?.property_source_provider_name ?? p?.contact_name) as string | null;
    const phone = (p?.property_source_provider_phone ?? p?.contact_phone) as string | null;

    const listing = p
      ? `<p style="margin:16px 0 4px"><b>Listing:</b> <a href="${SITE_URL}/property/${esc(p.id)}">${esc(p.title)}</a><br>
         <span style="color:#6b7280">${esc(p.location)}</span></p>`
      : `<p style="margin:16px 0 4px;color:#6b7280">No listing in context.</p>`;

    const contact = p
      ? (phone || name
          ? `<p style="margin:4px 0"><b>Call them:</b> ${esc(name ?? "Contact")} — <a href="tel:${esc(phone ?? "")}">${esc(phone ?? "not listed")}</a></p>`
          : `<p style="margin:4px 0;color:#b45309">No contact on file for this listing.</p>`)
      : "";

    await new Resend(key).emails.send({
      from: CONCIERGE_FROM,
      to: [ADMIN_EMAIL],
      subject: "Hausto AI couldn't answer a renter question",
      html: `<p>A renter asked something the listing data does not cover:</p>
        <blockquote style="border-left:3px solid #f97316;padding-left:12px;color:#374151;margin:12px 0">${textToHtml(question)}</blockquote>
        ${listing}
        ${contact}
        <p style="margin-top:4px;color:#6b7280;font-size:13px">Renter: ${esc(renterEmail ?? "unknown")}</p>
        <p style="margin-top:20px;color:#6b7280;font-size:13px">
          They were given the contact and told calling is fastest - no reply was promised.
          Answer only if you can add something, otherwise treat this as a gap in our data.
          Unanswered questions close themselves after 7 days.
        </p>`,
    });
  } catch (e) {
    console.warn("[ai-assistant] admin notice failed:", String(e).slice(0, 160));
  }
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

    const { messages, contextPropertyId, contextPropertyIds } = await req.json() as {
      messages: ClientMessage[];
      contextPropertyId?: string | null;
      contextPropertyIds?: string[] | null;
    };
    // The renter can scope the conversation to several matched listings at
    // once; older clients send only the single id.
    const subjectIds = Array.from(new Set(
      (Array.isArray(contextPropertyIds) && contextPropertyIds.length > 0
        ? contextPropertyIds
        : [contextPropertyId])
        .filter((id): id is string => typeof id === "string" && id.length > 0)
    )).slice(0, 8);
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

    const INTERNAL_COLS = "id, title, location, price, size, rooms, vibe, description, highlights, amenities, property_source_provider_name, property_source_provider_phone, property_source_link, is_active";
    const EXTERNAL_COLS = "id, title, location, price, size, vibe, description, highlights, amenities, contact_name, contact_phone, source_url, is_active";

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

// The listings the user is asking about - the page they are on, the card
    // whose sparkle summoned the assistant, or what they picked in the subject
    // strip - join the context so "get me the contact for this one" resolves
    // even when the listing was never matched.
    const missingSubjectIds = subjectIds.filter((id) => !properties.some((p) => p.id === id));
    if (missingSubjectIds.length > 0) {
      const [{ data: internals }, { data: externals }] = await Promise.all([
        supabase.from("properties").select(INTERNAL_COLS).in("id", missingSubjectIds),
        supabase.from("external_properties").select(EXTERNAL_COLS).in("id", missingSubjectIds),
      ]);
      properties.unshift(...(internals || []), ...(externals || []));
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
      const marker = subjectIds.includes(String(p.id)) ? " ← CURRENT SUBJECT" : "";
      const hasContact = !!(p.property_source_provider_phone || p.property_source_provider_name || p.contact_phone || p.contact_name);
      // Whether a source link EXISTS, never the URL itself: the model has to
      // ask for it so the allowance below can be enforced. Putting the URL in
      // context would let it paste one straight into a reply, ungated.
      const hasSourceLink = !!(p.property_source_link ?? p.source_url);
      return `Property ${i + 1} [id ${p.id}]${marker}: ${p.title} at ${p.location} — ${Number(p.price).toLocaleString()} VND/mo, ${p.size ?? "size n/a"}, rooms: ${p.rooms ?? "n/a"}. Vibe: ${p.vibe ?? "n/a"}. Highlights: ${((p.highlights as string[]) || []).join(", ")}. Amenities: ${((p.amenities as string[]) || []).join(", ")}. Contact on file: ${hasContact ? "yes" : "no"}. Original listing on file: ${hasSourceLink ? "yes" : "no"}. ${p.description ? `Description: ${String(p.description).slice(0, 300)}` : ""}`;
    }).join("\n");

    // Naming the subjects on their own, above the list, is what stops the model
    // asking "which property?" when the renter has already pointed at them - by
    // opening the assistant from a card, or by picking them in the chat.
    const subjectProps = subjectIds
      .map((id) => properties.find((p) => p.id === id))
      .filter((p): p is Record<string, unknown> => !!p);
    const describe = (p: Record<string, unknown>) =>
      `Property [id ${p.id}]: ${p.title} at ${p.location}. Contact on file: ${
        (p.property_source_provider_phone || p.property_source_provider_name ||
          p.contact_phone || p.contact_name) ? "yes" : "no"
      }.`;
    const subjectContext = subjectProps.length === 1
      ? `CURRENT SUBJECT - the user pointed this assistant at this listing, so any request that does not name a property ("get the owner's contact", "is it still available?", "can I view it?") is about THIS one. Act on it; do not ask them which property they mean.
${describe(subjectProps[0])}`
      : subjectProps.length > 1
        ? `CURRENT SUBJECTS - the user scoped this conversation to these ${subjectProps.length} listings. A request that names no property is about all of them: answer for each. Only if one specific answer is needed and they genuinely differ, ask which of THESE they mean - never ask them to name a property from scratch.
${subjectProps.map(describe).join("\n")}`
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
- Share the original listing link when asked for it, or when someone wants to see the source posting, more photos, or check the listing themselves.
- Hand people to the listing contact for anything only the owner can confirm. Hausto's inventory is listings gathered from across the market, so we do NOT hold live availability, price flexibility, or contract terms. For those, say so plainly and give them the contact so they can call - calling is genuinely the fastest route, so frame it as the better option rather than an apology.

What you do NOT do:
- You cannot search for or recommend new listings. If the user asks you to find homes, point them to the AI Search ("Describe Your Dream Home") or the Browse page instead.
- Never reveal contact details yourself in "reply". To share a contact, set "reveal_contact_property_id" to that property's id and the system will attach the contact (it enforces the user's daily reveal allowance). Do this whenever the user asks for a contact, AND whenever the question needs the owner (availability, price negotiation, deposit or contract terms, move-in dates) and the property is identifiable - in that case answer what you can from the data, then attach the contact so they can call. If the property has "Contact on file: no", say Hausto doesn't have a direct contact for it and offer Fast-Track viewing coordination instead.
- Never write a listing URL yourself in "reply", and never guess one - you are not given them. To share the original listing, set "reveal_listing_link_property_id" to that property's id and the system will attach the link under the same daily allowance. If the property has "Original listing on file: no", say we don't have a source link for it rather than offering a substitute.
- NEVER promise that Hausto will find out, check with the owner, get back to them, or pass anything to a team. There is no such queue - a promise like that is simply broken. Offer the contact, or Fast-Track when they want us to book a viewing for them.
- If the user asks for a contact but you cannot tell which property they mean, ask them to name the property (or open its listing page) - do not guess. This does not apply when a CURRENT SUBJECT is given below: that is the property they mean, so act on it rather than asking.

Style: warm, concise (2-4 sentences), concrete. Prices in VND. The user is on the ${isPremium ? "PREMIUM" : "FREE"} plan.${isPremium ? "" : ` Free plan users can open up to ${FREE_DAILY_CONTACT_REVEALS} listings per day - a contact and a source link for the same listing count once between them; premium is unlimited. Only mention this when relevant.`}

${subjectContext}

${prefsContext}

Matched properties${subjectProps.length > 0 ? " (subjects marked)" : ""}:
${propertyContext || "None on record yet - the user hasn't matched with any listings."}

${complexContext ? `Complex knowledge:\n${complexContext}` : ""}

Set "capture_question" to true when the user asked something concrete that you could NOT answer from the data above - typically because only the owner knows (live availability, negotiability, deposit or contract specifics) or because Hausto simply lacks the detail. This is a silent signal for our team about missing information: it changes nothing the user sees, so never mention it, and never imply anyone will follow up. Leave it false for greetings, small talk, general renting advice, and anything you answered adequately.

Respond ONLY with JSON: {"reply": string, "reveal_contact_property_id": string | null, "reveal_listing_link_property_id": string | null, "capture_question": boolean}`;

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

    let decision: { reply?: string; reveal_contact_property_id?: string | null; reveal_listing_link_property_id?: string | null; capture_question?: boolean } = {};
    try {
      decision = JSON.parse(aiData.choices[0].message.content);
    } catch {
      decision = { reply: "Sorry, something went wrong on my side - could you rephrase that?" };
    }
    let reply = (decision.reply || "").trim() || "Sorry, I didn't catch that - could you rephrase?";

    // ---- Contact and source-link handover, under one daily allowance ----
    let contactsRemaining: number | null = isPremium ? null : FREE_DAILY_CONTACT_REVEALS;
    let limitReached = false;

    const revealId = decision.reveal_contact_property_id || null;
    const revealProperty = revealId ? properties.find((p) => p.id === revealId) : null;

    // Redis SET of property ids unlocked today: re-opening the same listing
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

    // Spend a day's allowance on a listing, or report that it is exhausted.
    //
    // A contact and a source link are the same handover in practice - the
    // source posting almost always carries the owner's phone number - so they
    // draw on ONE allowance, keyed by listing. Whichever is asked for first
    // spends it; the other is then free for that listing, as is asking again
    // later today. Fails open if Redis is down, matching usage tracking
    // elsewhere.
    //
    // `unlocked` covers the both-in-one-reply case. It records what actually
    // succeeded rather than comparing the two property ids, because a listing
    // with no contact on file never reaches the allowance at all - and its
    // link, which is then the only route to the owner, still has to pay.
    const unlocked = new Set<string>();

    const spendReveal = async (propertyId: string): Promise<boolean> => {
      if (unlocked.has(propertyId)) return true;
      if (isPremium || !redis) {
        unlocked.add(propertyId);
        return true;
      }
      try {
        if ((await redis.sismember(revealsKey, propertyId)) === 1) {
          unlocked.add(propertyId);
          return true;
        }
        if ((await redis.scard(revealsKey)) >= FREE_DAILY_CONTACT_REVEALS) {
          limitReached = true;
          contactsRemaining = 0;
          return false;
        }
        await redis.sadd(revealsKey, propertyId);
        await redis.expire(revealsKey, 60 * 60 * 48);
        contactsRemaining = Math.max(0, FREE_DAILY_CONTACT_REVEALS - (await redis.scard(revealsKey)));
        unlocked.add(propertyId);
        return true;
      } catch (e) {
        console.warn("[ai-assistant] redis allowance check failed (allowing):", String(e).slice(0, 160));
        unlocked.add(propertyId);
        return true;
      }
    };

    // Appended at most once, even when both a contact and a link were refused.
    let exhaustedNoted = false;
    const noteExhausted = () => {
      if (exhaustedNoted) return;
      exhaustedNoted = true;
      reply += `\n\nYou've used all ${FREE_DAILY_CONTACT_REVEALS} of today's free listing unlocks - a contact and its original listing link count as one. Upgrade to Premium for unlimited unlocks, or come back tomorrow.`;
    };

    if (revealProperty) {
      const name = (revealProperty.property_source_provider_name ?? revealProperty.contact_name) as string | null;
      const phone = (revealProperty.property_source_provider_phone ?? revealProperty.contact_phone) as string | null;

      if (!name && !phone) {
        reply += `\n\nI don't have a direct owner/realtor contact on file for "${revealProperty.title}". Fast-Track viewing coordination can reach the listing provider for you.`;
      } else if (await spendReveal(revealId!)) {
        const lines = [`📞 Contact for "${revealProperty.title}":`];
        if (name) lines.push(`Name: ${name}`);
        lines.push(phone ? `Phone: ${phone}` : "Phone: not listed");
        reply += `\n\n${lines.join("\n")}`;
      } else {
        noteExhausted();
      }
    }

    // ---- Source link, under the same allowance ----
    const linkId = decision.reveal_listing_link_property_id || null;
    const linkProperty = linkId ? properties.find((p) => p.id === linkId) : null;

    if (linkProperty) {
      const url = (linkProperty.property_source_link ?? linkProperty.source_url) as string | null;

      if (!url) {
        reply += `\n\nI don't have the original listing link on file for "${linkProperty.title}".`;
      } else if (await spendReveal(linkId!)) {
        reply += `\n\n🔗 Original listing: ${url}`;
      } else {
        noteExhausted();
      }
    }

    // ---- Capture what we could not answer ----
    // Product signal only: the user is never told, because with crawled supply
    // we often cannot get an answer and a promise would go unkept. Filed
    // against the Hausto Agent so it lands in the existing concierge queue.
    let captured = false;
    if (decision.capture_question === true) {
      const lastUserMessage = [...chatHistory].reverse().find((m) => m.role === "user")?.content?.trim();
      if (lastUserMessage) {
        try {
          const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
          const { data: recent } = await supabase
            .from("concierge_escalations")
            .select("question")
            .eq("renter_id", user.id)
            .gte("created_at", since);
          const alreadyAsked = (recent || []).some(
            (r) => (r.question || "").trim().toLowerCase() === lastUserMessage.toLowerCase(),
          );
          if (!alreadyAsked && (recent || []).length < MAX_DAILY_CAPTURES) {
            const { error: capErr } = await supabase.from("concierge_escalations").insert({
              renter_id: user.id,
              realtor_id: HAUSTO_AGENT_ID,
              conversation_id: null,
              property_id: subjectIds[0] ?? null,
              question: lastUserMessage.slice(0, 2000),
              status: "pending",
              source: "assistant",
            });
            if (capErr) {
              console.warn("[ai-assistant] capture failed:", capErr.message);
            } else {
              captured = true;
              // Push it to the operator rather than waiting for someone to open
              // the dashboard. The listing's phone number is inline because most
              // captures are availability questions - the answer is a call away,
              // and making that one step is the whole point.
              await notifyAdmin(lastUserMessage, subjectIds[0] ?? null, properties, user.email ?? null);
            }
          }
        } catch (e) {
          // Never let the signal break the answer.
          console.warn("[ai-assistant] capture error:", String(e).slice(0, 160));
        }
      }
    }

    return json({
      reply,
      revealedPropertyId: revealProperty && !limitReached ? revealId : null,
      contactsRemaining, // null = unlimited (premium) or unknown
      limitReached,
      captured, // internal signal; the client deliberately does not surface it
    });
  } catch (e) {
    console.error("[ai-assistant] error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});
