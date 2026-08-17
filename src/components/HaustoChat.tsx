import { useState, useEffect, useRef } from 'react';
import { PROPERTY_PUBLIC_COLUMNS } from '@/lib/propertyColumns';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { X, Send, MessageCircle, MessageCircleQuestion, MapPin, ArrowLeft, Check, ChevronRight } from 'lucide-react';
import { RenterQuestionsDialog } from '@/components/realtor/RenterQuestionsDialog';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useDirectMessages } from '@/hooks/useDirectMessages';
import { useFastTrackRequest } from '@/hooks/useFastTrackRequest';
import { useViewingQuota } from '@/hooks/useViewingQuota';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';

import { useAuth } from '@/hooks/useAuth';
import { useCurrency } from '@/contexts/CurrencyContext';
import { EditorialPropertyCard } from '@/components/EditorialPropertyCard';
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
  /** Pre-tags the conversation with this matched property (e.g. the listing the
   *  renter clicked "Chat" on in MatchesView). */
  initialPropertyId?: string | null;
}
// Render message text with clickable URLs (e.g. property links a realtor
// includes in an answer). Splits on http(s) URLs; everything else is plain text.
const renderWithLinks = (text: string, isOwn: boolean) => {
  if (!text) return text;
  const parts = text.split(/(https?:\/\/[^\s]+)/g);
  return parts.map((part, i) =>
    /^https?:\/\//.test(part) ? (
      <a
        key={i}
        href={part}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className={`underline underline-offset-2 break-all ${isOwn ? 'text-white' : 'text-orange-600 hover:text-orange-700'}`}
      >
        {part}
      </a>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
};

export const HaustoChat = ({
  isOpen,
  onClose,
  userPreferences,
  userType,
  propertyImages = [],
  initialMatchId = null,
  initialPropertyId = null
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
  const [isViewingScheduleModalOpen, setIsViewingScheduleModalOpen] = useState(false);
  // Which matched listings the renter is currently asking about (multi-select).
  // Tags outgoing messages with metadata.property_id (first pick, for the
  // concierge AI / realtor) plus metadata.property_ids when several are picked.
  const [activePropertyIds, setActivePropertyIds] = useState<string[]>([]);
  const [isSharingContact, setIsSharingContact] = useState(false);
  // Shows "Hausto AI is typing…" between a renter send and the concierge reply.
  const [isAwaitingConcierge, setIsAwaitingConcierge] = useState(false);
  // Realtor-only: unresolved escalated questions surface as a chat banner
  const [showQuestionsDialog, setShowQuestionsDialog] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const conciergeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const {
    formatPrice
  } = useCurrency();
  const {
    user
  } = useAuth();

  // Unresolved escalated questions (realtors only) - drives the "Review & reply"
  // banner and the per-conversation badges. Returns the total plus a
  // conversation_id -> count map from one query.
  const { data: questionInfo = { total: 0, byConversation: new Map<string, number>() } } = useQuery({
    queryKey: ['pending-renter-questions', user?.id],
    enabled: !!user?.id && userType === 'realtor' && isOpen,
    refetchInterval: 30000,
    queryFn: async () => {
      const { data } = await supabase
        .from('concierge_escalations')
        .select('conversation_id')
        .eq('realtor_id', user!.id)
        .eq('status', 'pending');
      const byConversation = new Map<string, number>();
      for (const row of data || []) {
        const cid = (row as any).conversation_id;
        if (cid) byConversation.set(cid, (byConversation.get(cid) || 0) + 1);
      }
      return { total: (data || []).length, byConversation };
    },
  });
  const pendingQuestionCount = questionInfo.total;
  const { quota } = useViewingQuota();
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
  const { submitFastTrack } = useFastTrackRequest();

  // Escalation statuses for this thread → pending/answered chips on
  // ai-escalation-notice messages. Poll alongside the 3s message refetch.
  const { data: escalations = [] } = useQuery({
    queryKey: ['concierge-escalations', selectedMatch],
    queryFn: async () => {
      const { data } = await supabase
        .from('concierge_escalations')
        .select('id, status')
        .eq('conversation_id', selectedMatch!);
      return data || [];
    },
    enabled: !!selectedMatch && !!user?.id,
    refetchInterval: 5000,
  });
  const escalationStatusById = new Map(escalations.map(e => [e.id, e.status]));

  // Latest fast-track request status for the conversation → chip on the
  // confirmation message.
  const { data: fastTrackStatus } = useQuery({
    queryKey: ['fast-track-status', selectedMatch],
    queryFn: async () => {
      const { data } = await supabase
        .from('fast_track_requests')
        .select('status')
        .eq('conversation_id', selectedMatch!)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      return data?.status ?? null;
    },
    enabled: !!selectedMatch && !!user?.id,
    refetchInterval: 15000,
  });
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

  // Seed the "asking about" property from the caller (e.g. MatchesView "Chat").
  useEffect(() => {
    if (isOpen) {
      setActivePropertyIds(initialPropertyId ? [initialPropertyId] : []);
    }
  }, [initialPropertyId, isOpen]);
  const handleSendMessage = async (text?: string) => {
    // Guard: when used directly as onClick, `text` is the click event.
    const content = (typeof text === 'string' ? text : inputMessage).trim();
    if (!content) return;
    if (selectedMatch) {
      const currentConv = conversations.find(c => c.id === selectedMatch);
      if (currentConv) {
        const receiverId = user?.id === currentConv.realtor_id ? currentConv.renter_id : currentConv.realtor_id;
        const isRenterSending = user?.id === currentConv.renter_id;

        sendDirectMessage({
          conversationId: selectedMatch,
          content,
          receiverId,
          // Renter messages get an AI-first concierge reply server-side.
          triggerConcierge: isRenterSending,
          ...(isRenterSending && activePropertyIds.length > 0 ? {
            metadata: {
              property_id: activePropertyIds[0],
              ...(activePropertyIds.length > 1 ? { property_ids: activePropertyIds } : {}),
            },
          } : {}),
        });

        if (isRenterSending) {
          setIsAwaitingConcierge(true);
          if (conciergeTimeoutRef.current) clearTimeout(conciergeTimeoutRef.current);
          conciergeTimeoutRef.current = setTimeout(() => setIsAwaitingConcierge(false), 30000);
        }
      }
    }
    // Don't wipe a typed draft when a starter chip sent its own text.
    if (typeof text !== 'string') setInputMessage('');
  };

  // Clear the typing indicator once a reply (AI or human) lands.
  useEffect(() => {
    if (!isAwaitingConcierge || directMessages.length === 0) return;
    const currentConv = conversations.find(c => c.id === selectedMatch);
    const lastMessage = directMessages[directMessages.length - 1];
    if (currentConv && lastMessage.sender_id !== currentConv.renter_id) {
      setIsAwaitingConcierge(false);
      if (conciergeTimeoutRef.current) clearTimeout(conciergeTimeoutRef.current);
    }
  }, [directMessages, isAwaitingConcierge, conversations, selectedMatch]);
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

  // "Get contact" chip under AI messages: the AI replies in-thread with the
  // owner/realtor contact for the property being asked about (the free
  // alternative to Fast-Track — the renter reaches out themselves). The
  // property comes from the AI message's metadata.property_id, falling back
  // to the renter's currently selected "Ask about this" property.
  const handleGetContact = async (propertyId?: string) => {
    if (!selectedMatch || !user?.id || isSharingContact) return;
    const currentConv = conversations.find(c => c.id === selectedMatch);
    if (!currentConv) return;

    const receiverId = user.id === currentConv.realtor_id ? currentConv.renter_id : currentConv.realtor_id;
    const targetId = propertyId ?? activePropertyIds[0] ?? undefined;
    const props = currentConv.properties || [];
    // Without a specific property in context, only answer when the thread has
    // exactly one property — otherwise ask the renter to pick one.
    const property = targetId
      ? props.find(p => p.property_id === targetId)
      : props.length === 1 ? props[0] : undefined;

    let content: string;
    if (!property) {
      content = `Which property would you like the contact for? Tap "Ask about this" on a listing above and I'll share its owner/realtor contact.`;
    } else if (property.property_source_provider_phone || property.property_source_provider_name) {
      const lines = [`📞 Here is the contact for "${property.title}":`, ''];
      if (property.property_source_provider_name) lines.push(`Contact: ${property.property_source_provider_name}`);
      lines.push(property.property_source_provider_phone ? `Phone: ${property.property_source_provider_phone}` : 'Phone: not listed');
      lines.push('', `Feel free to reach out directly, or keep chatting here and I'll help with anything else.`);
      content = lines.join('\n');
    } else {
      content = `I don't have a direct owner/realtor contact on file for "${property.title}" yet. Use "Fast-Track viewing" and Hausto will coordinate with the listing provider for you, or ask me anything else about this home.`;
    }

    setIsSharingContact(true);
    try {
      const { error } = await supabase.from('direct_messages').insert({
        conversation_id: selectedMatch,
        sender_id: user.id,
        receiver_id: receiverId,
        content,
        metadata: { type: 'ai-answer', is_ai: true }
      });
      if (error) throw error;
      await refetchMessages();
    } catch (error) {
      console.error('Error sharing contact:', error);
      toast({
        title: 'Error',
        description: 'Could not fetch the contact. Please try again.',
        variant: 'destructive'
      });
    } finally {
      setIsSharingContact(false);
    }
  };

  // "Schedule viewing" chip under AI messages: anyone with an allowance left -
  // premium, the $20 Unlimited Viewings add-on, or an unspent free trial - goes
  // straight to the Fast-Track modal; everyone else gets the subscription pitch.
  const handleScheduleViewingChip = () => {
    if (quota?.canBook) {
      setIsViewingScheduleModalOpen(true);
    } else {
      window.dispatchEvent(new CustomEvent('openSubscriptionModal'));
    }
  };

  const handleViewingScheduleSubmit = async (scheduleData: ViewingScheduleData) => {
    if (!selectedMatch || !user?.id) return;

    try {
      const currentConv = conversations.find(c => c.id === selectedMatch);
      if (!currentConv) return;

      const receiverId = user?.id === currentConv.realtor_id ? currentConv.renter_id : currentConv.realtor_id;

      // Insert the fast_track_requests row and send notification emails
      await submitFastTrack({
        conversationId: selectedMatch,
        realtorId: currentConv.realtor_id,
        scheduleData,
        properties: (currentConv.properties || []).map(p => ({
          id: p.property_id,
          title: p.title || 'Untitled Property',
          location: p.location,
          price: p.price,
          imageUrl: p.images?.[0] || '',
        })),
      });

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

  // Open the full property detail modal for a matched listing (internal first,
  // then external). Used by the Matched Properties list rows.
  const openPropertyDetail = async (propertyId: string) => {
    const currentConv = conversations.find(c => c.id === selectedMatch);
    if (!currentConv) return;
    try {
      // Try internal properties first
      const { data: fullProperty, error } = await supabase
        .from('properties')
        .select(PROPERTY_PUBLIC_COLUMNS)
        .eq('id', propertyId)
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
        // Keep the property list open underneath — closing the detail card
        // drops the renter back into the list to keep browsing.
        return;
      }

      // Try external properties
      const { data: extProperty, error: extError } = await supabase
        .from('external_properties')
        .select('id, title, location, price, size, vibe, description, highlights, images, vibe_analysis, source_url, is_active')
        .eq('id', propertyId)
        .maybeSingle();

      if (extError) throw extError;

      // Contact info requires an existing match — fetch via RPC.
      const { data: extContacts } = extProperty
        ? await supabase.rpc('get_external_property_contacts', { _property_ids: [extProperty.id] })
        : { data: null } as any;
      const extContact = (extContacts as any[] | null)?.[0];

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
          property_source_provider_name: extContact?.contact_name ?? null,
          property_source_provider_phone: extContact?.contact_phone ?? null,
          realtor: {
            id: currentConv.realtor_id,
            name: currentConv.realtor_name || 'Hausto Agent',
            phone: '',
            email: ''
          },
          matchId: currentConv.id
        });
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
  };

  const getPlaceholder = () => {
    return 'Type your message...';
  };
  const convs = conversations;
  
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="w-full max-w-4xl h-[85vh] sm:h-[90vh] max-h-[85vh] sm:max-h-[90vh] p-0 flex flex-col bg-transparent overflow-hidden sm:rounded-2xl border-none shadow-2xl">
        {/* Glass Background */}
        <div className="absolute inset-0 glass-card bg-white/40 backdrop-blur-xl pointer-events-none -z-20" />
        
        {/* Animated Background Blobs - Toned Down */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none -z-10">
          <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] rounded-full bg-gradient-to-tr from-orange-400/10 to-pink-500/10 blur-3xl animate-blob-float-1" />
          <div className="absolute bottom-[-10%] right-[-10%] w-[60%] h-[60%] rounded-full bg-gradient-to-bl from-purple-400/10 to-pink-400/10 blur-3xl animate-blob-float-2" />
        </div>

        <DialogTitle className="sr-only">Hausto Chat Assistant</DialogTitle>
        <DialogDescription className="sr-only">
          Chat with Hausto AI assistant for property recommendations and real estate help
        </DialogDescription>
        


        

        <div className="flex-1 flex flex-col overflow-hidden relative z-10">
          {/* Realtor notification: unresolved renter questions live in the chat,
              not on the dashboard - the banner opens the reply dialog */}
          {userType === 'realtor' && pendingQuestionCount > 0 && (
            <button
              className="flex items-center gap-2 mx-3 mt-3 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-sm hover:bg-amber-100 transition-colors text-left"
              onClick={() => setShowQuestionsDialog(true)}
            >
              <MessageCircleQuestion className="w-4 h-4 flex-shrink-0" />
              <span className="flex-1">
                You have {pendingQuestionCount} unresolved renter question{pendingQuestionCount === 1 ? '' : 's'}
              </span>
              <span className="text-xs font-medium underline underline-offset-2">Review & reply</span>
            </button>
          )}
          {!selectedMatch && !isStartingNewChat ? <div className="flex-1 flex flex-col overflow-hidden">
              <div className="p-3 md:p-4 border-b border-white/30 bg-white/40 backdrop-blur-sm flex items-center flex-shrink-0 shadow-sm pr-12">
                <div className="flex items-center gap-2 sm:gap-3">
                  <h2 className="text-lg md:text-xl font-semibold bg-gradient-to-r from-orange-600 to-pink-600 bg-clip-text text-transparent drop-shadow-sm">Hausto Chat</h2>
                  <div className="h-4 w-px bg-white/40 hidden sm:block"></div>
                  <p className="text-xs sm:text-sm font-medium text-gray-600 bg-white/50 px-2.5 py-0.5 rounded-full border border-white/40 shadow-sm whitespace-nowrap">
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
                    const convQuestions = questionInfo.byConversation.get(conv.id) || 0;
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
                            {convQuestions > 0 && (
                              <Badge className="bg-amber-100 text-amber-800 border border-amber-200 text-[10px] h-5 gap-1 px-1.5">
                                <MessageCircleQuestion className="w-3 h-3" />
                                {convQuestions} question{convQuestions === 1 ? '' : 's'}
                              </Badge>
                            )}
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
              <div className="p-2 pr-12 sm:p-4 sm:pr-14 border-b border-white/30 bg-white/40 backdrop-blur-md flex-shrink-0 shadow-sm">
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
                    {/* Renters pick properties via the "Asking about" chip; realtors
                        still need this link to see the matched listings */}
                    {userType === 'realtor' && (
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
                    )}
                  </div>
                  </div>
                  {/* Renter quick actions — sits where the old AI badge lived */}
                  {userType === 'renter' && (
                    <div className="flex items-center gap-1.5 shrink-0">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={handleScheduleViewingChip}
                        className="h-8 text-xs rounded-full px-3 sm:px-4 bg-orange-50/80 hover:bg-orange-100 text-orange-700 border-orange-200 hover:border-orange-300 font-medium shadow-sm transition-colors"
                        title={quota?.trialAvailable
                          ? 'Your first viewing is on us - Hausto books it for you'
                          : 'Skip the back-and-forth — Hausto books the viewings for you'}
                      >
                        <span className="sm:hidden">⚡ Fast-Track</span>
                        <span className="hidden sm:inline">⚡ Fast-Track viewing</span>
                      </Button>
                    </div>
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
                      <p className="text-sm text-gray-400 mt-1">
                        {userType === 'renter' ? 'Ask anything — Hausto AI answers instantly' : 'Send a message to connect'}
                      </p>
                    </div>
                  </div> : <div className="space-y-4">
                    {directMessages.map(message => {
                      const isOwnMessage = message.sender_id === user?.id;
                      // AI identity lives in metadata: is_ai on new concierge rows,
                      // ai-* types on legacy rows. Never label AI rows with a human name.
                      const isAIMessage = message.metadata?.is_ai === true ||
                        (typeof message.metadata?.type === 'string' && message.metadata.type.startsWith('ai-'));
                      const isUserAction = message.metadata?.type === 'user-action';
                      const escalationStatus = message.metadata?.type === 'ai-escalation-notice' && message.metadata?.escalation_id
                        ? escalationStatusById.get(message.metadata.escalation_id as string)
                        : undefined;
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
                                                  .select(PROPERTY_PUBLIC_COLUMNS)
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
                                <div className="flex items-center gap-2 mt-2">
                                  <span className="text-xs text-gray-400">
                                    {new Date(message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                  </span>
                                  {escalationStatus === 'pending' && (
                                    <Badge className="bg-amber-100 text-amber-800 border border-amber-200 text-[10px]">
                                      Passed to our team
                                    </Badge>
                                  )}
                                  {escalationStatus === 'answered' && (
                                    <Badge className="bg-green-100 text-green-800 border border-green-200 text-[10px]">
                                      Answered by our team
                                    </Badge>
                                  )}
                                  {message.metadata?.scheduleData && fastTrackStatus && (
                                    <Badge className="bg-blue-100 text-blue-800 border border-blue-200 text-[10px] capitalize">
                                      Viewing request: {String(fastTrackStatus).replace('_', ' ')}
                                    </Badge>
                                  )}
                                </div>
                              </div>
                            </div>

                            {/* Fast-Track nudge from the concierge AI */}
                            {message.metadata?.suggest_fast_track && userType === 'renter' && (
                              <div className="flex justify-center gap-2 mt-2">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={handleScheduleViewingChip}
                                  className="text-xs glass bg-white/70 hover:bg-white border-purple-200/50 hover:border-purple-300 text-purple-700 rounded-full shadow-sm hover:shadow-md transition-all duration-300 relative z-10"
                                >
                                  ⚡ Fast-Track a viewing
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => handleGetContact(message.metadata?.property_id)}
                                  disabled={isSharingContact}
                                  className="text-xs glass bg-white/70 hover:bg-white border-blue-200/50 hover:border-blue-300 text-blue-700 rounded-full shadow-sm hover:shadow-md transition-all duration-300 relative z-10"
                                >
                                  {isSharingContact ? 'Getting contact…' : '📞 Get contact'}
                                </Button>
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
                              <p className="text-xs sm:text-sm whitespace-pre-wrap leading-relaxed">{renderWithLinks(message.content, isOwnMessage)}</p>
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
                 {isAwaitingConcierge && (
                   <div className="flex justify-center my-4">
                     <div className="glass bg-white/70 border border-purple-200/50 rounded-full px-4 py-2 flex items-center gap-2 shadow-sm">
                       <div className="w-1.5 h-1.5 bg-purple-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                       <div className="w-1.5 h-1.5 bg-purple-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                       <div className="w-1.5 h-1.5 bg-purple-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                       <span className="text-xs text-purple-700 font-medium ml-1">Hausto AI is typing…</span>
                     </div>
                   </div>
                 )}
                 <div ref={messagesEndRef} />
               </div>

              <div className="p-3 sm:p-4 border-t border-white/30 bg-white/40 backdrop-blur-md flex-shrink-0 relative z-10 space-y-2">
                {/* "Asking about" context chip — always shown; tap it to pick
                    which matched property questions are about */}
                {userType === 'renter' && (() => {
                  const currentConv = conversations.find(c => c.id === selectedMatch);
                  const activeProps = (currentConv?.properties || [])
                    .filter(p => activePropertyIds.includes(p.property_id));
                  const chipLabel = activeProps.length === 0
                    ? 'Asking about: tap to pick properties'
                    : activeProps.length === 1
                      ? `Asking about: ${activeProps[0].title || 'this property'}`
                      : `Asking about: ${activeProps.length} properties`;
                  return (
                    <div className="flex items-center">
                      <Badge
                        variant="secondary"
                        role="button"
                        tabIndex={0}
                        onClick={() => setShowPropertyList(true)}
                        onKeyDown={e => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            setShowPropertyList(true);
                          }
                        }}
                        className="h-7 text-[11px] max-w-[280px] flex items-center gap-1 rounded-full px-3 cursor-pointer hover:bg-secondary/80 transition-colors"
                        title="Choose which matched property you're asking about"
                      >
                        <span className="truncate">{chipLabel}</span>
                        {activeProps.length > 0 ? (
                          <button
                            aria-label="Clear property context"
                            onClick={e => {
                              e.stopPropagation();
                              setActivePropertyIds([]);
                            }}
                            className="shrink-0"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        ) : (
                          <ChevronRight className="w-3 h-3 shrink-0" />
                        )}
                      </Badge>
                    </div>
                  );
                })()}
                {/* Starter questions — single tidy row, scrolls horizontally on
                    narrow screens instead of wrapping */}
                {userType === 'renter' && !loadingDirectMessages && (
                  <div className="flex gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    {([
                      // Answered instantly from the listing data, not via the AI round-trip
                      { label: "📞 Get the owner's contact", action: () => handleGetContact() },
                      { label: 'Is this property still available?' },
                      { label: "What's the pet policy?" },
                      { label: 'Can I visit this weekend?' },
                      { label: 'Is the price negotiable?' },
                    ] as { label: string; action?: () => void }[]).map(({ label, action }) => (
                      <Button
                        key={label}
                        size="sm"
                        variant="outline"
                        disabled={isSendingDirectMessage || (action ? isSharingContact : false)}
                        onClick={() => (action ? action() : handleSendMessage(label))}
                        className="shrink-0 text-xs h-7 px-3 rounded-full glass bg-white/70 hover:bg-white border-purple-200/50 hover:border-purple-300 text-purple-700 font-normal shadow-sm"
                      >
                        {label}
                      </Button>
                    ))}
                  </div>
                )}
                <div className="flex space-x-2 relative">
                  <div className="absolute inset-0 bg-gradient-to-r from-orange-500/10 to-pink-500/10 rounded-xl blur-md -z-10" />
                  <Input value={inputMessage} onChange={e => setInputMessage(e.target.value)} placeholder="Type your message..." onKeyPress={handleKeyPress} disabled={isSendingDirectMessage} className="flex-1 text-sm md:text-base glass bg-white/70 border-white/50 rounded-xl focus-visible:ring-orange-400" />
                  <Button onClick={() => handleSendMessage()} disabled={!inputMessage.trim() || isSendingDirectMessage} className="bg-gradient-to-r from-orange-500 to-pink-500 hover:from-orange-600 hover:to-pink-600 flex-shrink-0 rounded-xl shadow-md hover:shadow-lg transition-all duration-300 transform hover:-translate-y-0.5 w-10 h-10 p-0 flex items-center justify-center">
                    <Send className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </div>)}
        </div>

        {/* Property detail: the editorial card (platform's current listing design) in a frameless dialog */}
        <Dialog open={!!detailModalApartment} onOpenChange={o => !o && setDetailModalApartment(null)}>
          <DialogContent className="max-w-[420px] w-[92vw] p-0 bg-transparent border-none shadow-none [&>button]:hidden">
            <DialogTitle className="sr-only">{detailModalApartment?.title || 'Property details'}</DialogTitle>
            <DialogDescription className="sr-only">Property listing details</DialogDescription>
            {detailModalApartment && (
              <EditorialPropertyCard
                apartment={{
                  id: detailModalApartment.id,
                  images: detailModalApartment.images,
                  title: detailModalApartment.title,
                  location: detailModalApartment.location,
                  price: detailModalApartment.price,
                  size: detailModalApartment.size,
                  rooms: detailModalApartment.rooms,
                  vibe: detailModalApartment.vibe,
                  description: detailModalApartment.description,
                  highlights: detailModalApartment.highlights,
                  amenities: detailModalApartment.amenities,
                  vibe_analysis: detailModalApartment.vibe_analysis,
                  latitude: detailModalApartment.latitude,
                  longitude: detailModalApartment.longitude,
                }}
                onClose={() => setDetailModalApartment(null)}
              />
            )}
          </DialogContent>
        </Dialog>

        {showQuestionsDialog && <RenterQuestionsDialog open={showQuestionsDialog} onOpenChange={setShowQuestionsDialog} />}

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
          <DialogContent className="max-w-md rounded-2xl p-0 gap-0 overflow-hidden">
            <div className="px-6 pt-6 pb-4 border-b border-border/60">
              <DialogTitle className="font-serif text-2xl font-normal tracking-tight">
                Matched properties
              </DialogTitle>
              <DialogDescription className="text-sm text-muted-foreground mt-1.5">
                {userType === 'renter'
                  ? 'Tap a listing for details · tick to ask about it'
                  : 'Tap a listing to view details'}
              </DialogDescription>
            </div>
            <div className="px-3 py-3 space-y-1 max-h-[440px] overflow-y-auto">
              {(() => {
                const currentConv = conversations.find(c => c.id === selectedMatch);
                return currentConv?.properties?.map((prop) => {
                  const isSelected = activePropertyIds.includes(prop.property_id);
                  return (
                    <div
                      key={prop.property_id}
                      role="button"
                      tabIndex={0}
                      onClick={() => openPropertyDetail(prop.property_id)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          openPropertyDetail(prop.property_id);
                        }
                      }}
                      className={`group w-full flex items-center gap-3.5 rounded-xl p-2.5 text-left cursor-pointer transition-all duration-200 ${
                        isSelected
                          ? 'bg-primary/[0.06] ring-1 ring-primary/30'
                          : 'hover:bg-accent/40'
                      }`}
                    >
                      {prop.images?.[0] ? (
                        <img loading="lazy"
                          src={prop.images[0]}
                          alt={prop.title || 'Property'}
                          className="w-[88px] h-16 object-cover rounded-lg shrink-0 shadow-sm"
                          onError={e => {
                            const target = e.target as HTMLImageElement;
                            target.onerror = null;
                            target.src = '/placeholder-property.jpg';
                          }}
                        />
                      ) : (
                        <div className="w-[88px] h-16 rounded-lg bg-muted shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium leading-snug line-clamp-1 text-foreground">
                          {prop.title || 'Untitled Property'}
                        </p>
                        <p className="text-xs text-muted-foreground line-clamp-1 flex items-center gap-1 mt-0.5">
                          <MapPin className="w-3 h-3 shrink-0" />
                          {prop.location}
                        </p>
                        <p className="text-sm mt-1">
                          <span className="font-semibold">{formatPrice(Number(prop.price || 0))}</span>
                          <span className="text-xs text-muted-foreground"> /mo</span>
                        </p>
                      </div>
                      {userType === 'renter' ? (
                        <button
                          aria-label={isSelected ? 'Stop asking about this property' : 'Ask about this property'}
                          aria-pressed={isSelected}
                          className={`w-6 h-6 mr-1 rounded-full border-[1.5px] shrink-0 flex items-center justify-center transition-all duration-200 ${
                            isSelected
                              ? 'bg-primary border-primary text-primary-foreground scale-105'
                              : 'border-muted-foreground/30 text-transparent hover:border-primary/70 group-hover:border-muted-foreground/50'
                          }`}
                          onClick={e => {
                            e.stopPropagation();
                            setActivePropertyIds(ids =>
                              ids.includes(prop.property_id)
                                ? ids.filter(id => id !== prop.property_id)
                                : [...ids, prop.property_id]
                            );
                          }}
                        >
                          <Check className="w-3.5 h-3.5" />
                        </button>
                      ) : (
                        <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                      )}
                    </div>
                  );
                });
              })()}
            </div>
          </DialogContent>
        </Dialog>

      </DialogContent>
    </Dialog>
  );
};