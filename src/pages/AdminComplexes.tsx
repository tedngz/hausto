import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, ShieldAlert, Save, Search, ArrowLeft, RefreshCw, X, Plus, Upload } from "lucide-react";
import { toast } from "sonner";
import type { Complex, RentBracket } from "@/hooks/useComplexes";

type BracketKey = "1br" | "2br" | "3br";
const BRACKET_KEYS: BracketKey[] = ["1br", "2br", "3br"];
const BRACKET_LABEL: Record<BracketKey, string> = {
  "1br": "1 Bedroom",
  "2br": "2 Bedroom",
  "3br": "3 Bedroom",
};

interface CommuteRow { label: string; value: string }

interface FormState {
  name: string;
  aliasesText: string;
  developer: string;
  management_company: string;
  hero_image: string;
  gallery: string[];
  brackets: Record<BracketKey, { min: string; max: string }>;
  tags: string[];
  tagline: string;
  description: string;
  pet_policy: string;
  amenities: string[];
  insider_pros: string[];
  insider_cons: string[];
  commute: CommuteRow[];
}

function complexToForm(c: Complex): FormState {
  const br = (c.average_rent_brackets ?? {}) as Record<string, RentBracket>;
  const commute = c.commute_times
    ? Object.entries(c.commute_times).map(([label, value]) => ({ label, value: String(value) }))
    : [];
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
    tags: c.tags ?? [],
    tagline: c.tagline ?? "",
    description: c.description ?? "",
    pet_policy: c.pet_policy ?? "",
    amenities: c.amenities ?? [],
    insider_pros: c.insider_pros ?? [],
    insider_cons: c.insider_cons ?? [],
    commute,
  };
}

