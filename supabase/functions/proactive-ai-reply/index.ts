import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Authenticate the caller
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
    const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SERVICE_ROLE_KEY) {
      console.error("Missing Supabase env vars");
      return new Response(JSON.stringify({ error: "Server not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify the JWT and get the user
    const supabaseAuth = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await supabaseAuth.auth.getClaims(token);
    if (claimsError || !claimsData?.claims?.sub) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const callerUserId = claimsData.claims.sub;

    const { conversationId } = await req.json();
    if (!conversationId) {
      return new Response(JSON.stringify({ error: "conversationId is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
      console.error("Missing Supabase env vars");
      return new Response(JSON.stringify({ error: "Server not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Remove the redundant env check block - already checked above

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    // Fetch conversation to get renter/realtor IDs
    const { data: conv, error: convErr } = await supabase
      .from("match_conversations")
      .select("id, renter_id, realtor_id")
      .eq("id", conversationId)
      .maybeSingle();

    if (convErr || !conv) {
      console.error("Conversation fetch error", convErr);
      return new Response(JSON.stringify({ error: "Conversation not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify caller is a participant of this conversation
    if (conv.renter_id !== callerUserId && conv.realtor_id !== callerUserId) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get latest message
    const { data: lastMsg, error: lastMsgErr } = await supabase
      .from("direct_messages")
      .select("id, sender_id, created_at")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lastMsgErr) {
      console.error("Latest message fetch error", lastMsgErr);
      return new Response(JSON.stringify({ error: "Failed to read messages" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Only step in if the last message is from the renter and older than 60s
    if (!lastMsg || lastMsg.sender_id !== conv.renter_id) {
      return new Response(JSON.stringify({ skipped: true, reason: "Last message not from renter" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const ageMs = Date.now() - new Date(lastMsg.created_at).getTime();
    if (ageMs < 60_000) {
      return new Response(JSON.stringify({ skipped: true, reason: "Message not old enough" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check if the realtor has replied since then or AI already stepped in
    const { data: recentMsgs, error: recentErr } = await supabase
      .from("direct_messages")
      .select("id, sender_id, created_at, metadata")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: false })
      .limit(10);

    if (recentErr) {
      console.error("Recent messages fetch error", recentErr);
      return new Response(JSON.stringify({ error: "Failed to read recent messages" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const realtorHasReplied = recentMsgs?.some((m) => m.sender_id === conv.realtor_id && new Date(m.created_at).getTime() > new Date(lastMsg.created_at).getTime());
    const aiAlreadySteppedIn = recentMsgs?.some((m) => (m.metadata as any)?.type === "ai-greeting" || (m.metadata as any)?.type === "ai-suggestion");

    if (realtorHasReplied || aiAlreadySteppedIn) {
      return new Response(JSON.stringify({ skipped: true, reason: "Already handled" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Build minimal context: last 6 messages mapped to roles
    const { data: ctxMsgs } = await supabase
      .from("direct_messages")
      .select("sender_id, content, created_at")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true })
      .limit(6);

    const messages = (ctxMsgs || []).map((m) => ({
      role: m.sender_id === conv.renter_id ? "user" : "assistant",
      content: m.content,
    }));

    // Ask AI assistant for suggestion
    const { data: aiData, error: aiError } = await supabase.functions.invoke("hausto-ai-assist", {
      body: {
        userType: "realtor",
        messages,
        properties: [],
        action: null,
      },
    });

    if (aiError) {
      console.error("AI assist error", aiError);
      return new Response(JSON.stringify({ error: "AI generation failed" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const greeting = "Hi! I'm Hausto AI stepping in to help while the property owner is unavailable. How can I assist you?";

    // Insert greeting and AI suggestion as if from realtor
    const { error: insertGreetErr } = await supabase.from("direct_messages").insert({
      conversation_id: conversationId,
      sender_id: conv.realtor_id,
      receiver_id: conv.renter_id,
      content: greeting,
      metadata: { type: "ai-greeting" },
    });

    if (insertGreetErr) {
      console.error("Insert greeting error", insertGreetErr);
      return new Response(JSON.stringify({ error: "Failed to insert greeting" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const suggestion = aiData?.suggestion || "I'm here to help move things forward.";
    const suggestedActions = aiData?.suggestedActions || [];

    const { error: insertSuggestErr } = await supabase.from("direct_messages").insert({
      conversation_id: conversationId,
      sender_id: conv.realtor_id,
      receiver_id: conv.renter_id,
      content: suggestion,
      metadata: { type: "ai-suggestion", suggestedActions },
    });

    if (insertSuggestErr) {
      console.error("Insert suggestion error", insertSuggestErr);
      // Continue despite failure to insert second message
    }

    return new Response(
      JSON.stringify({ ok: true, greeting, suggestion, suggestedActions }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("proactive-ai-reply error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
