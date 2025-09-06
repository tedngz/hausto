import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';

interface SupportMessage {
  id: string;
  content: string;
  role: 'user' | 'assistant';
  created_at: string;
}

interface SupportConversation {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

interface SendSupportMessageData {
  message: string;
  conversationId: string;
  userType: 'renter' | 'realtor';
}

export const useSupportChat = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null);

  // Fetch support conversations
  const { data: conversations = [], isLoading: loadingConversations } = useQuery({
    queryKey: ['support-conversations', user?.id],
    queryFn: async () => {
      if (!user?.id) return [];
      
      const { data, error } = await supabase
        .from('support_conversations')
        .select('*')
        .eq('user_id', user.id)
        .order('updated_at', { ascending: false });

      if (error) throw error;
      return data as SupportConversation[];
    },
    enabled: !!user?.id,
  });

  // Fetch messages for current conversation
  const { data: messages = [], isLoading: loadingMessages } = useQuery({
    queryKey: ['support-messages', currentConversationId],
    queryFn: async () => {
      if (!currentConversationId) return [];
      
      const { data, error } = await supabase
        .from('support_messages')
        .select('*')
        .eq('conversation_id', currentConversationId)
        .order('created_at', { ascending: true });

      if (error) throw error;
      return data as SupportMessage[];
    },
    enabled: !!currentConversationId,
  });

  // Create new support conversation
  const createConversationMutation = useMutation({
    mutationFn: async (title: string) => {
      if (!user?.id) throw new Error('User not authenticated');

      const { data, error } = await supabase
        .from('support_conversations')
        .insert({
          user_id: user.id,
          title,
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['support-conversations'] });
      setCurrentConversationId(data.id);
    },
    onError: (error) => {
      toast({
        title: "Error creating conversation",
        description: error.message,
        variant: "destructive"
      });
    }
  });

  // Send support message
  const sendMessageMutation = useMutation({
    mutationFn: async ({ message, conversationId, userType }: SendSupportMessageData) => {
      if (!user?.id) throw new Error('User not authenticated');

      // Save user message
      const { error: userMessageError } = await supabase
        .from('support_messages')
        .insert({
          conversation_id: conversationId,
          content: message,
          role: 'user',
        });

      if (userMessageError) throw userMessageError;

      // Call support AI function
      const { data: response, error: functionError } = await supabase.functions.invoke('support-ai', {
        body: {
          message,
          conversationId,
          userType,
        }
      });

      if (functionError) throw functionError;

      return response;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['support-messages', currentConversationId] });
      queryClient.invalidateQueries({ queryKey: ['support-conversations'] });
    },
    onError: (error) => {
      toast({
        title: "Error sending message",
        description: error.message,
        variant: "destructive"
      });
    }
  });

  // Delete support conversation
  const deleteConversationMutation = useMutation({
    mutationFn: async (conversationId: string) => {
      const { error } = await supabase
        .from('support_conversations')
        .delete()
        .eq('id', conversationId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['support-conversations'] });
      if (currentConversationId === currentConversationId) {
        setCurrentConversationId(null);
      }
    },
    onError: (error) => {
      toast({
        title: "Error deleting conversation",
        description: error.message,
        variant: "destructive"
      });
    }
  });

  const createConversation = (title: string) => {
    createConversationMutation.mutate(title);
  };

  const sendMessage = (data: SendSupportMessageData) => {
    sendMessageMutation.mutate(data);
  };

  const deleteConversation = (conversationId: string) => {
    deleteConversationMutation.mutate(conversationId);
  };

  return {
    conversations,
    messages,
    currentConversationId,
    setCurrentConversationId,
    createConversation,
    sendMessage,
    deleteConversation,
    isCreatingConversation: createConversationMutation.isPending,
    isSendingMessage: sendMessageMutation.isPending,
    isDeletingConversation: deleteConversationMutation.isPending,
    loadingConversations,
    loadingMessages,
  };
};