/** Editable list of short tag-like strings */
function TagListEditor({
  values,
  onChange,
  placeholder,
}: {
  values: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const v = draft.trim();
    if (!v) return;
    onChange([...values, v]);
    setDraft("");
  };
  return (
    <div className="space-y-2">
      {values.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {values.map((v, i) => (
            <span
              key={v + i}
              className="inline-flex items-center gap-1 rounded-full bg-secondary px-2.5 py-1 text-xs"
            >
              {v}
              <button
                type="button"
                onClick={() => onChange(values.filter((_, idx) => idx !== i))}
                aria-label={`Remove ${v}`}
                className="text-muted-foreground hover:text-destructive"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={placeholder ?? "Add item…"}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
        />
        <Button type="button" variant="outline" onClick={add}>
          <Plus className="mr-1 h-4 w-4" /> Add
        </Button>
      </div>
    </div>
  );
}

/** Editable list of longer text bullets (insider pros/cons) */
function BulletListEditor({
  values,
  onChange,
  placeholder,
}: {
  values: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
}) {
  return (
    <div className="space-y-2">
      {values.map((v, i) => (
        <div key={i} className="flex gap-2">
          <Textarea
            value={v}
            onChange={(e) => {
              const next = [...values];
              next[i] = e.target.value;
              onChange(next);
            }}
            rows={2}
            className="min-h-[60px]"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => onChange(values.filter((_, idx) => idx !== i))}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => onChange([...values, ""])}
      >
        <Plus className="mr-1 h-4 w-4" /> Add {placeholder ?? "bullet"}
      </Button>
    </div>
  );
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
  const [uploadingHero, setUploadingHero] = useState(false);
  const [uploadingGallery, setUploadingGallery] = useState(false);

  const uploadImage = async (file: File): Promise<string> => {
    if (!user?.id) throw new Error("Not authenticated");
    if (!selected?.id) throw new Error("No complex selected");
    if (!file.type.startsWith("image/")) throw new Error("File must be an image");
    if (file.size > 10 * 1024 * 1024) throw new Error("Image must be under 10MB");
    const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
    const path = `${user.id}/complexes/${selected.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error } = await supabase.storage
      .from("property-images")
      .upload(path, file, { cacheControl: "3600", upsert: false, contentType: file.type });
    if (error) throw error;
    const { data } = supabase.storage.from("property-images").getPublicUrl(path);
    return data.publicUrl;
  };

  const selected = useMemo(
    () => complexes?.find((c) => c.id === selectedId) ?? null,
    [complexes, selectedId]
  );

  useEffect(() => {
    if (!selectedId && complexes && complexes.length > 0) {
      setSelectedId(complexes[0].id);
    }
  }, [complexes, selectedId]);

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
      const aliases = form.aliasesText
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

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

      const commute_times: Record<string, string> = {};
      for (const row of form.commute) {
        const label = row.label.trim();
        const value = row.value.trim();
        if (label && value) commute_times[label] = value;
      }

      const payload = {
        name: form.name.trim(),
        aliases,
        developer: form.developer.trim() || null,
        management_company: form.management_company.trim() || null,
        hero_image: form.hero_image.trim() || null,
        gallery: form.gallery.map((s) => s.trim()).filter(Boolean),
        average_rent_brackets: brackets,
        tags: form.tags.map((s) => s.trim()).filter(Boolean),
        tagline: form.tagline.trim() || null,
        description: form.description.trim() || null,
        pet_policy: form.pet_policy.trim() || null,
        amenities: form.amenities.map((s) => s.trim()).filter(Boolean),
        insider_pros: form.insider_pros.map((s) => s.trim()).filter(Boolean),
        insider_cons: form.insider_cons.map((s) => s.trim()).filter(Boolean),
        commute_times,
      };

      const { error } = await supabase
        .from("complexes")
        .update(payload as any)
        .eq("id", selected.id);
      if (error) throw error;

      toast.success("Complex saved", {
        description: "Re-running listing matches…",
      });

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
              <CardContent className="space-y-6">
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
                    Aliases drive listing-to-complex matching.
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

                {/* Card highlights (tags) */}
                <div className="space-y-2">
                  <Label>Card Highlights (tags)</Label>
                  <p className="text-xs text-muted-foreground">
                    Shown as badges on the complex card &amp; at the top of the detail page. First 2 appear on cards.
                  </p>
                  <TagListEditor
                    values={form.tags}
                    onChange={(tags) => setForm({ ...form, tags })}
                    placeholder="e.g. Pet Friendly, Savills Managed"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="tagline">Tagline</Label>
                  <Input
                    id="tagline"
                    value={form.tagline}
                    onChange={(e) => setForm({ ...form, tagline: e.target.value })}
                    placeholder="Short italicized line under the title"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="hero">Hero Image</Label>
                  <div className="flex gap-2">
                    <Input
                      id="hero"
                      value={form.hero_image}
                      onChange={(e) =>
                        setForm({ ...form, hero_image: e.target.value })
                      }
                      placeholder="Paste image URL or upload…"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      disabled={uploadingHero}
                      onClick={() => document.getElementById("hero-file")?.click()}
                    >
                      {uploadingHero ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <><Upload className="mr-1 h-4 w-4" /> Upload</>
                      )}
                    </Button>
                    <input
                      id="hero-file"
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        e.target.value = "";
                        if (!file) return;
                        setUploadingHero(true);
                        try {
                          const url = await uploadImage(file);
                          setForm((f) => (f ? { ...f, hero_image: url } : f));
                          toast.success("Hero image uploaded");
                        } catch (err: any) {
                          toast.error("Upload failed", { description: err?.message || String(err) });
                        } finally {
                          setUploadingHero(false);
                        }
                      }}
                    />
                  </div>
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

                {/* Environment & vibe */}
                <div className="space-y-2">
                  <Label htmlFor="description">Environment &amp; vibe</Label>
                  <Textarea
                    id="description"
                    rows={6}
                    value={form.description}
                    onChange={(e) =>
                      setForm({ ...form, description: e.target.value })
                    }
                    placeholder="Long-form description of the complex, vibe, surroundings…"
                  />
                </div>

                {/* Gallery */}
                <div className="space-y-2">
                  <Label>Inside Complex Gallery ({form.gallery.length})</Label>
                  <p className="text-xs text-muted-foreground">
                    First 6 are displayed; first image is featured.
                  </p>
                  {form.gallery.length > 0 && (
                    <div className="grid grid-cols-3 gap-2 md:grid-cols-4">
                      {form.gallery.map((src, i) => (
                        <div
                          key={src + i}
                          className="group relative aspect-square overflow-hidden rounded-md border bg-muted"
                        >
                          <img
                            src={src}
                            alt={`Gallery ${i + 1}`}
                            className="h-full w-full object-cover"
                            onError={(e) =>
                              ((e.target as HTMLImageElement).style.opacity = "0.3")
                            }
                          />
                          <div className="absolute left-1 top-1 rounded bg-background/80 px-1.5 py-0.5 text-[10px] font-medium">
                            #{i + 1}
                          </div>
                          <div className="absolute inset-x-1 bottom-1 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                            {i > 0 && (
                              <Button
                                type="button"
                                size="sm"
                                variant="secondary"
                                className="h-6 flex-1 px-1 text-xs"
                                onClick={() => {
                                  const g = [...form.gallery];
                                  [g[i - 1], g[i]] = [g[i], g[i - 1]];
                                  setForm({ ...form, gallery: g });
                                }}
                              >
                                ←
                              </Button>
                            )}
                            {i < form.gallery.length - 1 && (
                              <Button
                                type="button"
                                size="sm"
                                variant="secondary"
                                className="h-6 flex-1 px-1 text-xs"
                                onClick={() => {
                                  const g = [...form.gallery];
                                  [g[i], g[i + 1]] = [g[i + 1], g[i]];
                                  setForm({ ...form, gallery: g });
                                }}
                              >
                                →
                              </Button>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() =>
                              setForm({
                                ...form,
                                gallery: form.gallery.filter((_, idx) => idx !== i),
                              })
                            }
                            className="absolute right-1 top-1 rounded-full bg-destructive p-1 text-destructive-foreground opacity-0 transition-opacity group-hover:opacity-100"
                            aria-label="Remove image"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="flex gap-2">
                    <Input
                      value={newGalleryUrl}
                      onChange={(e) => setNewGalleryUrl(e.target.value)}
                      placeholder="Paste image URL to add…"
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          const url = newGalleryUrl.trim();
                          if (url) {
                            setForm({ ...form, gallery: [...form.gallery, url] });
                            setNewGalleryUrl("");
                          }
                        }
                      }}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        const url = newGalleryUrl.trim();
                        if (url) {
                          setForm({ ...form, gallery: [...form.gallery, url] });
                          setNewGalleryUrl("");
                        }
                      }}
                    >
                      <Plus className="mr-1 h-4 w-4" /> Add
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={uploadingGallery}
                      onClick={() => document.getElementById("gallery-file")?.click()}
                    >
                      {uploadingGallery ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <><Upload className="mr-1 h-4 w-4" /> Upload</>
                      )}
                    </Button>
                    <input
                      id="gallery-file"
                      type="file"
                      accept="image/*"
                      multiple
                      className="hidden"
                      onChange={async (e) => {
                        const files = Array.from(e.target.files ?? []);
                        e.target.value = "";
                        if (files.length === 0) return;
                        setUploadingGallery(true);
                        try {
                          const urls: string[] = [];
                          for (const file of files) {
                            urls.push(await uploadImage(file));
                          }
                          setForm((f) => (f ? { ...f, gallery: [...f.gallery, ...urls] } : f));
                          toast.success(`Uploaded ${urls.length} image${urls.length > 1 ? "s" : ""}`);
                        } catch (err: any) {
                          toast.error("Upload failed", { description: err?.message || String(err) });
                        } finally {
                          setUploadingGallery(false);
                        }
                      }}
                    />
                  </div>
                </div>

                {/* Amenities */}
                <div className="space-y-2">
                  <Label>Amenities</Label>
                  <TagListEditor
                    values={form.amenities}
                    onChange={(amenities) => setForm({ ...form, amenities })}
                    placeholder="e.g. Infinity pool, 24/7 gym, Co-working lounge"
                  />
                </div>

                {/* Insider truths */}
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Insider Strengths</Label>
                    <BulletListEditor
                      values={form.insider_pros}
                      onChange={(insider_pros) => setForm({ ...form, insider_pros })}
                      placeholder="strength"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Honest Flaws</Label>
                    <BulletListEditor
                      values={form.insider_cons}
                      onChange={(insider_cons) => setForm({ ...form, insider_cons })}
                      placeholder="flaw"
                    />
                  </div>
                </div>

                {/* Commute */}
                <div className="space-y-2">
                  <Label>Commute Times</Label>
                  <p className="text-xs text-muted-foreground">
                    Label = destination (e.g. "District 1 CBD"). Value = travel time (e.g. "15 min by car").
                  </p>
                  <div className="space-y-2">
                    {form.commute.map((row, i) => (
                      <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2">
                        <Input
                          value={row.label}
                          placeholder="Destination"
                          onChange={(e) => {
                            const next = [...form.commute];
                            next[i] = { ...next[i], label: e.target.value };
                            setForm({ ...form, commute: next });
                          }}
                        />
                        <Input
                          value={row.value}
                          placeholder="Travel time"
                          onChange={(e) => {
                            const next = [...form.commute];
                            next[i] = { ...next[i], value: e.target.value };
                            setForm({ ...form, commute: next });
                          }}
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() =>
                            setForm({
                              ...form,
                              commute: form.commute.filter((_, idx) => idx !== i),
                            })
                          }
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        setForm({
                          ...form,
                          commute: [...form.commute, { label: "", value: "" }],
                        })
                      }
                    >
                      <Plus className="mr-1 h-4 w-4" /> Add destination
                    </Button>
                  </div>
                </div>

                {/* Pet policy */}
                <div className="space-y-2">
                  <Label htmlFor="pet_policy">Pet Policy</Label>
                  <Textarea
                    id="pet_policy"
                    rows={3}
                    value={form.pet_policy}
                    onChange={(e) =>
                      setForm({ ...form, pet_policy: e.target.value })
                    }
                    placeholder="e.g. Cats allowed; small dogs under 10kg with deposit…"
                  />
                </div>

                {/* Brackets */}
                <div className="space-y-3">
                  <Label>Base Rent Brackets (USD/month)</Label>
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
                </div>

                <div className="sticky bottom-0 -mx-6 -mb-6 flex items-center justify-end gap-2 border-t bg-background/95 px-6 py-4 backdrop-blur">
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
                    Save &amp; Re-match
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
