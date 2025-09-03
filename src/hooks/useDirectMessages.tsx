import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';

interface DirectMessage {
  id: string;
  match_id: string;
  sender_id: string;
  receiver_id: string;
  content: string;
  created_at: string;
  read_at: string | null;
  deleted_by: string[];
}

interface MatchConversation {
  id: string;
  match_id: string;
  last_message_at: string;
  last_message_preview: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  // Joined data from property_matches
  property_matches?: {
    id: string;
    property_id: string;
    realtor_id: string;
    renter_id: string;
    properties?: {
      id: string;
      title: string;
      location: string;
      price: number;
      images: string[];
    };
  };
}

export const useDirectMessages = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [currentMatchId, setCurrentMatchId] = useState<string | null>(null);

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
        .select(`
          *,
          property_matches!inner(
            id,
            property_id,
            realtor_id,
            renter_id,
            properties(id, title, location, price, images)
          )
        `)
        .eq('is_active', true)
        .or(`realtor_id.eq.${user.id},renter_id.eq.${user.id}`, { foreignTable: 'property_matches' })
        .order('last_message_at', { ascending: false });

      if (error) {
        console.error('Error fetching conversations:', error);
        throw error;
      }

      // Get names for all users in conversations
      if (data && data.length > 0) {
        const userIds = data.flatMap(conv => [
          conv.property_matches?.renter_id,
          conv.property_matches?.realtor_id
        ]).filter(Boolean) as string[];

        const { data: profiles, error: profilesError } = await supabase
          .rpc('get_matched_public_profiles', { user_ids: userIds });

        if (profilesError) {
          console.error('Error fetching user profiles:', profilesError);
        }

        // Map names to conversations
        const conversationsWithNames = data.map(conv => ({
          ...conv,
          renter_name: profiles?.find(p => p.id === conv.property_matches?.renter_id)?.name || 'Interested Renter',
          realtor_name: profiles?.find(p => p.id === conv.property_matches?.realtor_id)?.name || 'Property Owner'
        }));

        return conversationsWithNames as MatchConversation[];
      }
      
      console.log('Conversations fetched successfully:', data);
      return data as MatchConversation[];
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

  // Fetch messages for current match
  const { data: messages = [], isLoading: loadingMessages, refetch: refetchMessages } = useQuery({
    queryKey: ['direct-messages', currentMatchId],
    queryFn: async () => {
      if (!currentMatchId) {
        console.log('No currentMatchId for messages query');
        return [];
      }
      
      console.log('Fetching messages for match:', currentMatchId, 'user:', user?.id);
      
      try {
        const { data, error } = await supabase
          .from('direct_messages')
          .select('*')
          .eq('match_id', currentMatchId)
          .order('created_at', { ascending: true });

        if (error) {
          console.error('Error fetching messages:', error);
          throw error;
        }
        
        console.log('Messages fetched successfully for match', currentMatchId, ':', data);
        return data as DirectMessage[];
      } catch (error) {
        console.error('Failed to fetch messages:', error);
        throw error;
      }
    },
    enabled: !!currentMatchId,
    refetchInterval: 3000, // Refetch every 3 seconds as fallback
  });

  // Set up real-time subscription for messages
  useEffect(() => {
    if (!currentMatchId || !user?.id) return;

    const channel = supabase
      .channel(`direct-messages-${currentMatchId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'direct_messages',
          filter: `match_id=eq.${currentMatchId}`
        },
        (payload) => {
          console.log('New message received:', payload);
          queryClient.invalidateQueries({ queryKey: ['direct-messages', currentMatchId] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentMatchId, user?.id, queryClient]);

  // Send message
  const sendMessageMutation = useMutation({
    mutationFn: async ({ matchId, content, receiverId }: { 
      matchId: string; 
      content: string; 
      receiverId: string;
    }) => {
      if (!user?.id) {
        console.error('User not authenticated - user:', user);
        throw new Error('User not authenticated');
      }

      console.log('Sending message:', { matchId, senderId: user.id, receiverId, content });

      const { data, error } = await supabase
        .from('direct_messages')
        .insert({
          match_id: matchId,
          sender_id: user.id,
          receiver_id: receiverId,
          content
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
      
      // Update match conversation with latest message
      await supabase
        .from('match_conversations')
        .upsert({
          match_id: variables.matchId,
          last_message_at: new Date().toISOString(),
          last_message_preview: variables.content.substring(0, 100),
          is_active: true
        }, { onConflict: 'match_id' });

      // Force immediate refetch of messages and conversations
      await queryClient.invalidateQueries({ queryKey: ['direct-messages', currentMatchId] });
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
    mutationFn: async (matchId: string) => {
      if (!user?.id) throw new Error('User not authenticated');

      // Delete all messages in the match
      const { error: messagesError } = await supabase
        .from('direct_messages')
        .delete()
        .eq('match_id', matchId);

      if (messagesError) throw messagesError;

      // Delete the conversation
      const { error: convError } = await supabase
        .from('match_conversations')
        .delete()
        .eq('match_id', matchId);

      if (convError) throw convError;

      return matchId;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['match-conversations'] });
      queryClient.invalidateQueries({ queryKey: ['direct-messages'] });
      setCurrentMatchId(null);
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
    mutationFn: async (matchId: string) => {
      if (!user?.id) return;

      const { error } = await supabase
        .from('direct_messages')
        .update({ read_at: new Date().toISOString() })
        .eq('match_id', matchId)
        .eq('receiver_id', user.id)
        .is('read_at', null);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['direct-messages', currentMatchId] });
    },
  });

  return {
    conversations,
    messages,
    currentMatchId,
    setCurrentMatchId,
    sendMessage: sendMessageMutation.mutate,
    isSendingMessage: sendMessageMutation.isPending,
    deleteConversation: deleteConversationMutation.mutate,
    isDeletingConversation: deleteConversationMutation.isPending,
    markAsRead: markAsReadMutation.mutate,
    loadingConversations,
    loadingMessages,
  };
};