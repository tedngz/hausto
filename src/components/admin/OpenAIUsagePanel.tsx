import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2 } from "lucide-react";

interface Row {
  day: string;
  fn: string;
  model: string;
  calls: number;
  prompt_tokens: number;
  completion_tokens: number;
  images: number;
  estimated_usd: number;
}

export function OpenAIUsagePanel() {
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(7);

  useEffect(() => {
    let cancel = false;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase.rpc("get_openai_usage_summary", { _days: days });
      if (!cancel) {
        if (error) {
          console.error("[OpenAIUsage]", error);
          setError(error.message);
          setRows([]);
        } else {
          setError(null);
          setRows((data as Row[]) || []);
        }
        setLoading(false);
      }
    })();
    return () => { cancel = true; };
  }, [days]);

  const totalUsd = rows.reduce((s, r) => s + Number(r.estimated_usd || 0), 0);
  const byDay = new Map<string, number>();
  const byFn = new Map<string, number>();
  for (const r of rows) {
    byDay.set(r.day, (byDay.get(r.day) || 0) + Number(r.estimated_usd || 0));
    byFn.set(r.fn, (byFn.get(r.fn) || 0) + Number(r.estimated_usd || 0));
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>AI Usage & Cost</CardTitle>
        <CardDescription>
          Estimated spend over the last {days} days · Total: <b>${totalUsd.toFixed(4)}</b>
        </CardDescription>
        <div className="flex gap-2 pt-2">
          {[1, 3, 7, 14, 30].map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`text-xs px-2 py-1 rounded border ${days === d ? "bg-primary text-primary-foreground" : "bg-background"}`}
            >
              {d}d
            </button>
          ))}
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : error ? (
          <p className="text-sm text-destructive">Could not load usage: {error}</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No usage recorded yet.</p>
        ) : (
          <div className="space-y-4">
            <div>
              <h4 className="text-sm font-semibold mb-1">By day</h4>
              <div className="text-xs space-y-1">
                {[...byDay.entries()].sort().reverse().map(([d, v]) => (
                  <div key={d} className="flex justify-between">
                    <span>{d}</span>
                    <span className="font-mono">${v.toFixed(4)}</span>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <h4 className="text-sm font-semibold mb-1">By function</h4>
              <div className="text-xs space-y-1">
                {[...byFn.entries()].sort((a, b) => b[1] - a[1]).map(([fn, v]) => (
                  <div key={fn} className="flex justify-between">
                    <span className="truncate">{fn}</span>
                    <span className="font-mono">${v.toFixed(4)}</span>
                  </div>
                ))}
              </div>
            </div>
            <details>
              <summary className="text-xs cursor-pointer text-muted-foreground">Raw rows</summary>
              <div className="text-xs mt-2 max-h-64 overflow-auto font-mono">
                {rows.map((r, i) => (
                  <div key={i} className="border-b py-1">
                    {r.day} · {r.fn} · {r.model} · calls={r.calls} · pt={r.prompt_tokens} · ct={r.completion_tokens} · imgs={r.images} · ${Number(r.estimated_usd).toFixed(4)}
                  </div>
                ))}
              </div>
            </details>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
