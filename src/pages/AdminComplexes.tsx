import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, ShieldAlert, Save, Search, ArrowLeft, RefreshCw, X, Plus } from "lucide-react";
import { toast } from "sonner";
import type { Complex, RentBracket } from "@/hooks/useComplexes";

type BracketKey = "1br" | "2br" | "3br";
const BRACKET_KEYS: BracketKey[] = ["1br", "2br", "3br"];
const BRACKET_LABEL: Record<BracketKey, string> = {
  "1br": "1 Bedroom",
  "2br": "2 Bedroom",
  "3br": "3 Bedroom",
};

interface FormState {
  name: string;
  aliasesText: string;
  developer: string;
  management_company: string;
  hero_image: string;
  gallery: string[];
  brackets: Record<BracketKey, { min: string; max: string }>;
}

function complexToForm(c: Complex): FormState {
  const br = (c.average_rent_brackets ?? {}) as Record<string, RentBracket>;
  return {
    name: c.name ?? "",
    aliasesText: (c.aliases ?? []).join(", "),
    developer: c.developer ?? "",
    management_company: c.management_company ?? "",
    hero_image: c.hero_image ?? "",
    gallery: c.gallery ?? [],
    brackets: BRACKET_KEYS.reduce((acc, k) => {
      acc[k] = {
        min: br[k]?.min != null ? String(br[k].min) : "",
        max: br[k]?.max != null ? String(br[k].max) : "",
      };
      return acc;
    }, {} as FormState["brackets"]),
  };
}

