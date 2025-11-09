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
    
    // Get provider contact info from first property
    const firstProperty = properties?.[0];
    const providerName = firstProperty?.property_source_provider_name;
    const providerPhone = firstProperty?.property_source_provider_phone;
    
    // Debug logging to verify provider data
    console.log('Provider info received:', { 
      providerName, 
      providerPhone, 
      hasProperties: properties?.length > 0,
      firstPropertyKeys: firstProperty ? Object.keys(firstProperty) : []
    });

    // Build conversation context
    const conversationContext = messages?.map((m: any) => 
      `${m.role === 'user' ? 'Current user' : 'Other party'}: ${m.content}`
    ).join('\n') || 'No messages yet';

    let systemPrompt = '';
    let suggestedActions = [];

    if (action) {
      // Handle specific actions
      switch (action) {
        case 'contact_provider': {
          const suggestion = `Which property would you like to contact the listing provider about?\n\n💡 **Tip:** You can respond with the order number of the property from your matched list.\n\n[View My Matches](/)`;

          return new Response(
            JSON.stringify({ suggestion, suggestedActions: [] }),
            {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
              status: 200,
            }
          );
        }
        case 'get_fast_track':
          systemPrompt = `You are Hausto AI, a renter support assistant. The renter selected "Get Fast Track". This is a PREMIUM FEATURE for premium subscribers only.

Explain that Fast Track is a premium service where Hausto Agent handles all coordination with listing providers (up to 3 properties) at no extra cost. If they're premium: Ask for their preferred viewing schedule (dates, times, special requirements). If not premium: Encourage them to upgrade to access this convenient service.

Keep response to 2-3 sentences.`;
          break;
        default:
          systemPrompt = `You are Hausto AI, a renter support assistant responding to: "${action}". Provide helpful guidance for renters in 2-3 sentences.`;
      }
    } else {
      // Initial suggestion with actions
      systemPrompt = `You are Hausto AI, a professional real estate assistant designed specifically to help renters find their ideal home. You're here to provide guidance and support to renters throughout their property search journey.

Your role as a renter's assistant:
1. Help renters understand property details and make informed decisions
2. Guide them through the process of contacting listing providers
3. Explain the benefits of premium features like Fast Track viewing coordination
4. Answer questions about properties, locations, and rental processes
5. Be supportive, informative, and renter-focused

Current context:
- Properties discussed:
${propertyContext}

Recent conversation:
${conversationContext}

Provide helpful guidance (2-3 sentences max) that helps the renter move forward in their property search. Be supportive, clear, and focused on the renter's needs.`;
      
      // Simplified to 2 actions only
      suggestedActions = ['contact_provider', 'get_fast_track'];
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
