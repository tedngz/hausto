import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { message, conversationId, userType } = await req.json()
    
    if (!message || !conversationId || !userType) {
      throw new Error('Missing required parameters')
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // Get conversation history
    const { data: messages } = await supabase
      .from('support_messages')
      .select('content, role')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true })
      .limit(20) // Last 20 messages for context

    const conversationHistory = messages?.map(msg => ({
      role: msg.role,
      content: msg.content
    })) || []

    // Create AI prompt based on user type and context
    const systemPrompt = `You are Hausto AI Assistant, a helpful customer support agent for a property rental platform. You help ${userType}s with:

${userType === 'renter' ? `
- Finding suitable properties
- Understanding the matching process
- Account and profile management
- Subscription questions
- App navigation and features
` : `
- Property listing management
- Profile optimization
- Understanding matches and leads
- Subscription and billing
- Platform features for realtors
`}

Be friendly, professional, and concise. Provide specific help relevant to their role as a ${userType}. If you don't know something specific about the platform, acknowledge that and suggest they contact direct support.`

    const openAIResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${Deno.env.get('OPENAI_API_KEY')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          ...conversationHistory,
          { role: 'user', content: message }
        ],
        max_tokens: 500,
        temperature: 0.7,
      }),
    })

    if (!openAIResponse.ok) {
      throw new Error(`OpenAI API error: ${openAIResponse.statusText}`)
    }

    const openAIData = await openAIResponse.json()
    const aiResponse = openAIData.choices[0]?.message?.content || 'I apologize, but I encountered an error. Please try again.'

    // Save AI response to database
    const { error: insertError } = await supabase
      .from('support_messages')
      .insert({
        conversation_id: conversationId,
        content: aiResponse,
        role: 'assistant'
      })

    if (insertError) {
      console.error('Error saving AI response:', insertError)
    }

    // Update conversation timestamp
    await supabase
      .from('support_conversations')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', conversationId)

    return new Response(
      JSON.stringify({ response: aiResponse }),
      { 
        headers: { 
          ...corsHeaders, 
          'Content-Type': 'application/json' 
        } 
      }
    )

  } catch (error) {
    console.error('Error in support-ai function:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        status: 500, 
        headers: { 
          ...corsHeaders, 
          'Content-Type': 'application/json' 
        } 
      }
    )
  }
})