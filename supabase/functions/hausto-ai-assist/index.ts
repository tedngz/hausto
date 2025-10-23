import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import "https://deno.land/x/xhr@0.1.0/mod.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { userType, messages, properties, action } = await req.json();
    
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      throw new Error('LOVABLE_API_KEY not configured');
    }

    // Build context from properties
    const propertyContext = properties?.map((p: any, i: number) => 
      `Property ${i + 1}: ${p.title} at ${p.location} - $${p.price}/mo`
    ).join('\n') || 'No properties in conversation';

    // Build conversation context
    const conversationContext = messages?.map((m: any) => 
      `${m.role === 'user' ? 'Current user' : 'Other party'}: ${m.content}`
    ).join('\n') || 'No messages yet';

    let systemPrompt = '';
    let suggestedActions = [];

    if (action) {
      // Handle specific actions
      switch (action) {
        case 'schedule_viewing':
          systemPrompt = `You are Hausto AI. The user wants to schedule a property viewing. Ask about their availability and preferred time slots in a friendly, conversational way. Keep it to 2-3 sentences.`;
          break;
        case 'discuss_price':
          systemPrompt = `You are Hausto AI. The user wants to discuss pricing. Help facilitate the price negotiation by asking about their budget flexibility or concerns. Keep it to 2-3 sentences.`;
          break;
        case 'ask_amenities':
          systemPrompt = `You are Hausto AI. The user wants to know more about amenities. Ask specific questions about which amenities are most important to them. Keep it to 2-3 sentences.`;
          break;
        case 'request_documents':
          systemPrompt = `You are Hausto AI. The user wants to request documents. Ask what specific documents they need and help coordinate the exchange. Keep it to 2-3 sentences.`;
          break;
        default:
          systemPrompt = `You are Hausto AI responding to: "${action}". Provide a helpful response in 2-3 sentences.`;
      }
    } else {
      // Initial suggestion with actions
      systemPrompt = `You are Hausto AI, a friendly and helpful real estate assistant designed to facilitate conversations between renters and property owners. Your goal is to help both parties close the deal by:

1. Suggesting relevant questions one party should ask the other
2. Highlighting important property details that haven't been discussed
3. Recommending next steps in the negotiation process
4. Encouraging positive momentum in the conversation

Current context:
- User type: ${userType}
- Properties discussed:
${propertyContext}

Recent conversation:
${conversationContext}

Provide a brief, helpful suggestion (2-3 sentences max) that will move the conversation forward and help close the deal. Be specific, actionable, and encouraging. Don't be too formal - be friendly and conversational.`;
      
      // Suggest relevant actions based on conversation
      suggestedActions = ['schedule_viewing', 'discuss_price', 'ask_amenities', 'request_documents'];
    }

    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: 'Provide a helpful suggestion to move this conversation forward.' }
        ],
        temperature: 0.7,
        max_tokens: 150
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('AI Gateway error:', response.status, errorText);
      throw new Error(`AI Gateway error: ${response.status}`);
    }

    const data = await response.json();
    const suggestion = data.choices[0].message.content;

    return new Response(
      JSON.stringify({ suggestion, suggestedActions }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200 
      }
    );

  } catch (error) {
    console.error('Error in hausto-ai-assist:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500 
      }
    );
  }
});
