import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

export type AppRole = 'admin' | 'moderator' | 'user' | 'realtor';

export const useUserRoles = () => {
  const { user } = useAuth();

  const query = useQuery({
    queryKey: ['user-roles', user?.id],
    queryFn: async () => {
      if (!user?.id) return [] as AppRole[];
      const { data, error } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', user.id);
      if (error) throw error;
      return (data ?? []).map((r) => r.role as AppRole);
    },
    enabled: !!user?.id,
    staleTime: 60_000,
  });

  const roles = query.data ?? [];
  return {
    roles,
    isRealtor: roles.includes('realtor'),
    isAdmin: roles.includes('admin'),
    isLoading: query.isLoading,
    refetch: query.refetch,
  };
};
