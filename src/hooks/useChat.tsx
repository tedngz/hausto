
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
}

interface ChatConversation {
  id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
}

interface SendMessageData {
  message: string;
  conversationId: string;
  userType?: 'renter' | 'realtor';
  userPreferences?: any;
  propertyImages?: string[];
}

export const useChat = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null);

  // Fetch conversations
  const { data: conversations = [] } = useQuery({
    queryKey: ['chat-conversations', user?.id],
    queryFn: async () => {
      if (!user?.id) return [];
      
      const { data, error } = await supabase
        .from('chat_conversations')
        .select('*')
        .eq('user_id', user.id)
        .order('updated_at', { ascending: false });

      if (error) throw error;
      return data as ChatConversation[];
    },
    enabled: !!user?.id,
  });

  // Fetch messages for current conversation
  const { data: messages = [] } = useQuery({
    queryKey: ['chat-messages', currentConversationId],
    queryFn: async () => {
      if (!currentConversationId) return [];
      
      const { data, error } = await supabase
        .from('chat_messages')
        .select('*')
        .eq('conversation_id', currentConversationId)
        .order('created_at', { ascending: true });

      if (error) throw error;
      return data as ChatMessage[];
    },
    enabled: !!currentConversationId,
  });

  // Create new conversation
  const createConversationMutation = useMutation({
    mutationFn: async (title?: string) => {
      if (!user?.id) throw new Error('User not authenticated');

      const { data, error } = await supabase
        .from('chat_conversations')
        .insert({
          user_id: user.id,
          title: title || 'New Conversation'
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['chat-conversations'] });
      setCurrentConversationId(data.id);
    },
  });

  // Send message
  const sendMessageMutation = useMutation({
    mutationFn: async (messageData: SendMessageData) => {
      const { message, conversationId, userType, userPreferences, propertyImages } = messageData;
      
      if (!user?.id) {
        throw new Error('User not authenticated');
      }

      // First ensure conversation exists
      const { data: conversationExists } = await supabase
        .from('chat_conversations')
        .select('id')
        .eq('id', conversationId)
        .eq('user_id', user.id)
        .single();

      if (!conversationExists) {
        throw new Error('Conversation not found or access denied');
      }

      // Add user message to database
      const { error: userMessageError } = await supabase
        .from('chat_messages')
        .insert({
          conversation_id: conversationId,
          role: 'user',
          content: message
        });

      if (userMessageError) {
        console.error('Error saving user message:', userMessageError);
        throw userMessageError;
      }

      console.log('Calling chat-ai function with:', { 
        messageLength: message.length, 
        conversationId, 
        userType 
      });

      // Call edge function for AI response with enhanced context
      const { data, error } = await supabase.functions.invoke('chat-ai', {
        body: { 
          message, 
          conversationId,
          userType,
          userPreferences,
          propertyImages: Array.isArray(propertyImages) ? propertyImages : []
        }
      });

      if (error) {
        console.error('Chat AI function error:', error);
        throw new Error(`Chat failed: ${error.message || 'Unknown error'}`);
      }

      if (!data) {
        throw new Error('No response from AI service');
      }

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chat-messages', currentConversationId] });
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

  // Delete conversation
  const deleteConversationMutation = useMutation({
    mutationFn: async (conversationId: string) => {
      if (!user?.id) throw new Error('User not authenticated');

      // First delete all messages in the conversation
      const { error: messagesError } = await supabase
        .from('chat_messages')
        .delete()
        .eq('conversation_id', conversationId);

      if (messagesError) throw messagesError;

      // Then delete the conversation
      const { error } = await supabase
        .from('chat_conversations')
        .delete()
        .eq('id', conversationId)
        .eq('user_id', user.id);

      if (error) throw error;
      return conversationId;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chat-conversations'] });
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

  return {
    conversations,
    messages,
    currentConversationId,
    setCurrentConversationId,
    createConversation: createConversationMutation.mutate,
    isCreatingConversation: createConversationMutation.isPending,
    sendMessage: sendMessageMutation.mutate,
    isSendingMessage: sendMessageMutation.isPending,
    deleteConversation: deleteConversationMutation.mutate,
    isDeletingConversation: deleteConversationMutation.isPending,
  };
};
