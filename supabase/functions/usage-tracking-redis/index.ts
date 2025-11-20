import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.50.4';
import { Redis } from 'https://esm.sh/@upstash/redis@latest';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface UsageData {
  propertiesViewed: number;
  propertiesMatched: number;
  aiSearches: number;
  quizRetakes: number;
  weeklyMatches: number;
}

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Initialize Redis client
    const redis = new Redis({
      url: Deno.env.get('UPSTASH_REDIS_REST_URL')!,
      token: Deno.env.get('UPSTASH_REDIS_REST_TOKEN')!,
    });

    // Initialize Supabase client
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          headers: { Authorization: req.headers.get('Authorization')! },
        },
      }
    );

    // Get the user
    const {
      data: { user },
      error: userError,
    } = await supabaseClient.auth.getUser();

    if (userError || !user) {
      console.error('Auth error:', userError);
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { action, type } = await req.json();
    const today = new Date().toISOString().split('T')[0];
    
    // Calculate week start (7 days ago)
    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - 6);
    const weekStartStr = weekStart.toISOString().split('T')[0];

    console.log(`[Usage Tracking] User: ${user.id}, Action: ${action}, Type: ${type}, Date: ${today}`);

    if (action === 'get') {
      // Get current usage from Redis
      const viewsKey = `usage:${user.id}:${today}:views`;
      const matchesKey = `usage:${user.id}:${today}:matches`;
      const aiKey = `usage:${user.id}:${today}:ai`;
      const quizKey = `usage:${user.id}:${today}:quiz`;

      const [views, matches, ai, quiz] = await Promise.all([
        redis.get(viewsKey),
        redis.get(matchesKey),
        redis.get(aiKey),
        redis.get(quizKey),
      ]);

      // Get weekly matches (sum from last 7 days)
      let weeklyMatches = 0;
      const weeklyPromises = [];
      for (let i = 0; i < 7; i++) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        const dateStr = date.toISOString().split('T')[0];
        weeklyPromises.push(redis.get(`usage:${user.id}:${dateStr}:matches`));
      }
      
      const weeklyResults = await Promise.all(weeklyPromises);
      weeklyMatches = weeklyResults.reduce((sum, val) => sum + (Number(val) || 0), 0);

      const usageData: UsageData = {
        propertiesViewed: Number(views) || 0,
        propertiesMatched: Number(matches) || 0,
        aiSearches: Number(ai) || 0,
        quizRetakes: Number(quiz) || 0,
        weeklyMatches,
      };

      console.log('[Usage Tracking] Retrieved usage:', usageData);

      return new Response(JSON.stringify(usageData), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'increment') {
      // Increment usage counter in Redis
      let key: string;
      let dbField: string;

      switch (type) {
        case 'view':
          key = `usage:${user.id}:${today}:views`;
          dbField = 'properties_viewed';
          break;
        case 'match':
          key = `usage:${user.id}:${today}:matches`;
          dbField = 'properties_matched';
          break;
        case 'ai-search':
          key = `usage:${user.id}:${today}:ai`;
          dbField = 'ai_requests';
          break;
        case 'quiz':
          key = `usage:${user.id}:${today}:quiz`;
          dbField = 'quiz_retakes';
          break;
        default:
          return new Response(JSON.stringify({ error: 'Invalid type' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
      }

      // Increment in Redis with 48-hour expiry
      const newCount = await redis.incr(key);
      await redis.expire(key, 60 * 60 * 48); // 48 hours

      console.log(`[Usage Tracking] Incremented ${type}: ${newCount}`);

      // Sync to database for historical records (async, don't wait)
      supabaseClient
        .from('daily_usage')
        .upsert(
          {
            user_id: user.id,
            usage_date: today,
            [dbField]: newCount,
          },
          {
            onConflict: 'user_id,usage_date',
          }
        )
        .then(({ error }) => {
          if (error) {
            console.error('[Usage Tracking] DB sync error:', error);
          } else {
            console.log(`[Usage Tracking] Synced to DB: ${dbField} = ${newCount}`);
          }
        });

      return new Response(JSON.stringify({ success: true, count: newCount }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Invalid action' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('[Usage Tracking] Error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
