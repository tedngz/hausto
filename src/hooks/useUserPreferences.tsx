import { useCallback, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { UserPreferences } from '@/types';
import {
  dbToPreferences,
  preferencesToDb,
  hasMeaningfulPreferences,
  type UserPreferencesRow,
} from '@/lib/preferences';

/**
 * The one place renter preferences are read and written.
 *
 * Before this hook, Discover reconciled localStorage against the DB by hand,
 * Profile ran its own query, and BrowseTable read localStorage inside a useMemo
 * keyed on the user - so an edit never reached the table's vibe scores until a
 * reload. Everything now shares one query cache entry, and one writer.
 *
 * localStorage stays in the picture as an instant-paint cache (it is what keeps
 * a returning renter from seeing a spinner), never as the source of truth: the
 * DB answer always overwrites it.
 */

export const userPreferencesKey = (userId?: string) => ['user-preferences', userId];

const storageKey = (userId: string) => `userPreferences_${userId}`;

const readLocal = (userId?: string): UserPreferences | undefined => {
  if (!userId) return undefined;
  try {
    const raw = localStorage.getItem(storageKey(userId));
    return raw ? (JSON.parse(raw) as UserPreferences) : undefined;
  } catch {
    return undefined;
  }
};

const writeLocal = (userId: string, prefs: UserPreferences | null) => {
  try {
    if (prefs) localStorage.setItem(storageKey(userId), JSON.stringify(prefs));
    else localStorage.removeItem(storageKey(userId));
  } catch {
    // Private-mode or quota failures are not worth breaking the page over.
  }
};

export const useUserPreferences = () => {
  const { user } = useAuth();
  const userId = user?.id;
  const queryClient = useQueryClient();

  const {
    data,
    isPending,
    isPlaceholderData,
    refetch,
  } = useQuery({
    queryKey: userPreferencesKey(userId),
    enabled: !!userId,
    // Painted immediately from the last known answer so returning renters skip
    // the spinner; `isResolved` below tells callers it is not the real one yet.
    placeholderData: () => readLocal(userId) ?? undefined,
    queryFn: async (): Promise<UserPreferences | null> => {
      if (!userId) return null;
      const { data: row } = await supabase
        .from('user_preferences')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();

      const dbPrefs = dbToPreferences(row as unknown as UserPreferencesRow | null);
      if (dbPrefs) {
        writeLocal(userId, dbPrefs);
        return dbPrefs;
      }
      // No row yet (a renter who filled the quiz before it persisted, say) -
      // keep whatever the device remembers rather than wiping their answers.
      return readLocal(userId) ?? null;
    },
  });

  const { mutateAsync: save, isPending: isSaving } = useMutation({
    mutationFn: async (prefs: UserPreferences) => {
      if (!userId) throw new Error('Not signed in');
      const { error } = await supabase
        .from('user_preferences')
        .upsert(preferencesToDb(prefs, userId), { onConflict: 'user_id' });
      if (error) throw error;
      writeLocal(userId, prefs);
      return prefs;
    },
    onSuccess: (prefs) => {
      queryClient.setQueryData(userPreferencesKey(userId), prefs);
    },
  });

  /** Forget this renter's preferences locally, e.g. when restarting the quiz. */
  const clearPreferences = useCallback(() => {
    if (!userId) return;
    writeLocal(userId, null);
    queryClient.setQueryData(userPreferencesKey(userId), null);
  }, [queryClient, userId]);

  const preferences = (data ?? null) as UserPreferences | null;

  return useMemo(
    () => ({
      preferences,
      /** Nothing to paint yet. The cached answer counts, so returning renters
       *  never see a skeleton. */
      isLoading: !!userId && isPending,
      /** The DB has answered. Cached placeholder data does NOT count - callers
       *  that must not guess wrong (routing a new renter into the quiz) wait
       *  for this. */
      isResolved: !userId || (!isPending && !isPlaceholderData),
      hasPreferences: hasMeaningfulPreferences(preferences),
      savePreferences: save,
      isSaving,
      clearPreferences,
      refetchPreferences: refetch,
    }),
    [preferences, userId, isPending, isPlaceholderData, save, isSaving, clearPreferences, refetch],
  );
};
