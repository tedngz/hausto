// The name and number we already know, so a returning renter is not asked twice.
//
// Two sources, in this order:
//
//   renters   - what they gave the last time they requested a viewing. This is
//               the number WhatsApp actually reaches them on, which is the one
//               that matters here.
//   profiles  - their account details. `phone` is optional there and is not
//               necessarily a mobile, let alone a Vietnamese one.
//
// Prefill only, never a lock: the modal seeds its fields from this and the
// renter edits freely. Someone requesting on behalf of a partner, or who has
// changed number, must not have to fight a form that keeps knowing better.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toE164 } from '../../supabase/functions/_shared/viewing/intake.ts';

export interface RenterIdentity {
  name: string;
  /** Empty unless it normalises to a Vietnamese mobile - see below. */
  phone: string;
}

/**
 * `integrations/supabase/types.ts` is generated from the live database and
 * predates the viewing domain, so `renters` is absent from its table union.
 * One narrow cast rather than `any`; regenerating needs credentials this repo
 * does not carry.
 */
const db = supabase as unknown as {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (column: string, value: string) => {
        maybeSingle: () => Promise<{ data: unknown; error: unknown }>;
      };
    };
  };
};

export const useRenterIdentity = () => {
  const { user } = useAuth();

  const { data, isLoading } = useQuery<RenterIdentity>({
    queryKey: ['renter-identity', user?.id],
    enabled: !!user?.id,
    // Their own name and number; not worth re-reading on every modal open.
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const [renterRes, profileRes] = await Promise.all([
        // RLS scopes this to their own row, so there is no filter to forget.
        db.from('renters').select('display_name, phone_e164').eq('user_id', user!.id).maybeSingle(),
        supabase.from('profiles').select('name, phone').eq('id', user!.id).maybeSingle(),
      ]);

      const renter = (renterRes.error ? null : renterRes.data) as
        { display_name: string | null; phone_e164: string | null } | null;
      const profile = profileRes.error ? null : profileRes.data;

      // A phone we cannot normalise is worse than an empty field: it seeds the
      // form with something the request will refuse, and the renter has to
      // work out that the value we put there is the problem. `profiles.phone`
      // is free text and may be a landline, an office number, or +1.
      const candidate = renter?.phone_e164 || profile?.phone || '';
      const phone = toE164(candidate) ? candidate : '';

      return {
        name: renter?.display_name || profile?.name || '',
        phone,
      };
    },
  });

  return { identity: data, isLoading };
};
