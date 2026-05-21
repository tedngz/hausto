import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface RentBracket { min: number; max: number }
export interface Complex {
  id: string;
  slug: string;
  name: string;
  city: string;
  district: string;
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
