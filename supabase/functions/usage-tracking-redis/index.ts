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

    // Extract user ID from JWT in Authorization header (Supabase already verified JWT)
    const authHeader = req.headers.get('Authorization');

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      console.error('[Usage Tracking] Missing or invalid Authorization header');
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // SECURITY: cryptographically verify the JWT instead of trusting client-decoded payload
    let userId: string;
    try {
      const token = authHeader.replace('Bearer ', '');
      const { data: { user }, error: userError } = await supabaseClient.auth.getUser(token);
      if (userError || !user) throw new Error(userError?.message || 'Invalid token');
      userId = user.id;
    } catch (err) {
      console.error('[Usage Tracking] Failed to verify JWT:', err);
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { action, type, propertyId } = await req.json();
    const today = new Date().toISOString().split('T')[0];
    
    // Determine subscription status (premium users have no limits)
    const { data: subscription, error: subError } = await supabaseClient
      .from('subscribers')
      .select('subscribed, subscription_tier')
      .eq('user_id', userId)
      .maybeSingle();

    if (subError) {
      console.error('[Usage Tracking] Error fetching subscription status:', subError);
    }

    const isPremium = !!subscription?.subscribed && subscription.subscription_tier === 'premium';

    
    // Calculate week start (7 days ago)
    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - 6);
    const weekStartStr = weekStart.toISOString().split('T')[0];

    console.log(`[Usage Tracking] User: ${userId}, Action: ${action}, Type: ${type}, Date: ${today}`);

    if (action === 'get') {
      // Get current usage from Redis
      const viewsKey = `usage:${userId}:${today}:views`; // This is now a SET of unique property IDs
      const matchesKey = `usage:${userId}:${today}:matches`;
      const aiKey = `usage:${userId}:${today}:ai`;
      const quizKey = `usage:${userId}:${today}:quiz`;

      const [views, matches, ai, quiz] = await Promise.all([
        redis.scard(viewsKey), // Count unique properties in SET
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
        weeklyPromises.push(redis.get(`usage:${userId}:${dateStr}:matches`));
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
      let newCount: number;
      let dbField: string;

      switch (type) {
        case 'view': {
          // For views, track unique property IDs in a SET
          if (!propertyId) {
            return new Response(JSON.stringify({ error: 'propertyId required for view tracking' }), {
              status: 400,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
          }
          
          const viewsKey = `usage:${userId}:${today}:views`;

          // Enforce daily view limit for non-premium users at the server level
          const currentCount = await redis.scard(viewsKey);
          if (!isPremium && currentCount >= 10) {
            console.log(`[Usage Tracking] Daily view limit reached for user ${userId}: ${currentCount}`);
            newCount = currentCount;
            dbField = 'properties_viewed';
            break;
          }
          
          await redis.sadd(viewsKey, propertyId); // Add property ID to SET
          await redis.expire(viewsKey, 60 * 60 * 48); // 48 hours
          newCount = await redis.scard(viewsKey); // Get count of unique properties
          dbField = 'properties_viewed';
          console.log(`[Usage Tracking] Added property ${propertyId} to views, unique count: ${newCount}`);
          break;
        }
        case 'match': {
          const matchesKey = `usage:${userId}:${today}:matches`;
          newCount = await redis.incr(matchesKey);
          await redis.expire(matchesKey, 60 * 60 * 48);
          dbField = 'properties_matched';
          console.log(`[Usage Tracking] Incremented matches: ${newCount}`);
          break;
        }
        case 'ai-search': {
          const aiKey = `usage:${userId}:${today}:ai`;
          newCount = await redis.incr(aiKey);
          await redis.expire(aiKey, 60 * 60 * 48);
          dbField = 'ai_requests';
          console.log(`[Usage Tracking] Incremented AI searches: ${newCount}`);
          break;
        }
        case 'quiz': {
          const quizKey = `usage:${userId}:${today}:quiz`;
          newCount = await redis.incr(quizKey);
          await redis.expire(quizKey, 60 * 60 * 48);
          dbField = 'quiz_retakes';
          console.log(`[Usage Tracking] Incremented quiz retakes: ${newCount}`);
          break;
        }
        default:
          return new Response(JSON.stringify({ error: 'Invalid type' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
      }

      // Sync to database for historical records (async, don't wait)
      supabaseClient
        .from('daily_usage')
        .upsert(
          {
            user_id: userId,
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
