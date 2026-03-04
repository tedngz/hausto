

## Problem

The `chat-ai` edge function fails to authenticate logged-in users. The log shows: `"Invalid token, treating as anonymous user. Error: Auth session missing!"`. This happens because `getClaims()` is not a valid method on the Supabase JS client.

The user has already used 2/2 anonymous searches, so every request gets rate-limited even though they're logged in.

## Root Cause

`supabase.auth.getClaims(token)` does not exist in the Supabase JS SDK. The previous attempt to use `getUser(token)` also failed because it was called on an anon-key client without proper context.

## Fix

**In `supabase/functions/chat-ai/index.ts`** (lines 939-953): Replace the `getClaims` approach with `supabase.auth.getUser(token)` called on the **service role** client, which can validate any user's JWT without needing an active session:

```typescript
if (!isAnonKey && token.length > 100) {
  // Use the service role client to validate the user JWT
  const { data: userData, error: authError } = await supabase.auth.getUser(token);
  
  if (!authError && userData.user) {
    user = { id: userData.user.id, email: userData.user.email };
    console.log('Authenticated user:', user.id);
  } else {
    console.log('Invalid token, treating as anonymous user. Error:', authError?.message);
    isAnonymous = true;
  }
}
```

The key insight: the `supabase` client (line 925) is already initialized with the **service role key**, which has the authority to validate any user token via `auth.getUser(token)`. Previous attempts used an anon-key client, which lacks this capability.

This is a single-line change in the edge function, followed by redeployment.

