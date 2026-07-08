import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { EXTERNAL_PROPERTY_PUBLIC_COLUMNS } from '@/lib/externalPropertyColumns';
import { useAuth } from '@/hooks/useAuth';
import type { Apartment } from '@/types';


export interface RentBracket { min: number; max: number }
export interface Complex {
  id: string;
  slug: string;
  name: string;
  city: string;
  district: string;
  district_code: string | null;
  aliases: string[] | null;
  developer: string | null;
  management_company: string | null;
  year_completed: number | null;
  hero_image: string | null;
  gallery: string[] | null;
  tagline: string | null;
  description: string | null;
  pet_policy: string | null;
  amenities: string[] | null;
  average_rent_brackets: Record<string, RentBracket> | null;
  insider_pros: string[] | null;
  insider_cons: string[] | null;
  commute_times: Record<string, string> | null;
  tags: string[] | null;
  latitude: number | null;
  longitude: number | null;
}

export function useComplexes() {
  return useQuery({
    queryKey: ['complexes'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('complexes')
        .select('*')
        .eq('is_published', true)
        .order('name');
      if (error) throw error;
      return (data ?? []) as unknown as Complex[];
    },
  });
}

export function useComplex(slug: string | undefined) {
  return useQuery({
    queryKey: ['complex', slug],
    enabled: !!slug,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('complexes')
        .select('*')
        .eq('slug', slug!)
        .eq('is_published', true)
        .maybeSingle();
      if (error) throw error;
      return data as unknown as Complex | null;
    },
  });
}

export const CITY_LABEL: Record<string, string> = {
  ho_chi_minh: 'Ho Chi Minh City',
  hanoi: 'Hanoi',
};

/**
 * Escape special chars in PostgREST `or` filter values (commas, parens).
 * We bracket the value with `*` for ilike so commas are the main risk.
 */
function escForOr(s: string): string {
  return s.replace(/[%,()]/g, ' ').trim();
}

/**
 * Listings (internal + external) that belong to this complex,
 * matched by name/alias text against title/location/description.
 */
export function useComplexListings(complex: Complex | null | undefined) {
  const { user } = useAuth();
  const terms = complex ? [complex.name, ...(complex.aliases ?? [])] : [];
  // de-dupe, drop short tokens
  const uniq = Array.from(new Set(terms.map((t) => t.trim()).filter((t) => t.length >= 3)));

  return useQuery({
    queryKey: ['complex-listings', complex?.id, uniq, !!user],
    enabled: !!complex && uniq.length > 0,
    queryFn: async (): Promise<Apartment[]> => {
      // Anonymous visitors can browse listings via a public edge function that
      // strips contact details; only signed-in users query the tables directly.
      if (!user) {
        const { data, error } = await supabase.functions.invoke('get-complex-listings', {
          body: { terms: uniq },
        });
        if (error) throw error;
        return (data?.listings ?? []) as Apartment[];
      }

      const orInternal = uniq
        .flatMap((t) => {
          const e = escForOr(t);
          return [`title.ilike.%${e}%`, `location.ilike.%${e}%`, `description.ilike.%${e}%`];
        })
        .join(',');
      const orExternal = uniq
        .flatMap((t) => {
          const e = escForOr(t);
          return [`title.ilike.%${e}%`, `location.ilike.%${e}%`];
        })
        .join(',');

      const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
      const now = new Date().toISOString();

      const [internalRes, externalRes] = await Promise.all([
        supabase
          .from('properties')
          .select('*')
          .eq('is_active', true)
          .gte('last_activated_at', tenDaysAgo)
          .or(orInternal)
          .order('last_activated_at', { ascending: false })
          .limit(12),
        supabase
          .from('external_properties')
          .select(EXTERNAL_PROPERTY_PUBLIC_COLUMNS)
          .eq('is_active', true)
          .gt('expires_at', now)
          .or(orExternal)
          .order('crawled_at', { ascending: false })
          .limit(12),
      ]);

      if (internalRes.error) throw internalRes.error;
      if (externalRes.error) throw externalRes.error;

      const internal: Apartment[] = (internalRes.data ?? []).map((p: any) => ({
        id: p.id,
        title: p.title,
        location: p.location,
        price: Number(p.price) || 0,
        size: p.size ?? '',
        vibe: p.vibe ?? '',
        description: p.description ?? '',
        images: p.images ?? [],
        highlights: p.highlights ?? [],
        amenities: p.amenities ?? [],
        vibe_analysis: p.vibe_analysis,
        property_source_link: p.property_source_link ?? undefined,
        property_source_provider_name: p.property_source_provider_name ?? undefined,
        property_source_provider_phone: p.property_source_provider_phone ?? undefined,
        latitude: p.latitude,
        longitude: p.longitude,
        rooms: p.rooms,
        last_activated_at: p.last_activated_at,
        created_at: p.created_at,
        realtor: {
          id: p.realtor_id,
          name: p.property_source_provider_name || 'Realtor',
          phone: p.property_source_provider_phone || '',
          email: '',
        },
      }));

      const external: Apartment[] = (externalRes.data ?? []).map((e: any) => ({
        id: e.id,
        title: e.title,
        location: e.location,
        price: Number(e.price) || 0,
        size: e.size ?? '',
        vibe: e.vibe ?? '',
        description: e.description ?? '',
        images: e.images ?? [],
        highlights: e.highlights ?? [],
        amenities: e.amenities ?? [],
        vibe_analysis: e.vibe_analysis,
        property_source_link: e.source_url,
        property_source_provider_name: e.contact_name ?? e.source,
        property_source_provider_phone: e.contact_phone ?? undefined,
        latitude: e.latitude,
        longitude: e.longitude,
        rooms: e.rooms,
        last_activated_at: e.crawled_at,
        created_at: e.created_at,
        realtor: {
          id: `ext-${e.source}`,
          name: e.contact_name || e.source || 'External Listing',
          phone: e.contact_phone || '',
          email: '',
        },
      }));

      // Recency-sorted, deduped by id
      const seen = new Set<string>();
      return [...internal, ...external]
        .filter((a) => (seen.has(a.id) ? false : (seen.add(a.id), true)))
        .sort((a, b) => (b.last_activated_at ?? '').localeCompare(a.last_activated_at ?? ''))
        .slice(0, 12);
    },
  });
}
