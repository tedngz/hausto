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
    const { userType, messages, properties, action, isPremium } = await req.json();
    
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      throw new Error('LOVABLE_API_KEY not configured');
    }

    // Build context from properties
    const propertyContext = properties?.map((p: any, i: number) => 
      `Property ${i + 1}: ${p.title} at ${p.location} - $${p.price}/mo`
    ).join('\n') || 'No properties in conversation';
    
    // Get provider contact info from property (could be single or first in array)
    const targetProperty = Array.isArray(properties) && properties.length > 0 ? properties[0] : properties;
    const providerName = targetProperty?.property_source_provider_name;
    const providerPhone = targetProperty?.property_source_provider_phone;
    const propertyTitle = targetProperty?.title;
    
    // Debug logging to verify provider data
    console.log('Provider info received:', { 
      providerName, 
      providerPhone,
      propertyTitle,
      hasProperties: properties?.length > 0,
      isArray: Array.isArray(properties)
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
          // Check if we have multiple properties - prompt user to select
          if (Array.isArray(properties) && properties.length > 1) {
            const propertyList = properties.map((p: any, i: number) => 
              `${i + 1}. ${p.title} (${p.location})`
            ).join('\n');
            
            const suggestion = `You have ${properties.length} matched properties! Which one would you like to contact the provider for?\n\n${propertyList}\n\nPlease select a property to see the listing provider's contact information.`;
            
            return new Response(
              JSON.stringify({ 
                suggestion, 
                suggestedActions: [],
                requirePropertySelection: true,
                availableProperties: properties.map((p: any, i: number) => ({
                  index: i,
                  id: p.id || p.property_id,
                  title: p.title,
                  location: p.location,
                  price: p.price,
                  providerName: p.property_source_provider_name,
                  providerPhone: p.property_source_provider_phone,
                  images: p.images
                }))
              }),
              {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 200,
              }
            );
          }

          // Single property or selected property - provide contact info
          if (!providerName || !providerPhone) {
            const suggestion = `I don't have the listing provider's contact information for "${propertyTitle || 'this property'}". The listing may not have contact details available. You can try viewing the original property listing for more information.`;
            return new Response(
              JSON.stringify({ suggestion, suggestedActions: [] }),
              {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 200,
              }
            );
          }

          const suggestion = `📞 Listing Provider Contact for "${propertyTitle}"\n\nName: ${providerName}\nPhone: ${providerPhone}\n\nFeel free to reach out directly to schedule a viewing. Good luck with your property search! 🏡`;

          return new Response(
            JSON.stringify({ suggestion, suggestedActions: [] }),
            {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
              status: 200,
            }
          );
        }
        case 'get_fast_track':
          if (isPremium) {
            systemPrompt = `You are Hausto AI, a renter support assistant. The renter selected "Get Fast Track" and they ARE a premium subscriber.

Ask them for their preferred viewing schedule (dates, times, and any special requirements). Let them know that Hausto Agent will coordinate with up to 3 listing providers and provide them with the viewing address and timeline at no extra cost.

Keep response to 2-3 sentences.`;
          } else {
            systemPrompt = `You are Hausto AI, a renter support assistant. The renter selected "Get Fast Track" but they are NOT a premium subscriber.

Politely explain that Fast Track is a premium service where Hausto Agent handles all coordination with listing providers (up to 3 properties) at no extra cost. Encourage them to upgrade to premium to access this convenient service.

Keep response to 2-3 sentences.`;
          }
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
