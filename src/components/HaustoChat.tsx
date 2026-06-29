import { useState, useEffect, useRef } from 'react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { X, Send, MessageCircle, MapPin, ArrowLeft } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useDirectMessages } from '@/hooks/useDirectMessages';
import { format } from 'date-fns';

import { useAuth } from '@/hooks/useAuth';
import { useCurrency } from '@/contexts/CurrencyContext';
import { useSubscription } from '@/hooks/useSubscription';
import { PropertyDetailModal } from '@/components/PropertyDetailModal';
import { RealtorProfileModal } from '@/components/RealtorProfileModal';
import { RenterProfileModal } from '@/components/RenterProfileModal';
import { ViewingScheduleModal, ViewingScheduleData } from '@/components/ViewingScheduleModal';
import { Apartment } from '@/types';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
interface HaustoChatProps {
  isOpen: boolean;
  onClose: () => void;
  userPreferences?: any;
  userType: 'renter' | 'realtor';
  propertyImages?: string[];
  initialMatchId?: string | null;
}
export const HaustoChat = ({
  isOpen,
  onClose,
  userPreferences,
  userType,
  propertyImages = [],
  initialMatchId = null
}: HaustoChatProps) => {
  const [inputMessage, setInputMessage] = useState('');
  const [activeTab, setActiveTab] = useState<'messages'>('messages');
  const [selectedMatch, setSelectedMatch] = useState<string | null>(null);
  const [pendingMessage, setPendingMessage] = useState<string>('');
  const [detailModalApartment, setDetailModalApartment] = useState<Apartment | null>(null);
  const [selectedRealtorId, setSelectedRealtorId] = useState<string | null>(null);
  const [selectedRenterId, setSelectedRenterId] = useState<string | null>(null);
  const [isStartingNewChat, setIsStartingNewChat] = useState(false);
  const [showPropertyList, setShowPropertyList] = useState(false);
  const [isRequestingAI, setIsRequestingAI] = useState(false);
  const [isAIActive, setIsAIActive] = useState(false);
  const [aiLastActiveTime, setAiLastActiveTime] = useState<number | null>(null);
  const [isViewingScheduleModalOpen, setIsViewingScheduleModalOpen] = useState(false);
  const [showPropertySelectionForContact, setShowPropertySelectionForContact] = useState(false);
  const [propertiesToSelect, setPropertiesToSelect] = useState<any[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const aiTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  // Track per-conversation proactive timers and last scheduled message IDs
  const proactiveTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const lastScheduledMsgRef = useRef<Record<string, string>>({});
  const aiRespondedToRef = useRef<Set<string>>(new Set());
  const {
    formatPrice
  } = useCurrency();
  const {
    user
  } = useAuth();
  const { subscription_tier } = useSubscription();
  const { toast } = useToast();
  const {
    conversations,
    sendMessage: sendDirectMessage,
    isSendingMessage: isSendingDirectMessage,
    messages: directMessages,
    setCurrentConversationId,
    loadingMessages: loadingDirectMessages,
    markAsRead,
    refetchMessages
  } = useDirectMessages();
  const scrollToBottom = () => {
    // Use setTimeout to ensure DOM has updated before scrolling
    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({
        behavior: 'smooth'
      });
    }, 50);
  };
  
  // Scroll to bottom when messages change
  useEffect(() => {
    scrollToBottom();
  }, [directMessages]);

  // Scroll to bottom when returning from property list or detail views
  useEffect(() => {
    if (!showPropertyList && selectedMatch && directMessages.length > 0) {
      scrollToBottom();
    }
  }, [showPropertyList, selectedMatch]);

  // Scroll to bottom when property selection dialog closes
  useEffect(() => {
    if (!showPropertySelectionForContact && selectedMatch && directMessages.length > 0) {
      scrollToBottom();
    }
  }, [showPropertySelectionForContact, selectedMatch]);

  // Scroll to bottom when detail modal closes
  useEffect(() => {
    if (!detailModalApartment && selectedMatch && directMessages.length > 0) {
      scrollToBottom();
    }
  }, [detailModalApartment, selectedMatch]);

  // Sync selected match with direct messages hook
  useEffect(() => {
    setCurrentConversationId(selectedMatch ?? null);
  }, [selectedMatch, setCurrentConversationId]);

  // Mark messages as read when viewing a conversation and new messages arrive
  useEffect(() => {
    if (selectedMatch && directMessages.length > 0) {
      markAsRead(selectedMatch);
    }
  }, [selectedMatch, directMessages.length, markAsRead]);

  // Set initial match when provided
  useEffect(() => {
    if (initialMatchId && isOpen) {
      setSelectedMatch(initialMatchId);
    }
  }, [initialMatchId, isOpen]);
  const handleSendMessage = async () => {
    if (!inputMessage.trim()) return;
    if (selectedMatch) {
      const currentConv = conversations.find(c => c.id === selectedMatch);
      if (currentConv) {
        const receiverId = user?.id === currentConv.realtor_id ? currentConv.renter_id : currentConv.realtor_id;
        const messageContent = inputMessage.trim();
        
        sendDirectMessage({
          conversationId: selectedMatch,
          content: messageContent,
          receiverId
        });

        // Check if message is a number (property selection)
        const propertyNumber = parseInt(messageContent);
        if (!isNaN(propertyNumber) && propertyNumber > 0 && currentConv.properties && propertyNumber <= currentConv.properties.length) {
          // User selected a property by number
          const selectedProperty = currentConv.properties[propertyNumber - 1];
          
          // Automatically trigger AI response with selected property contact info
          setIsRequestingAI(true);
          
          try {
            const { data, error } = await supabase.functions.invoke('hausto-ai-assist', {
              body: {
                conversationId: selectedMatch,
                userType,
                messages: [],
                properties: [selectedProperty], // Pass only the selected property
                action: 'contact_provider',
                isPremium: subscription_tier === 'premium',
              }
            });

            if (error) throw error;

            // Send AI response with contact info
            await supabase.from('direct_messages').insert({
              conversation_id: selectedMatch,
              sender_id: user?.id || '',
              receiver_id: receiverId,
              content: data.suggestion,
              metadata: { type: 'ai-confirmation' }
            });

            await refetchMessages();
          } catch (error) {
            console.error('Error getting property contact:', error);
            toast({
              title: "Error",
              description: "Failed to get property information",
              variant: "destructive"
            });
          } finally {
            setIsRequestingAI(false);
          }
        }
      }
    }
    setInputMessage('');
  };
  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };
  const handleMatchSelect = (matchId: string) => {
    setSelectedMatch(matchId);
    setIsStartingNewChat(false);
  };
  const handleStartNewChat = () => {
    setSelectedMatch(null);
    setIsStartingNewChat(true);
    // Clear any pending messages or state
    setInputMessage('');
    setPendingMessage('');
  };

  // AI auto-exit after 5 minutes of no new renter messages
  useEffect(() => {
    if (isAIActive && aiLastActiveTime) {
      // Clear existing timeout
      if (aiTimeoutRef.current) {
        clearTimeout(aiTimeoutRef.current);
      }

      // Set new timeout for 5 minutes
      aiTimeoutRef.current = setTimeout(async () => {
        if (!selectedMatch || !user?.id) return;
        
        const currentConv = conversations.find(c => c.id === selectedMatch);
        if (!currentConv) return;
        
        const receiverId = user?.id === currentConv.realtor_id ? currentConv.renter_id : currentConv.realtor_id;
        
        // Send exit message
        await supabase.from('direct_messages').insert({
          conversation_id: selectedMatch,
          sender_id: user?.id,
          receiver_id: receiverId,
          content: "I'll step away for now to let you both continue your conversation. Feel free to call me back anytime if you need more assistance! 👋",
          metadata: { type: 'ai-exit' }
        });
        
        await refetchMessages();
        setIsAIActive(false);
        setAiLastActiveTime(null);
      }, 5 * 60 * 1000); // 5 minutes
    }

    return () => {
      if (aiTimeoutRef.current) {
        clearTimeout(aiTimeoutRef.current);
      }
    };
  }, [isAIActive, aiLastActiveTime, selectedMatch, user?.id, conversations, refetchMessages]);

  // Proactive AI response to new renter messages when AI is active
  useEffect(() => {
    if (!isAIActive || !selectedMatch || !directMessages.length || !user?.id) return;

    const currentConv = conversations.find(c => c.id === selectedMatch);
    if (!currentConv) return;

    const lastMessage = directMessages[directMessages.length - 1];
    
    // Only respond to new renter messages
    if (lastMessage.sender_id !== currentConv.renter_id) return;
    
    // Don't respond to AI's own messages
    const isAIMessage = lastMessage?.metadata && 
      (lastMessage.metadata.type === 'ai-greeting' || 
       lastMessage.metadata.type === 'ai-suggestion' ||
       lastMessage.metadata.type === 'ai-exit' ||
       lastMessage.metadata.type === 'ai-confirmation');
    
    if (isAIMessage) return;

    // Check if we already responded to this message (in-memory only)
    if (aiRespondedToRef.current.has(lastMessage.id)) return;
    aiRespondedToRef.current.add(lastMessage.id);

    const respondToRenter = async () => {
      try {
        const receiverId = currentConv.renter_id;

        // Get recent messages for context
        const recentMessages = directMessages.slice(-5).map(m => ({
          role: m.sender_id === currentConv.renter_id ? 'user' : 'assistant',
          content: m.content,
        }));

        const propertiesContext = currentConv.properties?.map(p => ({
          title: p.title,
          location: p.location,
          price: p.price,
          property_source_provider_name: p.property_source_provider_name,
          property_source_provider_phone: p.property_source_provider_phone,
        })) || [];

        const { data: aiData, error: aiError } = await supabase.functions.invoke('hausto-ai-assist', {
          body: {
            userType: 'realtor',
            messages: recentMessages,
            properties: propertiesContext,
            action: null,
            isPremium: subscription_tier === 'premium',
          },
        });

        if (aiError) throw aiError;

        // Send AI response
        await supabase.from('direct_messages').insert({
          conversation_id: selectedMatch,
          sender_id: user.id,
          receiver_id: receiverId,
          content: aiData?.suggestion || "I'm here to help move things forward.",
          metadata: {
            type: 'ai-suggestion',
            suggestedActions: aiData?.suggestedActions || [],
          },
        });

        await refetchMessages();
        
        // Reset the 5-minute exit timer
        setAiLastActiveTime(Date.now());
      } catch (error) {
        console.error('Proactive AI response error:', error);
      }
    };

    // Respond immediately
    respondToRenter();
  }, [isAIActive, selectedMatch, directMessages, user?.id, conversations, refetchMessages]);

  // Reset AI timer only when AI sends a message
  useEffect(() => {
    if (isAIActive && directMessages.length > 0) {
      const lastMessage = directMessages[directMessages.length - 1];
      const isAIMessage = lastMessage?.metadata && 
        (lastMessage.metadata.type === 'ai-greeting' || 
         lastMessage.metadata.type === 'ai-suggestion' ||
         lastMessage.metadata.type === 'ai-confirmation');
      
      if (isAIMessage) {
        setAiLastActiveTime(Date.now());
      }
    }
  }, [directMessages.length, isAIActive, directMessages]);

  // Proactive AI: Auto-respond after 1 minute if realtor hasn't replied to renter
  useEffect(() => {
    if (!selectedMatch || !directMessages.length || !user?.id) return;

    const currentConv = conversations.find(c => c.id === selectedMatch);
    if (!currentConv) return;

    const lastMessage = directMessages[directMessages.length - 1];
    const convKey = selectedMatch;

    // If realtor replied, cancel any scheduled timer for this conversation
    if (lastMessage.sender_id === currentConv.realtor_id) {
      const existing = proactiveTimersRef.current[convKey];
      if (existing) {
        clearTimeout(existing);
        delete proactiveTimersRef.current[convKey];
      }
      lastScheduledMsgRef.current[convKey] = '';
      return;
    }

    // Only schedule when last message is from renter
    const isFromRenter = lastMessage.sender_id === currentConv.renter_id;
    if (!isFromRenter) return;

    // Avoid rescheduling for the same renter message across refetches
    if (lastScheduledMsgRef.current[convKey] === lastMessage.id) return;

    // Clear any prior timer and schedule a new one for this specific message
    const existingTimer = proactiveTimersRef.current[convKey];
    if (existingTimer) clearTimeout(existingTimer);
    lastScheduledMsgRef.current[convKey] = lastMessage.id;

    proactiveTimersRef.current[convKey] = setTimeout(async () => {
      console.log('Proactive AI: 1 minute passed, requesting server-side reply...');
      try {
        // Double-check the latest message is still not from the realtor
        const { data: latest } = await supabase
          .from('direct_messages')
          .select('id,sender_id,created_at')
          .eq('conversation_id', convKey)
          .order('created_at', { ascending: false })
          .limit(1)
          .single();

        if (latest?.sender_id === currentConv.realtor_id) {
          console.log('Proactive AI: Realtor has responded, canceling AI response');
          return;
        }

        // Ask server to step in and reply as realtor (uses service role)
        const { data, error } = await supabase.functions.invoke('proactive-ai-reply', {
          body: { conversationId: convKey },
        });

        if (error) {
          console.error('proactive-ai-reply error:', error);
          return;
        }

        setIsAIActive(true);
        setAiLastActiveTime(Date.now());
        await refetchMessages();

        toast({
          title: 'Hausto AI Active',
          description: 'AI has responded on behalf of the realtor.',
        });
      } catch (error) {
        console.error('Proactive AI error:', error);
      } finally {
        delete proactiveTimersRef.current[convKey];
      }
    }, 60000);
  }, [selectedMatch, user?.id, conversations, directMessages]);

  // Cleanup any pending timers on unmount
  useEffect(() => {
    return () => {
      Object.values(proactiveTimersRef.current).forEach((t) => clearTimeout(t));
    };
  }, []);

  const handleRequestAI = async () => {
    if (!selectedMatch || isRequestingAI) return;
    if (!user?.id) {
      toast({ title: 'Sign in required', description: 'Please sign in to use Hausto AI.' });
      return;
    }
    
    setIsRequestingAI(true);
    
    try {
      const currentConv = conversations.find(c => c.id === selectedMatch);
      if (!currentConv) return;

      const receiverId = user?.id === currentConv.realtor_id ? currentConv.renter_id : currentConv.realtor_id;

      // Clear the responded tracking when AI is manually activated
      aiRespondedToRef.current.clear();

      // Activate AI
      setIsAIActive(true);
      setAiLastActiveTime(Date.now());

      // First, insert greeting message from Hausto AI
      await supabase.from('direct_messages').insert({
        conversation_id: selectedMatch,
        sender_id: user?.id || '',
        receiver_id: receiverId,
        content: "Hi there! 👋 I'm Hausto AI, your real estate assistant. I've been following your conversation and I'm here to help facilitate this deal. How can I assist you both today?",
        metadata: { type: 'ai-greeting' }
      });

      // Refetch to show greeting immediately
      await refetchMessages();
      
      // Wait a moment for better UX
      await new Promise(resolve => setTimeout(resolve, 1500));

      // Get recent messages for context
      const recentMessages = directMessages.slice(-5).map(m => ({
        role: m.sender_id === user?.id ? 'user' : 'other',
        content: m.content
      }));

      // Ensure properties include provider info
      const propertiesWithProvider = currentConv.properties?.map(p => ({
        title: p.title,
        location: p.location,
        price: p.price,
        property_source_provider_name: p.property_source_provider_name,
        property_source_provider_phone: p.property_source_provider_phone,
      })) || [];

      console.log('Sending properties to AI:', propertiesWithProvider);

      const { data, error } = await supabase.functions.invoke('hausto-ai-assist', {
        body: {
          conversationId: selectedMatch,
          userType,
          messages: recentMessages,
          properties: propertiesWithProvider,
          isPremium: subscription_tier === 'premium',
        }
      });

      if (error) throw error;

      // Send AI suggestion message with actions
      await supabase.from('direct_messages').insert({
        conversation_id: selectedMatch,
        sender_id: user?.id || '',
        receiver_id: receiverId,
        content: data.suggestion,
        metadata: { 
          type: 'ai-suggestion',
          suggestedActions: data.suggestedActions || []
        }
      });

      // Refetch to show suggestion
      await refetchMessages();

      toast({
        title: "Hausto AI",
        description: "AI assistant has joined the conversation",
      });
    } catch (error) {
      console.error('Error requesting AI:', error);
      toast({
        title: "Error",
        description: "Failed to get AI assistance",
        variant: "destructive"
      });
    } finally {
      setIsRequestingAI(false);
    }
  };

  const handleAIAction = async (action: string) => {
    if (!selectedMatch || isRequestingAI || !user?.id) return;
    
    // Special handling for Get Fast Track for premium users
    if (action === 'get_fast_track' && subscription_tier === 'premium') {
      setIsViewingScheduleModalOpen(true);
      return;
    }
    
    setIsRequestingAI(true);
    setAiLastActiveTime(Date.now()); // Reset timer
    
    try {
      const currentConv = conversations.find(c => c.id === selectedMatch);
      if (!currentConv) return;

      const receiverId = user?.id === currentConv.realtor_id ? currentConv.renter_id : currentConv.realtor_id;

      // Get action label
      const actionLabels: Record<string, string> = {
        contact_provider: 'Contact Listing Provider',
        get_fast_track: 'Get Fast Track'
      };

      // Insert user's action selection as a message
      await supabase.from('direct_messages').insert({
        conversation_id: selectedMatch,
        sender_id: user?.id,
        receiver_id: receiverId,
        content: `[Selected: ${actionLabels[action] || action}]`,
        metadata: { type: 'user-action' }
      });

      await refetchMessages();
      await new Promise(resolve => setTimeout(resolve, 800));

      // Get recent messages for context
      const recentMessages = directMessages.slice(-5).map(m => ({
        role: m.sender_id === user?.id ? 'user' : 'other',
        content: m.content
      }));

      // Ensure properties include provider info
      const propertiesWithProvider = currentConv.properties?.map(p => ({
        id: p.property_id,
        title: p.title,
        location: p.location,
        price: p.price,
        images: p.images,
        property_source_provider_name: p.property_source_provider_name,
        property_source_provider_phone: p.property_source_provider_phone,
      })) || [];

      console.log('Sending properties to AI (action):', propertiesWithProvider);

      const { data, error } = await supabase.functions.invoke('hausto-ai-assist', {
        body: {
          conversationId: selectedMatch,
          userType,
          messages: recentMessages,
          properties: propertiesWithProvider,
          action,
          isPremium: subscription_tier === 'premium',
        }
      });

      if (error) throw error;

      // Check if AI is requesting property selection
      if (data.requirePropertySelection && data.availableProperties) {
        setPropertiesToSelect(data.availableProperties);
        setShowPropertySelectionForContact(true);
        // Don't send the suggestion message when showing property selection UI
      } else {
        // Send AI follow-up
        await supabase.from('direct_messages').insert({
          conversation_id: selectedMatch,
          sender_id: user?.id,
          receiver_id: receiverId,
          content: data.suggestion,
          metadata: { type: 'ai-suggestion' }
        });

        await refetchMessages();
      }
    } catch (error) {
      console.error('Error handling AI action:', error);
      toast({
        title: "Error",
        description: "Failed to process action",
        variant: "destructive"
      });
    } finally {
      setIsRequestingAI(false);
    }
  };

  const handlePropertySelectionForContact = async (property: any) => {
    if (!selectedMatch || !user?.id) return;
    
    setShowPropertySelectionForContact(false);
    setPropertiesToSelect([]);
    setIsRequestingAI(true);
    
    try {
      const currentConv = conversations.find(c => c.id === selectedMatch);
      if (!currentConv) return;

      const receiverId = user?.id === currentConv.realtor_id ? currentConv.renter_id : currentConv.realtor_id;

      // Call AI with the selected property
      const { data, error } = await supabase.functions.invoke('hausto-ai-assist', {
        body: {
          userType,
          messages: [],
          properties: [property], // Send only the selected property
          action: 'contact_provider',
          isPremium: subscription_tier === 'premium',
        }
      });

      if (error) throw error;

      // Send AI response with contact info
      await supabase.from('direct_messages').insert({
        conversation_id: selectedMatch,
        sender_id: user?.id,
        receiver_id: receiverId,
        content: data.suggestion,
        metadata: { type: 'ai-confirmation' }
      });

      await refetchMessages();
    } catch (error) {
      console.error('Error getting property contact:', error);
      toast({
        title: "Error",
        description: "Failed to get property information",
        variant: "destructive"
      });
    } finally {
      setIsRequestingAI(false);
    }
  };

  const handleViewingScheduleSubmit = async (scheduleData: ViewingScheduleData) => {
    if (!selectedMatch || !user?.id) return;

    try {
      const currentConv = conversations.find(c => c.id === selectedMatch);
      if (!currentConv) return;

      const receiverId = user?.id === currentConv.realtor_id ? currentConv.renter_id : currentConv.realtor_id;

      // Insert into fast_track_requests table with selected properties
      const { error: requestError } = await supabase.from('fast_track_requests').insert({
        conversation_id: selectedMatch,
        renter_id: user.id,
        realtor_id: currentConv.realtor_id,
        property_ids: scheduleData.selectedPropertyIds,
        preferred_dates: scheduleData.dates.map(d => format(d, 'yyyy-MM-dd')),
        preferred_times: scheduleData.preferredTimes,
        special_requirements: scheduleData.specialRequirements || null,
        status: 'pending'
      });

      if (requestError) throw requestError;

      // Send notification emails to admin and renter
      try {
        const { data: profile } = await supabase
          .from('profiles')
          .select('name, email')
          .eq('id', user.id)
          .single();

        // Get titles for selected properties only
        const selectedProperties = currentConv.properties?.filter(p => 
          scheduleData.selectedPropertyIds.includes(p.property_id)
        ) || [];
        
        const propertyData = selectedProperties.map(p => ({
          id: p.property_id,
          title: p.title || 'Untitled Property',
          location: p.location,
          price: p.price,
          imageUrl: p.images?.[0] || ''
        }));

        await supabase.functions.invoke('notify-fast-track-request', {
          body: {
            renterName: profile?.name || 'User',
            renterEmail: profile?.email || user.email || '',
            preferredDates: scheduleData.dates.map(d => format(d, 'MMM dd, yyyy')),
            preferredTimes: scheduleData.preferredTimes,
            specialRequirements: scheduleData.specialRequirements || '',
            properties: propertyData,
            conversationId: selectedMatch,
          },
        });
        console.log('Fast track notification sent successfully');
      } catch (notificationError) {
        console.error('Error sending fast track notification:', notificationError);
        // Don't throw - continue with chat message even if notification fails
      }

      // Format the viewing schedule message
      const datesText = scheduleData.dates
        .map(d => format(d, 'MMM dd, yyyy'))
        .join(', ');
      const timesText = scheduleData.preferredTimes.join(', ');
      const requirementsText = scheduleData.specialRequirements 
        ? `\n\nSpecial Requirements: ${scheduleData.specialRequirements}`
        : '';

      const scheduleMessage = `🎯 **Fast Track Request Submitted**\n\nPreferred Dates: ${datesText}\nPreferred Times: ${timesText}${requirementsText}\n\nHausto Agent will coordinate viewings for up to 3 property listings and get back to you with viewing details soon!`;

      // Insert the schedule request message from AI
      const { error: insertError } = await supabase.from('direct_messages').insert({
        conversation_id: selectedMatch,
        sender_id: user.id,
        receiver_id: receiverId,
        content: scheduleMessage,
        metadata: { 
          type: 'ai-confirmation',
          scheduleData: scheduleData as any
        }
      });

      if (insertError) throw insertError;

      await refetchMessages();

      toast({
        title: "Fast Track Request Submitted!",
        description: "Hausto Agent will coordinate the viewings and get back to you soon.",
      });
    } catch (error) {
      console.error('Error submitting viewing schedule:', error);
      toast({
        title: "Error",
        description: "Failed to submit viewing schedule",
        variant: "destructive"
      });
    }
  };

  const getPlaceholder = () => {
    return 'Type your message...';
  };
  const convs = conversations;
  
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="w-full max-w-4xl h-[85vh] sm:h-[90vh] max-h-[85vh] sm:max-h-[90vh] p-0 flex flex-col glass-card bg-white/40 backdrop-blur-xl overflow-hidden sm:rounded-2xl border-white/20 shadow-2xl">
        {/* Animated Background Blobs */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none z-0">
          <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] rounded-full bg-gradient-to-tr from-orange-400/20 to-pink-500/20 blur-3xl animate-blob-float-1" />
          <div className="absolute bottom-[-10%] right-[-10%] w-[60%] h-[60%] rounded-full bg-gradient-to-bl from-purple-400/20 to-pink-400/20 blur-3xl animate-blob-float-2" />
        </div>

        <DialogTitle className="sr-only">Hausto Chat Assistant</DialogTitle>
        <DialogDescription className="sr-only">
          Chat with Hausto AI assistant for property recommendations and real estate help
        </DialogDescription>
        
        {/* Header - Conversation List Mode */}
        <div className="p-3 md:p-4 border-b border-white/30 bg-white/40 backdrop-blur-md relative z-10 flex-shrink-0 shadow-sm">
          <h2 className="text-lg md:text-xl font-semibold bg-gradient-to-r from-orange-600 to-pink-600 bg-clip-text text-transparent drop-shadow-sm">Hausto Chat</h2>
        </div>

        

        <div className="flex-1 flex flex-col overflow-hidden relative z-10">
          {!selectedMatch && !isStartingNewChat ? <div className="flex-1 flex flex-col overflow-hidden">
              <div className="p-3 border-b border-white/30 bg-white/40 backdrop-blur-sm flex items-center justify-between">
                <div>
                  
                  <p className="text-sm font-medium text-gray-700">
                    {convs.length} conversation{convs.length !== 1 ? 's' : ''}
                  </p>
                </div>
                
              </div>
              
              <ScrollArea className="flex-1 p-3">
                <div className="space-y-3">
                  
                  {/* User conversations */}
                  {convs.map(conv => {
                    const isRealtor = userType === 'realtor';
                    const otherUserName = isRealtor ? conv.renter_name : conv.realtor_name;
                    const otherUserId = isRealtor ? conv.renter_id : conv.realtor_id;
                    const firstProp = conv.properties?.[0];
                    const extraCount = Math.max((conv.properties?.length || 0) - 1, 0);
                    return (
                      <div
                        key={conv.id}
                        onClick={() => handleMatchSelect(conv.id)}
                        className="p-3 sm:p-4 cursor-pointer bg-white/50 backdrop-blur-md hover:bg-white/70 transition-all duration-300 rounded-xl border border-white/60 hover:border-orange-300/60 hover:shadow-lg group shadow-sm"
                      >
                        <div className="flex items-start gap-2 sm:gap-3">
                          <Avatar className="w-9 h-9 sm:w-12 sm:h-12 flex-shrink-0">
                            <AvatarImage src={isRealtor ? conv.renter_avatar : conv.realtor_avatar} />
                            <AvatarFallback className="bg-gradient-to-r from-blue-500 to-purple-500 text-white font-semibold text-xs sm:text-sm">
                              {isRealtor ? 'R' : 'P'}
                            </AvatarFallback>
                          </Avatar>
                          <div className="flex-1 min-w-0 space-y-1 sm:space-y-1.5">
                            <p
                              className="font-medium text-sm sm:text-base text-gray-900 hover:text-orange-600 cursor-pointer line-clamp-1"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (isRealtor) {
                                  setSelectedRenterId(otherUserId);
                                } else {
                                  setSelectedRealtorId(otherUserId);
                                }
                              }}
                            >
                              {otherUserName || (isRealtor ? 'Interested Renter' : 'Property Owner')}
                            </p>
                            <p className="text-xs sm:text-sm text-gray-600 line-clamp-1">
                              {firstProp?.title}{extraCount > 0 ? ` (+${extraCount} more)` : ''}
                            </p>
                            <div className="flex items-center">
                              <MapPin className="w-3 h-3 text-gray-400 mr-1 flex-shrink-0" />
                              <span className="text-xs text-gray-500 line-clamp-1">
                                {firstProp?.location}
                              </span>
                            </div>
                            <div className="flex items-center justify-between gap-2 pt-0.5">
                              <Badge variant="secondary" className="text-xs bg-orange-100 text-orange-800 shrink-0">
                                {formatPrice(Number(firstProp?.price || 0))}/mo
                              </Badge>
                              <span className="text-xs text-gray-400 shrink-0">
                                {new Date(conv.created_at).toLocaleDateString()}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </ScrollArea>
            </div> : (/* User Messages Interface */
        <div className="flex-1 flex flex-col overflow-hidden relative z-10">
              <div className="p-2 sm:p-4 border-b border-white/30 bg-white/40 backdrop-blur-md flex-shrink-0 shadow-sm">
                <div className="flex items-center justify-between w-full gap-2">
                  <div className="flex items-center space-x-2 sm:space-x-3">
                    <Button variant="ghost" size="sm" onClick={() => setSelectedMatch(null)} className="hover:bg-white/50 p-1 rounded-full" aria-label="Back to conversations">
                      <ArrowLeft className="w-3 h-3 sm:w-4 sm:h-4" />
                    </Button>
                    <Avatar className="w-8 h-8 sm:w-10 sm:h-10 flex-shrink-0 shadow-sm ring-2 ring-white/50">
                    <AvatarImage src={(() => {
                      const currentConv = conversations.find(c => c.id === selectedMatch);
                      return userType === 'realtor' ? currentConv?.renter_avatar : currentConv?.realtor_avatar;
                    })()} />
                    <AvatarFallback className="bg-gradient-to-r from-blue-500 to-purple-500 text-white font-semibold">
                      {userType === 'realtor' ? 'R' : 'P'}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    {(() => {
                      const currentConv = conversations.find(c => c.id === selectedMatch);
                      const isRealtor = userType === 'realtor';
                      const otherUserName = isRealtor ? currentConv?.renter_name : currentConv?.realtor_name;
                      const otherUserId = isRealtor ? currentConv?.renter_id : currentConv?.realtor_id;
                      return (
                        <>
                          <h4
                            className="text-sm sm:text-base font-semibold text-gray-900 hover:text-orange-600 cursor-pointer"
                            onClick={() => {
                              if (isRealtor) {
                                setSelectedRenterId(otherUserId || null);
                              } else {
                                setSelectedRealtorId(otherUserId || null);
                              }
                            }}
                          >
                            {otherUserName || (isRealtor ? 'Interested Renter' : 'Property Owner')}
                          </h4>
                        </>
                      );
                     })()}
                    <button 
                      className="text-xs sm:text-sm text-blue-600 hover:text-blue-800 hover:underline text-left font-medium"
                      onClick={() => setShowPropertyList(true)}
                    >
                      {(() => {
                        const currentConv = conversations.find(c => c.id === selectedMatch);
                        const firstProp = currentConv?.properties?.[0];
                        const extraCount = Math.max((currentConv?.properties?.length || 0) - 1, 0);
                        return firstProp ? `${firstProp.title}${extraCount > 0 ? ` (+${extraCount} more)` : ''}` : 'View properties';
                      })()}
                    </button>
                  </div>
                  </div>
                  {!isAIActive ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleRequestAI}
                      disabled={isRequestingAI}
                      className="glass bg-white/70 hover:bg-white border-purple-200/50 hover:border-purple-300 text-purple-700 text-[10px] sm:text-xs rounded-full shadow-sm hover:shadow-md transition-all duration-300"
                    >
                      <MessageCircle className="w-3 h-3 sm:mr-1 text-purple-500" />
                      <span className="hidden sm:inline font-semibold">{isRequestingAI ? 'Calling AI...' : 'Ask Hausto AI'}</span>
                      <span className="sm:hidden font-semibold">{isRequestingAI ? 'AI...' : 'AI'}</span>
                    </Button>
                  ) : (
                    <Badge className="bg-gradient-to-r from-purple-500 to-pink-500 text-white border-0 text-[8px] sm:text-xs px-2 sm:px-3 py-0.5 sm:py-1 rounded-full shadow-sm flex items-center justify-center whitespace-nowrap animate-pulse-ring">
                      <span className="hidden sm:inline font-semibold">AI Active</span>
                      <span className="sm:hidden font-semibold">AI</span>
                    </Badge>
                  )}
                </div>
              </div>

              <div className="flex-1 p-4 overflow-y-auto" style={{
            maxHeight: 'calc(90vh - 200px)'
          }}>
                {directMessages.length === 0 ? <div className="flex items-center justify-center h-full text-gray-500">
                    <div className="text-center">
                      <MessageCircle className="w-12 h-12 mx-auto mb-4 opacity-50" />
                      <p className="text-base">Start the conversation!</p>
                      <p className="text-sm text-gray-400 mt-1">Send a message to connect</p>
                    </div>
                  </div> : <div className="space-y-4">
                    {directMessages.map(message => {
                      const isOwnMessage = message.sender_id === user?.id;
                      const isAIMessage = message.metadata?.type === 'ai-greeting' || message.metadata?.type === 'ai-suggestion' || message.metadata?.type === 'ai-exit' || message.metadata?.type === 'ai-confirmation';
                      const isUserAction = message.metadata?.type === 'user-action';
                      const currentConv = conversations.find(c => c.id === selectedMatch);
                      const isRealtor = userType === 'realtor';
                      const senderName = isAIMessage ? 'Hausto AI' : (isOwnMessage ? 'You' : (isRealtor ? (currentConv?.renter_name || 'Renter') : (currentConv?.realtor_name || 'Property Owner')));
                      
                      // Hide user action messages
                      if (isUserAction) return null;
                      
                      if (isAIMessage) {
                        return (
                          <div key={message.id}>
                            <div className="flex justify-center my-4 relative">
                              <div className="w-[85%] max-w-lg glass bg-white/70 border border-purple-200/50 shadow-[0_4px_20px_-4px_rgba(168,85,247,0.15)] rounded-2xl p-4 sm:p-5 mx-auto relative overflow-hidden group">
                                {/* Glow effect background */}
                                <div className="absolute inset-0 bg-gradient-to-br from-purple-500/5 to-pink-500/5 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />
                                
                                <div className="flex items-center gap-3 mb-3 relative z-10">
                                  <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-purple-600 to-pink-500 flex items-center justify-center flex-shrink-0 shadow-md">
                                    <MessageCircle className="w-4 h-4 text-white" />
                                  </div>
                                  <span className="text-sm font-bold bg-gradient-to-r from-purple-700 to-pink-600 bg-clip-text text-transparent">Hausto AI Assistant</span>
                                </div>
                                <p className="text-sm sm:text-base text-gray-800 leading-relaxed whitespace-pre-wrap relative z-10">
                                  {message.content.split(/(\[View My Matches\]\(\/\)|"[^"]+")/).map((part, idx) => {
                                    if (part === '[View My Matches](/)') {
                                      return (
                                        <button
                                          key={idx}
                                          onClick={() => setShowPropertyList(true)}
                                          className="text-blue-600 hover:text-blue-800 underline font-medium"
                                        >
                                          View My Matches
                                        </button>
                                      );
                                    }
                                    // Check if this is a quoted property title
                                    if (part.startsWith('"') && part.endsWith('"')) {
                                      const propertyTitle = part.slice(1, -1);
                                      const matchedProperty = currentConv?.properties?.find(
                                        p => p.title === propertyTitle
                                      );
                                      
                                      if (matchedProperty) {
                                        return (
                                          <button
                                            key={idx}
                                            onClick={async () => {
                                              try {
                                                const { data: fullProperty, error } = await supabase
                                                  .from('properties')
                                                  .select('*')
                                                  .eq('id', matchedProperty.property_id)
                                                  .maybeSingle();

                                                if (error) throw error;

                                                if (!fullProperty || !fullProperty.is_active) {
                                                  toast({
                                                    title: 'Property No Longer Available',
                                                    description: 'This property is no longer listed.',
                                                  });
                                                  return;
                                                }

                                                setDetailModalApartment({
                                                  id: fullProperty.id,
                                                  images: fullProperty.images || [],
                                                  title: fullProperty.title,
                                                  location: fullProperty.location,
                                                  price: Number(fullProperty.price || 0),
                                                  size: fullProperty.size || '',
                                                  vibe: fullProperty.vibe || '',
                                                  description: fullProperty.description || '',
                                                  highlights: fullProperty.highlights || [],
                                                  vibe_analysis: fullProperty.vibe_analysis,
                                                  property_source_link: fullProperty.property_source_link,
                                                  realtor: {
                                                    id: currentConv.realtor_id,
                                                    name: currentConv.realtor_name || 'Property Owner',
                                                    phone: '+1-234-567-8900',
                                                    email: 'contact@realtor.com'
                                                  },
                                                  matchId: currentConv.id
                                                });
                                              } catch (error) {
                                                console.error('Error fetching property details:', error);
                                                toast({
                                                  title: 'Error',
                                                  description: 'Failed to load property details',
                                                  variant: 'destructive'
                                                });
                                              }
                                            }}
                                            className="text-blue-600 hover:text-blue-800 underline font-medium"
                                          >
                                            {part}
                                          </button>
                                        );
                                      }
                                    }
                                    return part;
                                  })}
                                </p>
                                <span className="text-xs text-gray-400 mt-2 block">
                                  {new Date(message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                </span>
                              </div>
                            </div>
                            
                            {/* Show suggested actions */}
                            {message.metadata?.suggestedActions && message.metadata.suggestedActions.length > 0 && (
                              <div className="flex justify-center gap-2 mt-2 flex-wrap">
                                {message.metadata.suggestedActions.map((action: string) => {
                                  const actionLabels: Record<string, string> = {
                                    contact_provider: 'Contact Listing Provider',
                                    get_fast_track: 'Get Fast Track'
                                  };
                                  return (
                                    <Button
                                      key={action}
                                      size="sm"
                                      variant="outline"
                                      onClick={() => handleAIAction(action)}
                                      disabled={isRequestingAI}
                                      className="text-xs glass bg-white/70 hover:bg-white border-purple-200/50 hover:border-purple-300 text-purple-700 rounded-full shadow-sm hover:shadow-md transition-all duration-300 relative z-10"
                                    >
                                      {actionLabels[action] || action}
                                    </Button>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      }
                      
                      return (
                        <div key={message.id} className={`flex gap-2 ${isOwnMessage ? 'justify-end' : 'justify-start'}`}>
                          {!isOwnMessage && (
                            <Avatar className="w-8 h-8 flex-shrink-0 mt-1">
                              <AvatarImage src={isRealtor ? currentConv?.renter_avatar : currentConv?.realtor_avatar} />
                              <AvatarFallback className="bg-gradient-to-r from-blue-500 to-purple-500 text-white text-xs">
                                {senderName.charAt(0)}
                              </AvatarFallback>
                            </Avatar>
                          )}
                          <div className={`flex flex-col ${isOwnMessage ? 'items-end' : 'items-start'} max-w-[70%]`}>
                            <p className="text-xs text-gray-500 mb-1 px-1">
                              {senderName}
                            </p>
                            <div className={`w-full px-3 py-2 sm:px-4 sm:py-3 rounded-2xl break-words shadow-sm ${isOwnMessage ? 'bg-gradient-to-br from-orange-500 to-pink-600 text-white border border-white/20' : 'glass bg-white/80 border border-white/40 text-gray-900 shadow-[0_2px_10px_-2px_rgba(0,0,0,0.05)]'}`}>
                              <p className="text-xs sm:text-sm whitespace-pre-wrap leading-relaxed">{message.content}</p>
                              <p className={`text-[10px] sm:text-xs mt-1 ${isOwnMessage ? 'text-white/70' : 'text-gray-500'}`}>
                                {new Date(message.created_at).toLocaleTimeString([], {
                                  hour: '2-digit',
                                  minute: '2-digit'
                                })}
                              </p>
                            </div>
                          </div>
                          {isOwnMessage && (
                            <Avatar className="w-8 h-8 flex-shrink-0 mt-1">
                              <AvatarImage src={isRealtor ? currentConv?.realtor_avatar : currentConv?.renter_avatar} />
                              <AvatarFallback className="bg-gradient-to-r from-orange-500 to-pink-500 text-white text-xs">
                                {senderName.charAt(0)}
                              </AvatarFallback>
                            </Avatar>
                          )}
                        </div>
                      );
                    })}
                  </div>}
                 <div ref={messagesEndRef} />
               </div>

              <div className="p-3 sm:p-4 border-t border-white/30 bg-white/40 backdrop-blur-md flex-shrink-0 relative z-10">
                <div className="flex space-x-2 relative">
                  <div className="absolute inset-0 bg-gradient-to-r from-orange-500/10 to-pink-500/10 rounded-xl blur-md -z-10" />
                  <Input value={inputMessage} onChange={e => setInputMessage(e.target.value)} placeholder="Type your message..." onKeyPress={handleKeyPress} disabled={isSendingDirectMessage} className="flex-1 text-sm md:text-base glass bg-white/70 border-white/50 rounded-xl focus-visible:ring-orange-400" />
                  <Button onClick={handleSendMessage} disabled={!inputMessage.trim() || isSendingDirectMessage} className="bg-gradient-to-r from-orange-500 to-pink-500 hover:from-orange-600 hover:to-pink-600 flex-shrink-0 rounded-xl shadow-md hover:shadow-lg transition-all duration-300 transform hover:-translate-y-0.5 w-10 h-10 p-0 flex items-center justify-center">
                    <Send className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </div>)}
        </div>

        {detailModalApartment && <PropertyDetailModal apartment={detailModalApartment} userPreferences={userPreferences} isOpen={!!detailModalApartment} onClose={() => setDetailModalApartment(null)} />}

        {selectedRealtorId && <RealtorProfileModal realtorId={selectedRealtorId} isOpen={!!selectedRealtorId} onClose={() => setSelectedRealtorId(null)} />}

        {selectedRenterId && <RenterProfileModal userId={selectedRenterId} isOpen={!!selectedRenterId} onClose={() => setSelectedRenterId(null)} />}

        <ViewingScheduleModal 
          isOpen={isViewingScheduleModalOpen}
          onClose={() => setIsViewingScheduleModalOpen(false)}
          onSubmit={handleViewingScheduleSubmit}
          matchedProperties={
            conversations.find(c => c.id === selectedMatch)?.properties?.map(p => ({
              id: p.property_id,
              title: p.title || 'Untitled Property',
              images: p.images,
              location: p.location,
              price: p.price
            })) || []
          }
          onPropertyClick={(propertyId) => {
            // Find the property and open detail modal
            const conv = conversations.find(c => c.id === selectedMatch);
            const property = conv?.properties?.find(p => p.property_id === propertyId);
            if (property) {
              setDetailModalApartment({
                id: property.property_id,
                title: property.title,
                location: property.location,
                price: property.price,
                images: property.images,
                size: 'N/A',
                vibe: 'N/A',
                description: '',
                highlights: [],
                realtor: {
                  id: '',
                  name: property.property_source_provider_name || 'Property Provider',
                  phone: property.property_source_provider_phone || '',
                  email: ''
                },
                propertySourceProviderName: property.property_source_provider_name,
                propertySourceProviderPhone: property.property_source_provider_phone
              } as Apartment);
            }
          }}
        />

        {/* Property Selection for Contact Provider */}
        {/* Property List Modal */}
        <Dialog open={showPropertyList} onOpenChange={setShowPropertyList}>
          <DialogContent className="max-w-md bg-white">
            <DialogTitle className="text-lg font-semibold bg-gradient-to-r from-orange-600 to-pink-600 bg-clip-text text-transparent">
              Matched Properties
            </DialogTitle>
            <DialogDescription className="text-sm text-gray-600">
              View and explore your matched properties:
            </DialogDescription>
            <div className="space-y-3 mt-4 max-h-[400px] overflow-y-auto">
              {(() => {
                const currentConv = conversations.find(c => c.id === selectedMatch);
                return currentConv?.properties?.map((prop, index) => (
                  <button
                    key={prop.property_id}
                    onClick={async () => {
                      try {
                        // Try internal properties first
                        const { data: fullProperty, error } = await supabase
                          .from('properties')
                          .select('*')
                          .eq('id', prop.property_id)
                          .maybeSingle();

                        if (error) throw error;

                        if (fullProperty && fullProperty.is_active) {
                          setDetailModalApartment({
                            id: fullProperty.id,
                            images: fullProperty.images || [],
                            title: fullProperty.title,
                            location: fullProperty.location,
                            price: Number(fullProperty.price || 0),
                            size: fullProperty.size || '',
                            vibe: fullProperty.vibe || '',
                            description: fullProperty.description || '',
                            highlights: fullProperty.highlights || [],
                            vibe_analysis: fullProperty.vibe_analysis,
                            property_source_link: fullProperty.property_source_link,
                            realtor: {
                              id: currentConv.realtor_id,
                              name: currentConv.realtor_name || 'Property Owner',
                              phone: '+1-234-567-8900',
                              email: 'contact@realtor.com'
                            },
                            matchId: currentConv.id
                          });
                          setShowPropertyList(false);
                          return;
                        }

                        // Try external properties
                        const { data: extProperty, error: extError } = await supabase
                          .from('external_properties')
                          .select('*')
                          .eq('id', prop.property_id)
                          .maybeSingle();

                        if (extError) throw extError;

                        if (extProperty && extProperty.is_active) {
                          setDetailModalApartment({
                            id: extProperty.id,
                            images: extProperty.images || [],
                            title: extProperty.title,
                            location: extProperty.location,
                            price: Number(extProperty.price || 0),
                            size: extProperty.size || '',
                            vibe: extProperty.vibe || '',
                            description: extProperty.description || '',
                            highlights: extProperty.highlights || [],
                            vibe_analysis: extProperty.vibe_analysis,
                            property_source_link: extProperty.source_url,
                            property_source_provider_name: extProperty.contact_name,
                            property_source_provider_phone: extProperty.contact_phone,
                            realtor: {
                              id: currentConv.realtor_id,
                              name: currentConv.realtor_name || 'Hausto Agent',
                              phone: '',
                              email: ''
                            },
                            matchId: currentConv.id
                          });
                          setShowPropertyList(false);
                          return;
                        }

                        toast({
                          title: 'Property No Longer Available',
                          description: 'This property is no longer listed. It may have been rented or removed by the owner.',
                        });
                      } catch (error) {
                        console.error('Error fetching property details:', error);
                        toast({
                          title: 'Error',
                          description: 'Failed to load property details',
                          variant: 'destructive'
                        });
                      }
                    }}
                    className="w-full flex items-center gap-3 p-3 border border-gray-200 rounded-lg hover:border-orange-300 hover:bg-orange-50 transition-colors text-left"
                  >
                    {prop.images?.[0] ? (
                      <img 
                        src={prop.images[0]} 
                        alt={prop.title}
                        className="w-16 h-16 object-cover rounded-md flex-shrink-0"
                      />
                    ) : (
                      <div className="w-16 h-16 bg-gray-100 rounded-md flex items-center justify-center flex-shrink-0">
                        <MapPin className="w-6 h-6 text-gray-400" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <h4 className="font-medium text-sm text-gray-900 truncate">{prop.title}</h4>
                      <p className="text-xs text-gray-500 truncate">{prop.location}</p>
                      {prop.price && (
                        <p className="text-xs font-medium text-orange-600 mt-1">
                          {formatPrice(Number(prop.price))}/mo
                        </p>
                      )}
                    </div>
                  </button>
                ));
              })()}
            </div>
            <div className="flex justify-end mt-4">
              <Button 
                variant="outline" 
                size="sm"
                onClick={() => setShowPropertyList(false)}
              >
                Close
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Property Selection for Contact Modal */}
        <Dialog open={showPropertySelectionForContact} onOpenChange={setShowPropertySelectionForContact}>
          <DialogContent className="max-w-md bg-white">
            <DialogTitle className="text-lg font-semibold bg-gradient-to-r from-orange-600 to-pink-600 bg-clip-text text-transparent">
              Select a Property
            </DialogTitle>
            <DialogDescription className="text-sm text-gray-600">
              Choose which property you'd like to contact the listing provider for:
            </DialogDescription>
            <div className="space-y-3 mt-4 max-h-[400px] overflow-y-auto">
              {propertiesToSelect.map((property, index) => (
                <button
                  key={property.id || index}
                  onClick={() => handlePropertySelectionForContact(property)}
                  className="w-full flex items-center gap-3 p-3 border border-gray-200 rounded-lg hover:border-orange-300 hover:bg-orange-50 transition-colors text-left"
                >
                  {property.images?.[0] ? (
                    <img 
                      src={property.images[0]} 
                      alt={property.title}
                      className="w-16 h-16 object-cover rounded-md flex-shrink-0"
                    />
                  ) : (
                    <div className="w-16 h-16 bg-gray-100 rounded-md flex items-center justify-center flex-shrink-0">
                      <MapPin className="w-6 h-6 text-gray-400" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <h4 className="font-medium text-sm text-gray-900 truncate">{property.title}</h4>
                    <p className="text-xs text-gray-500 truncate">{property.location}</p>
                    {property.price && (
                      <p className="text-xs font-medium text-orange-600 mt-1">
                        {formatPrice(property.price)}/mo
                      </p>
                    )}
                    {property.providerName && (
                      <p className="text-xs text-green-600 mt-1">✓ Contact available</p>
                    )}
                    {!property.providerName && (
                      <p className="text-xs text-gray-400 mt-1">No contact info</p>
                    )}
                  </div>
                </button>
              ))}
            </div>
            <div className="flex justify-end mt-4">
              <Button 
                variant="outline" 
                size="sm"
                onClick={() => {
                  setShowPropertySelectionForContact(false);
                  setPropertiesToSelect([]);
                }}
              >
                Cancel
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  );
};