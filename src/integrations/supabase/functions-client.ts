// Functions-only Supabase client.
//
// This client exists ONLY to invoke Edge Functions on the self-owned Supabase
// project (joxxcvxbsjedzkfpmkfc), where compute is not metered by Lovable.
// Database/auth/storage continue to use the main client in ./client.ts which
// points at the Lovable-managed project.
//
// To enable, add to .env:
//   VITE_FUNCTIONS_SUPABASE_URL="https://joxxcvxbsjedzkfpmkfc.supabase.co"
//   VITE_FUNCTIONS_SUPABASE_ANON_KEY="<anon key from new project Settings/API>"
//
// When those env vars are absent, this falls back to the main client so the
// app keeps working on the current Lovable Cloud deployment.

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { supabase as mainClient } from "./client";

const FN_URL = import.meta.env.VITE_FUNCTIONS_SUPABASE_URL as string | undefined;
const FN_KEY = import.meta.env.VITE_FUNCTIONS_SUPABASE_ANON_KEY as string | undefined;

let _functionsClient: SupabaseClient | null = null;

function getFunctionsClient(): SupabaseClient {
  if (!FN_URL || !FN_KEY) return mainClient as unknown as SupabaseClient;
  if (!_functionsClient) {
    _functionsClient = createClient(FN_URL, FN_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return _functionsClient;
}

/**
 * Invoke an Edge Function on the migrated (self-owned) Supabase project.
 * Forwards the current Lovable-project user JWT (if any) so the function can
 * still verify the caller against the Lovable auth.users table.
 */
export async function invokeFunction<T = unknown>(
  name: string,
  options: { body?: unknown; headers?: Record<string, string> } = {},
): Promise<{ data: T | null; error: Error | null }> {
  const client = getFunctionsClient();
  const headers: Record<string, string> = { ...(options.headers ?? {}) };

  // Forward the Lovable-project user JWT so cross-project auth verification works.
  if (!headers["Authorization"] && !headers["authorization"]) {
    const { data } = await mainClient.auth.getSession();
    const token = data.session?.access_token;
    if (token) headers["Authorization"] = `Bearer ${token}`;
  }

  return client.functions.invoke<T>(name, { body: options.body, headers });
}

export const functionsClient = { invoke: invokeFunction };
