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
          systemPrompt = `You are Hausto AI, a professional real estate assistant. The ${userType} wants to schedule a property viewing. As a knowledgeable realtor, guide them through the scheduling process:
- Ask about their preferred dates and time slots (weekdays vs weekends, morning/afternoon/evening)
- Mention typical viewing duration (30-45 minutes)
- Offer to coordinate with the other party
Keep your response professional yet warm, 2-3 sentences.`;
          break;
        case 'discuss_price':
          systemPrompt = `You are Hausto AI, a professional real estate negotiation assistant. The ${userType} wants to discuss pricing. As an experienced realtor, help facilitate the negotiation:
- If they're a renter: Ask about their budget range and what value they're looking for
- If they're a realtor: Help them understand the renter's perspective and find common ground
- Mention market conditions or property value factors when relevant
Keep your response professional and strategic, 2-3 sentences.`;
          break;
        case 'ask_amenities':
          systemPrompt = `You are Hausto AI, a professional real estate consultant. The ${userType} wants to know more about amenities. As a knowledgeable realtor, guide the conversation:
- Ask which specific amenities matter most (parking, laundry, gym, storage, etc.)
- Help prioritize must-haves vs nice-to-haves
- Connect amenities to lifestyle needs
Keep your response professional and consultative, 2-3 sentences.`;
          break;
        case 'request_documents':
          systemPrompt = `You are Hausto AI, a professional real estate transaction assistant. The ${userType} wants to request documents. As an experienced realtor, guide them through the documentation process:
- List common documents needed (lease agreement, proof of income, ID, references for renters; property deed, inspection reports for realtors)
- Explain the purpose of key documents
- Offer to help coordinate the exchange
Keep your response professional and organized, 2-3 sentences.`;
          break;
        case 'get_provider_contact':
          if (providerName && providerPhone) {
            return new Response(
              JSON.stringify({ 
                suggestion: `Here's the listing provider's contact information:\n\n📋 Provider: ${providerName}\n📞 Phone: ${providerPhone}\n\nThis is the original source where the property was listed. You can contact them directly for more details about the property, schedule viewings, or discuss terms.`,
                suggestedActions: []
              }),
              { 
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 200 
              }
            );
          } else {
            return new Response(
              JSON.stringify({ 
                suggestion: `I apologize, but the listing provider's contact information is not available for this property. The contact details may not have been included when the property was imported. Please ask the property owner in this conversation for alternative contact options.`,
                suggestedActions: []
              }),
              { 
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 200 
              }
            );
          }
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
      
      // Suggest relevant actions based on conversation and user type
      // Put get_provider_contact first so renters can easily call the listing provider
      suggestedActions = ['get_provider_contact', 'schedule_viewing', 'discuss_price', 'ask_amenities', 'request_documents'];
      
      // Always include provider contact action; the function will handle missing info gracefully
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
