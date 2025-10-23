import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';

interface DirectMessage {
  id: string;
  conversation_id: string;
  sender_id: string;
  receiver_id: string;
  content: string;
  created_at: string;
  read_at: string | null;
  deleted_by: string[];
  metadata?: {
    type?: 'system' | 'ai-greeting' | 'ai-suggestion' | 'ai-exit' | 'user-action';
    property_id?: string;
    property_title?: string;
    property_location?: string;
    suggestedActions?: string[];
  };
}

interface MatchConversation {
  id: string;
  renter_id: string;
  realtor_id: string;
  last_message_at: string;
  last_message_preview: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  renter_name?: string;
  realtor_name?: string;
  renter_avatar?: string;
  realtor_avatar?: string;
  properties?: Array<{
    property_id: string;
    title: string;
    location: string;
    price: number;
    images: string[];
  }>;
}

export const useDirectMessages = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null);

  // Fetch conversations for current user
  const { data: conversations = [], isLoading: loadingConversations } = useQuery({
    queryKey: ['match-conversations', user?.id],
    queryFn: async () => {
      if (!user?.id) {
        console.log('No user ID found for conversations query, user:', user);
        return [];
      }
      
      console.log('Fetching conversations for user:', user.id);
      
      const { data, error } = await supabase
        .from('match_conversations')
        .select('*')
        .eq('is_active', true)
        .or(`realtor_id.eq.${user.id},renter_id.eq.${user.id}`)
        .order('last_message_at', { ascending: false });

      if (error) {
        console.error('Error fetching conversations:', error);
        throw error;
      }

      // Get names and properties for conversations
      if (data && data.length > 0) {
        const userIds = data.flatMap(conv => [conv.renter_id, conv.realtor_id]).filter(Boolean) as string[];

        const { data: profiles, error: profilesError } = await supabase
          .rpc('get_matched_public_profiles', { user_ids: userIds });

        if (profilesError) {
          console.error('Error fetching user profiles:', profilesError);
        }

        // Fetch all conversation properties once (may return multiple rows per conversation/pair)
        const { data: allProperties, error: propsError } = await supabase
          .rpc('get_conversation_properties');

        if (propsError) {
          console.error('Error fetching conversation properties:', propsError);
        }

        // Build quick maps for names, avatars and properties grouped by renter/realtor pair
        const nameById = new Map<string, string>();
        const avatarById = new Map<string, string>();
        profiles?.forEach(p => {
          nameById.set(p.id, p.name);
          if (p.avatar_url) avatarById.set(p.id, p.avatar_url);
        });

        const propertiesByPair = new Map<string, Array<{ property_id: string; title: string; location: string; price: number; images: string[] }>>();
        (allProperties || []).forEach((row: any) => {
          const key = `${row.renter_id}::${row.realtor_id}`;
          const list = propertiesByPair.get(key) || [];
          // Ensure unique properties per pair
          if (!list.some(p => p.property_id === row.property_id)) {
            list.push({
              property_id: row.property_id,
              title: row.title,
              location: row.location,
              price: Number(row.price ?? 0),
              images: row.images || [],
            });
          }
          propertiesByPair.set(key, list);
        });

        // Deduplicate conversations strictly by renter/realtor pair and merge property lists per pair
        const pairMap = new Map<string, MatchConversation>();
        (data as any[]).forEach((conv) => {
          const key = `${conv.renter_id}::${conv.realtor_id}`;
          const enriched: MatchConversation = {
            ...conv,
            renter_name: nameById.get(conv.renter_id) || 'Interested Renter',
            realtor_name: nameById.get(conv.realtor_id) || 'Property Owner',
            renter_avatar: avatarById.get(conv.renter_id),
            realtor_avatar: avatarById.get(conv.realtor_id),
            properties: propertiesByPair.get(key) || [],
          };
          const existing = pairMap.get(key);
          if (!existing || new Date(conv.last_message_at).getTime() > new Date(existing.last_message_at).getTime()) {
            pairMap.set(key, enriched);
          }
        });

        const deduped = Array.from(pairMap.values()).sort(
          (a, b) => new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime()
        );

        console.log('Conversations (deduped by pair):', deduped.map(c => ({ id: c.id, renter: c.renter_id, realtor: c.realtor_id, props: c.properties?.length })));
        return deduped;
      }
      
      console.log('Conversations fetched successfully (raw):', data);
      // Fallback: ensure uniqueness by renter/realtor pair even without extra data
      const pairMap = new Map<string, MatchConversation>();
      (data as any[]).forEach((conv) => {
        const key = `${conv.renter_id}::${conv.realtor_id}`;
        const existing = pairMap.get(key);
        if (!existing || new Date(conv.last_message_at).getTime() > new Date(existing.last_message_at).getTime()) {
          pairMap.set(key, conv as MatchConversation);
        }
      });
      const deduped = Array.from(pairMap.values()).sort((a, b) => new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime());
      return deduped;
    },
    enabled: !!user?.id,
  });

  // Set up real-time subscription for conversations
  useEffect(() => {
    if (!user?.id) return;

    const channel = supabase
      .channel('match-conversations-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'match_conversations'
        },
        () => {
          console.log('Conversation updated, refetching...');
          queryClient.invalidateQueries({ queryKey: ['match-conversations', user.id] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id, queryClient]);

  // Fetch messages for current conversation
  const { data: messages = [], isLoading: loadingMessages, refetch: refetchMessages } = useQuery({
    queryKey: ['direct-messages', currentConversationId],
    queryFn: async () => {
      if (!currentConversationId) {
        console.log('No currentConversationId for messages query');
        return [];
      }
      
      console.log('Fetching messages for conversation:', currentConversationId, 'user:', user?.id);
      
      try {
        const { data, error } = await supabase
          .from('direct_messages')
          .select('*')
          .eq('conversation_id', currentConversationId)
          .order('created_at', { ascending: true });

        if (error) {
          console.error('Error fetching messages:', error);
          throw error;
        }
        
        console.log('Messages fetched successfully for conversation', currentConversationId, ':', data);
        return data as DirectMessage[];
      } catch (error) {
        console.error('Failed to fetch messages:', error);
        throw error;
      }
    },
    enabled: !!currentConversationId,
    refetchInterval: 3000, // Refetch every 3 seconds as fallback
  });

  // Set up real-time subscription for messages
  useEffect(() => {
    if (!currentConversationId || !user?.id) return;

    const channel = supabase
      .channel(`direct-messages-${currentConversationId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'direct_messages',
          filter: `conversation_id=eq.${currentConversationId}`
        },
        (payload) => {
          console.log('New message received:', payload);
          queryClient.invalidateQueries({ queryKey: ['direct-messages', currentConversationId] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentConversationId, user?.id, queryClient]);

  // Send message
  const sendMessageMutation = useMutation({
    mutationFn: async ({ conversationId, content, receiverId }: { 
      conversationId: string; 
      content: string; 
      receiverId: string;
    }) => {
      if (!user?.id) {
        console.error('User not authenticated - user:', user);
        throw new Error('User not authenticated');
      }

      // Validate message content
      const { messageSchema } = await import('@/lib/validation');
      const validatedData = messageSchema.parse({
        content,
        conversation_id: conversationId,
        receiver_id: receiverId,
      });

      console.log('Sending message:', { conversationId, senderId: user.id, receiverId, content: validatedData.content });

      const { data, error } = await supabase
        .from('direct_messages')
        .insert({
          conversation_id: conversationId,
          sender_id: user.id,
          receiver_id: receiverId,
          content: validatedData.content
        })
        .select()
        .single();

      if (error) {
        console.error('Database error when sending message:', error);
        throw error;
      }
      
      console.log('Message sent successfully:', data);
      return data;
    },
    onSuccess: async (data, variables) => {
      console.log('Message sent successfully, invalidating queries...');
      
      // Update conversation with latest message
      await supabase
        .from('match_conversations')
        .update({
          last_message_at: new Date().toISOString(),
          last_message_preview: variables.content.substring(0, 100),
        })
        .eq('id', variables.conversationId);

      // Force immediate refetch of messages and conversations
      await queryClient.invalidateQueries({ queryKey: ['direct-messages', currentConversationId] });
      await queryClient.invalidateQueries({ queryKey: ['match-conversations'] });
      
      // Also manually refetch messages for immediate update
      refetchMessages();
    },
    onError: (error) => {
      console.error('Error sending message:', error);
      toast({
        title: "Error",
        description: "Failed to send message. Please try again.",
        variant: "destructive",
      });
    },
  });

  // Delete conversation (delete everything for both users)
  const deleteConversationMutation = useMutation({
    mutationFn: async (conversationId: string) => {
      if (!user?.id) throw new Error('User not authenticated');

      // Delete all messages in the conversation
      const { error: messagesError } = await supabase
        .from('direct_messages')
        .delete()
        .eq('conversation_id', conversationId);

      if (messagesError) throw messagesError;

      // Delete the conversation
      const { error: convError } = await supabase
        .from('match_conversations')
        .delete()
        .eq('id', conversationId);

      if (convError) throw convError;

      return conversationId;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['match-conversations'] });
      queryClient.invalidateQueries({ queryKey: ['direct-messages'] });
      setCurrentConversationId(null);
      toast({
        title: "Conversation Deleted",
        description: "The conversation has been removed.",
      });
    },
    onError: (error) => {
      console.error('Error deleting conversation:', error);
      toast({
        title: "Error",
        description: "Failed to delete conversation. Please try again.",
        variant: "destructive",
      });
    },
  });

  // Mark messages as read
  const markAsReadMutation = useMutation({
    mutationFn: async (conversationId: string) => {
      if (!user?.id) return;

      const { error } = await supabase
        .from('direct_messages')
        .update({ read_at: new Date().toISOString() })
        .eq('conversation_id', conversationId)
        .eq('receiver_id', user.id)
        .is('read_at', null);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['direct-messages', currentConversationId] });
    },
  });

  // Helper to get or create conversation for a renter-realtor pair
  const getOrCreateConversation = async (renterId: string, realtorId: string) => {
    // Try to find the earliest existing conversation for this pair (handles legacy duplicates)
    const { data: existing } = await supabase
      .from('match_conversations')
      .select('id, created_at, last_message_at')
      .eq('renter_id', renterId)
      .eq('realtor_id', realtorId)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (existing?.id) {
      return existing.id;
    }

    // Create or fetch via upsert to avoid race conditions and enforce uniqueness
    const { data: upserted, error: upsertError } = await supabase
      .from('match_conversations')
      .upsert(
        {
          renter_id: renterId,
          realtor_id: realtorId,
          is_active: true,
        },
        { onConflict: 'renter_id,realtor_id' }
      )
      .select('id')
      .single();

    if (upsertError) throw upsertError;
    return upserted.id;
  };

  return {
    conversations,
    messages,
    currentConversationId,
    setCurrentConversationId,
    sendMessage: sendMessageMutation.mutate,
    isSendingMessage: sendMessageMutation.isPending,
    deleteConversation: deleteConversationMutation.mutate,
    isDeletingConversation: deleteConversationMutation.isPending,
    markAsRead: markAsReadMutation.mutate,
    getOrCreateConversation,
    loadingConversations,
    loadingMessages,
    refetchMessages,
  };
};