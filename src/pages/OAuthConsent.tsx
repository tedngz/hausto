import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";

// The supabase.auth.oauth namespace is beta; type it locally.
type OAuthApi = {
  getAuthorizationDetails: (id: string) => Promise<{ data: any; error: any }>;
  approveAuthorization: (id: string) => Promise<{ data: any; error: any }>;
  denyAuthorization: (id: string) => Promise<{ data: any; error: any }>;
};

function getOAuth(): OAuthApi | null {
  const a: any = (supabase as any).auth?.oauth;
  return a ?? null;
}

export default function OAuthConsent() {
  const [params] = useSearchParams();
  const authorizationId = params.get("authorization_id") ?? "";
  const [details, setDetails] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      if (!authorizationId) return setError("Missing authorization_id");
      const oauth = getOAuth();
      if (!oauth) {
        setError(
          "OAuth authorization server is not enabled on this Supabase project. Please enable OAuth 2.1 in the Supabase dashboard.",
        );
        return;
      }
      const { data: sess } = await supabase.auth.getSession();
      if (!sess.session) {
        const next = window.location.pathname + window.location.search;
        window.location.href = "/auth?next=" + encodeURIComponent(next);
        return;
      }
      const { data, error } = await oauth.getAuthorizationDetails(authorizationId);
      if (!active) return;
      if (error) return setError(error.message);
      const immediate = data?.redirect_url ?? data?.redirect_to;
      if (immediate && !data?.client) {
        window.location.href = immediate;
        return;
      }
      setDetails(data);
    })();
    return () => {
      active = false;
    };
  }, [authorizationId]);

  async function decide(approve: boolean) {
    const oauth = getOAuth();
    if (!oauth) return;
    setBusy(true);
    const { data, error } = approve
      ? await oauth.approveAuthorization(authorizationId)
      : await oauth.denyAuthorization(authorizationId);
    if (error) {
      setBusy(false);
      return setError(error.message);
    }
    const target = data?.redirect_url ?? data?.redirect_to;
    if (!target) {
      setBusy(false);
      return setError("No redirect returned by the authorization server.");
    }
    window.location.href = target;
  }

  return (
    <main className="mx-auto max-w-md p-8">
      {error ? (
        <div className="rounded-lg border border-destructive/50 bg-destructive/5 p-4 text-sm text-destructive">
          <p className="font-medium mb-1">Could not load this authorization request</p>
          <p>{error}</p>
        </div>
      ) : !details ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : (
        <>
          <h1 className="text-2xl font-semibold mb-2">
            Connect {details.client?.name ?? "an app"} to your Hausto account
          </h1>
          <p className="text-muted-foreground mb-6">
            This will let {details.client?.name ?? "the client"} search and view
            Hausto properties as you.
          </p>
          <div className="flex gap-3">
            <button
              disabled={busy}
              onClick={() => decide(true)}
              className="flex-1 rounded-md bg-primary px-4 py-2 text-primary-foreground font-medium disabled:opacity-50"
            >
              Approve
            </button>
            <button
              disabled={busy}
              onClick={() => decide(false)}
              className="flex-1 rounded-md border border-border px-4 py-2 font-medium disabled:opacity-50"
            >
              Deny
            </button>
          </div>
        </>
      )}
    </main>
  );
}