const AdminComplexes = () => {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: isAdmin, isLoading: isCheckingRole } = useQuery({
    queryKey: ["is-admin", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      if (!user?.id) return false;
      const { data } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .eq("role", "admin")
        .maybeSingle();
      return !!data;
    },
  });

  const {
    data: complexes,
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ["admin-complexes-all"],
    enabled: !!user && !!isAdmin,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("complexes")
        .select("*")
        .order("name");
      if (error) throw error;
      return (data ?? []) as unknown as Complex[];
    },
  });

  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [newGalleryUrl, setNewGalleryUrl] = useState("");

  const selected = useMemo(
    () => complexes?.find((c) => c.id === selectedId) ?? null,
    [complexes, selectedId]
  );

  // Auto-select first on load
  useEffect(() => {
    if (!selectedId && complexes && complexes.length > 0) {
      setSelectedId(complexes[0].id);
    }
  }, [complexes, selectedId]);

  // Sync form whenever selection changes
  useEffect(() => {
    if (selected) setForm(complexToForm(selected));
  }, [selected]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!complexes) return [];
    if (!q) return complexes;
    return complexes.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.aliases ?? []).some((a) => a.toLowerCase().includes(q)) ||
        (c.district ?? "").toLowerCase().includes(q)
    );
  }, [complexes, search]);

  if (authLoading || isCheckingRole) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!user || !isAdmin) {
    return (
      <div className="container mx-auto flex min-h-[60vh] max-w-4xl flex-col items-center justify-center gap-4 px-3 py-4 text-center md:p-6">
        <ShieldAlert className="h-16 w-16 text-destructive" />
        <h1 className="text-2xl font-bold">Access Denied</h1>
        <p className="text-muted-foreground">
          You don't have permission to access this page.
        </p>
        <Button onClick={() => navigate("/")} variant="outline">
          Go Home
        </Button>
      </div>
    );
  }

  const handleSave = async () => {
    if (!selected || !form) return;
    setSaving(true);
    try {
      // Parse aliases
      const aliases = form.aliasesText
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

      // Parse brackets
      const brackets: Record<string, RentBracket> = {};
      for (const k of BRACKET_KEYS) {
        const minStr = form.brackets[k].min.trim();
        const maxStr = form.brackets[k].max.trim();
        if (!minStr && !maxStr) continue;
        const min = Number(minStr);
        const max = Number(maxStr);
        if (Number.isNaN(min) || Number.isNaN(max)) {
          throw new Error(`Invalid number in ${BRACKET_LABEL[k]} bracket`);
        }
        if (max < min) {
          throw new Error(`${BRACKET_LABEL[k]} max must be ≥ min`);
        }
        brackets[k] = { min, max };
      }

      const payload = {
        name: form.name.trim(),
        aliases,
        developer: form.developer.trim() || null,
        management_company: form.management_company.trim() || null,
        hero_image: form.hero_image.trim() || null,
        gallery: form.gallery.map((s) => s.trim()).filter(Boolean),
        average_rent_brackets: brackets,
      };

      const { error } = await supabase
        .from("complexes")
        .update(payload as any)
        .eq("id", selected.id);
      if (error) throw error;

      toast.success("Complex saved", {
        description: "Re-running listing matches…",
      });

      // Re-run matching logic: invalidate all complex + complex-listings queries
      // (matching is alias/name based via useComplexListings)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["complexes"] }),
        queryClient.invalidateQueries({ queryKey: ["complex"] }),
        queryClient.invalidateQueries({ queryKey: ["complex-listings"] }),
        queryClient.invalidateQueries({ queryKey: ["admin-complexes-all"] }),
      ]);
      await refetch();
    } catch (e: any) {
      toast.error("Save failed", { description: e?.message || String(e) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="container mx-auto max-w-7xl px-3 py-4 md:p-6">
      <div className="mb-4 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => navigate("/admin-tools")}>
            <ArrowLeft className="mr-1 h-4 w-4" /> Admin
          </Button>
          <h1 className="text-2xl font-bold">Complex Catalog</h1>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw className="mr-1 h-4 w-4" /> Refresh
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-[280px_1fr]">
        {/* List */}
        <Card className="h-fit md:sticky md:top-4">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Complexes ({complexes?.length ?? 0})</CardTitle>
            <div className="relative">
              <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name, alias, district…"
                className="pl-8"
              />
            </div>
          </CardHeader>
          <CardContent className="max-h-[70vh] space-y-1 overflow-y-auto p-2">
            {isLoading ? (
              <div className="flex justify-center py-6">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              filtered.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setSelectedId(c.id)}
                  className={`w-full rounded-md px-3 py-2 text-left text-sm transition-colors ${
                    c.id === selectedId
                      ? "bg-primary text-primary-foreground"
                      : "hover:bg-muted"
                  }`}
                >
                  <div className="font-medium">{c.name}</div>
                  <div
                    className={`truncate text-xs ${
                      c.id === selectedId
                        ? "text-primary-foreground/80"
                        : "text-muted-foreground"
                    }`}
                  >
                    {c.district}
                  </div>
                </button>
              ))
            )}
          </CardContent>
        </Card>

        {/* Editor */}
        <div>
          {!form || !selected ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                Select a complex to edit
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle>Edit: {selected.name}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="space-y-2">
                  <Label htmlFor="name">Name</Label>
                  <Input
                    id="name"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="aliases">Aliases (comma-separated)</Label>
                  <Input
                    id="aliases"
                    value={form.aliasesText}
                    onChange={(e) =>
                      setForm({ ...form, aliasesText: e.target.value })
                    }
                    placeholder="Vinhomes Central Park, VHCP, Landmark 81"
                  />
                  <p className="text-xs text-muted-foreground">
                    Aliases drive listing-to-complex matching. Add common short names &
                    Vietnamese spellings.
                  </p>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="developer">Developer</Label>
                    <Input
                      id="developer"
                      value={form.developer}
                      onChange={(e) =>
                        setForm({ ...form, developer: e.target.value })
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="mgmt">Management Company</Label>
                    <Input
                      id="mgmt"
                      value={form.management_company}
                      onChange={(e) =>
                        setForm({ ...form, management_company: e.target.value })
                      }
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="hero">Hero Image URL</Label>
                  <Input
                    id="hero"
                    value={form.hero_image}
                    onChange={(e) =>
                      setForm({ ...form, hero_image: e.target.value })
                    }
                    placeholder="https://…"
                  />
                  {form.hero_image && (
                    <img
                      src={form.hero_image}
                      alt="Hero preview"
                      className="mt-2 h-32 w-full rounded-md object-cover"
                      onError={(e) =>
                        ((e.target as HTMLImageElement).style.display = "none")
                      }
                    />
                  )}
                </div>

                <div className="space-y-3">
                  <Label>Base Rent Brackets (VND/month)</Label>
                  <div className="space-y-2">
                    {BRACKET_KEYS.map((k) => (
                      <div
                        key={k}
                        className="grid grid-cols-[100px_1fr_1fr] items-center gap-2"
                      >
                        <span className="text-sm text-muted-foreground">
                          {BRACKET_LABEL[k]}
                        </span>
                        <Input
                          type="number"
                          inputMode="numeric"
                          placeholder="min"
                          value={form.brackets[k].min}
                          onChange={(e) =>
                            setForm({
                              ...form,
                              brackets: {
                                ...form.brackets,
                                [k]: { ...form.brackets[k], min: e.target.value },
                              },
                            })
                          }
                        />
                        <Input
                          type="number"
                          inputMode="numeric"
                          placeholder="max"
                          value={form.brackets[k].max}
                          onChange={(e) =>
                            setForm({
                              ...form,
                              brackets: {
                                ...form.brackets,
                                [k]: { ...form.brackets[k], max: e.target.value },
                              },
                            })
                          }
                        />
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Stored as JSON. Use raw VND (e.g. 25000000 for 25M).
                  </p>
                </div>

                <div className="flex items-center justify-end gap-2 border-t pt-4">
                  <Button
                    variant="outline"
                    onClick={() => setForm(complexToForm(selected))}
                    disabled={saving}
                  >
                    Reset
                  </Button>
                  <Button onClick={handleSave} disabled={saving}>
                    {saving ? (
                      <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                    ) : (
                      <Save className="mr-1 h-4 w-4" />
                    )}
                    Save & Re-match
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
};

export default AdminComplexes;
