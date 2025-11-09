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
          // Find the first property in the list that has provider info
          const contactProp = Array.isArray(properties)
            ? properties.find((p: any) => {
                const n = (p?.property_source_provider_name ?? '').toString().trim();
                const ph = (p?.property_source_provider_phone ?? '').toString().trim();
                return n !== '' || ph !== '';
              })
            : null;

          const finalName = (contactProp?.property_source_provider_name ?? '').toString().trim();
          const finalPhone = (contactProp?.property_source_provider_phone ?? '').toString().trim();

          console.log('Resolved provider contact:', { finalName, finalPhone });

          if (finalName || finalPhone) {
            const lines: string[] = [];
            if (finalName) lines.push(`📋 Provider: ${finalName}`);
            if (finalPhone) lines.push(`📞 Phone: ${finalPhone}`);

            const propertyTitle = contactProp?.title || 'the property';
            const suggestion = `Here's the listing provider's contact information for **${propertyTitle}**:\n\n${lines.join('\n')}\n\nYou can contact them directly to discuss the property, schedule viewings, or get more details.`;

            return new Response(
              JSON.stringify({ suggestion, suggestedActions: [] }),
              {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 200,
              }
            );
          } else {
            return new Response(
              JSON.stringify({
                suggestion: `I couldn't find the listing provider's contact information for this property. Please ask the realtor in this conversation for more details.`,
                suggestedActions: [],
              }),
              {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 200,
              }
            );
          }
        }
        case 'get_fast_track':
          systemPrompt = `You are Hausto AI. The user selected "Get Fast Track". This is a PREMIUM FEATURE for subscribers only.

If this is a premium user: Ask them for their preferred viewing schedule (dates, times, any special requirements). Let them know that Hausto Agent will coordinate with up to 3 listing providers and provide the viewing address and timeline.

If not a premium user: Politely inform them that Fast Track is a premium feature that allows Hausto Agent to handle all coordination with listing providers and arrange up to 3 property viewings at no extra cost. Encourage them to upgrade to premium.

Keep response to 2-3 sentences.`;
          break;
        default:
          systemPrompt = `You are Hausto AI, a professional real estate assistant responding to: "${action}". As an experienced realtor, provide knowledgeable guidance in 2-3 sentences.`;
      }
    } else {
      // Initial suggestion with actions
      systemPrompt = `You are Hausto AI, a professional real estate assistant with years of experience in property rentals. You're here to guide the conversation when realtors are not immediately available, ensuring both renters and property owners have a smooth, professional experience.

Your role as a professional realtor:
1. Guide both parties through the rental process with expertise and confidence
2. Ask insightful questions that reveal important details and preferences
3. Facilitate negotiations professionally, ensuring both parties feel heard
4. Educate users on standard real estate practices and next steps
5. Build trust and momentum toward closing the deal

Current context:
- User type: ${userType}
- Properties discussed:
${propertyContext}

Recent conversation:
${conversationContext}

As a professional realtor would, provide expert guidance (2-3 sentences max) that moves the conversation forward strategically. Be knowledgeable, trustworthy, and proactive. Show expertise while remaining approachable.`;
      
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
