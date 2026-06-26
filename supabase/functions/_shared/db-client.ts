import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export function getDbUrl(): string {
  return Deno.env.get("SUPABASE_URL")!;
}

export function getDbServiceRoleKey(): string {
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
}

export function getDbAnonKey(): string {
  return Deno.env.get("SUPABASE_ANON_KEY")!;
}

// NOTE: This fallback relies on the anon key in local dev if publishable key is not set.
// VITE_SUPABASE_PUBLISHABLE_KEY is typically only available on the frontend.
export function getDbPublishableKey(): string {
  return Deno.env.get("VITE_SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!;
}

let _dbClient: SupabaseClient | null = null;

export function getServiceClient(): SupabaseClient {
  if (!_dbClient) {
    const supabaseUrl = getDbUrl();
    const supabaseKey = getDbServiceRoleKey();
    if (!supabaseUrl || !supabaseKey) {
      throw new Error("Supabase URL or Service Role Key missing from environment");
    }
    _dbClient = createClient(supabaseUrl, supabaseKey);
  }
  return _dbClient;
}

