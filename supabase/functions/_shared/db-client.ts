// Shared cross-project DB client.
//
// When this edge function is deployed on the SELF-OWNED Supabase project
// (joxxcvxbsjedzkfpmkfc) but the actual Postgres database lives on the
// LOVABLE-MANAGED project (gbgrwjdmytaksrztcyzs), we cannot use the runtime's
// auto-injected SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (those point at the
// self-owned project's empty DB).
//
// Instead we read LOVABLE_DB_* secrets that must be set on the new project:
//   - LOVABLE_DB_URL                 = https://gbgrwjdmytaksrztcyzs.supabase.co
//   - LOVABLE_DB_SERVICE_ROLE_KEY    = current Lovable service role key
//   - LOVABLE_DB_ANON_KEY            = current Lovable anon/publishable key
//
// During the migration window this helper falls back to SUPABASE_* env vars
// so the same code keeps working on the Lovable-managed deployment too.

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export function getDbUrl(): string {
  return Deno.env.get("LOVABLE_DB_URL") ?? Deno.env.get("SUPABASE_URL")!;
}

export function getDbServiceRoleKey(): string {
  return (
    Deno.env.get("LOVABLE_DB_SERVICE_ROLE_KEY") ??
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );
}

export function getDbAnonKey(): string {
  return (
    Deno.env.get("LOVABLE_DB_ANON_KEY") ??
    Deno.env.get("SUPABASE_ANON_KEY") ??
    Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!
  );
}

export function getDbPublishableKey(): string | undefined {
  return (
    Deno.env.get("LOVABLE_DB_ANON_KEY") ??
    Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ??
    Deno.env.get("SUPABASE_ANON_KEY")
  );
}

export function createServiceClient(): SupabaseClient {
  return createClient(getDbUrl(), getDbServiceRoleKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function createAnonClient(): SupabaseClient {
  return createClient(getDbUrl(), getDbAnonKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
