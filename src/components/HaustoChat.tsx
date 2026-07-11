import { useState, useEffect, useRef } from 'react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { X, Send, MessageCircle, MapPin, ArrowLeft, Check, ChevronRight } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useDirectMessages } from '@/hooks/useDirectMessages';
import { useFastTrackRequest } from '@/hooks/useFastTrackRequest';
import { useViewingQuota } from '@/hooks/useViewingQuota';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';

import { useAuth } from '@/hooks/useAuth';
import { useCurrency } from '@/contexts/CurrencyContext';
import { useSubscription } from '@/hooks/useSubscription';
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
  // Which matched listing the renter is currently asking about. Tags outgoing
  // messages with metadata.property_id so the concierge AI (and the realtor)
  // know which of the pair's matched properties the question refers to.
  const [activePropertyId, setActivePropertyId] = useState<string | null>(null);
  const [isRequestingHuman, setIsRequestingHuman] = useState(false);
  const [isSharingContact, setIsSharingContact] = useState(false);
  // Shows "Hausto AI is typing…" between a renter send and the concierge reply.
  const [isAwaitingConcierge, setIsAwaitingConcierge] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const conciergeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const {
    formatPrice
  } = useCurrency();
  const {
    user
  } = useAuth();
  const { subscription_tier } = useSubscription();
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
      setActivePropertyId(initialPropertyId ?? null);
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
          ...(isRenterSending && activePropertyId ? { metadata: { property_id: activePropertyId } } : {}),
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

  // Explicit human hand-off: creates an escalation server-side (the renter's
  // choice, not the AI's) so the team gets notified and the queue picks it up.
  const handleRequestHuman = async () => {
    if (!selectedMatch || isRequestingHuman) return;
    setIsRequestingHuman(true);
    try {
      const { data, error } = await supabase.functions.invoke('concierge-reply', {
        body: { conversationId: selectedMatch, forceEscalate: true },
      });
      if (error || data?.error) throw new Error(data?.error || error?.message);
      await refetchMessages();
    } catch (err) {
      console.error('Error requesting human support:', err);
      toast({
        title: 'Could not reach our team',
        description: 'Please try again in a moment.',
        variant: 'destructive',
      });
    } finally {
      setIsRequestingHuman(false);
    }
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
    const targetId = propertyId ?? activePropertyId ?? undefined;
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
      content = `I don't have a direct owner/realtor contact on file for "${property.title}" yet. Use "Schedule a viewing" and Hausto will coordinate with the listing provider for you, or ask me anything else about this home.`;
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

  // "Schedule viewing" chip under AI messages: premium renters and holders of
  // the $20 Unlimited Viewings add-on go straight to the Fast-Track modal;
  // everyone else gets the subscription pitch.
  const handleScheduleViewingChip = () => {
    if (subscription_tier === 'premium' || quota?.unlimited) {
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
        .select('*')
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
        setShowPropertyList(false);
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
                  {/* Renter quick actions — sits where the old AI badge lived */}
                  {userType === 'renter' && (
                    <div className="flex items-center gap-1.5 shrink-0">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={handleScheduleViewingChip}
                        className="h-8 text-xs rounded-full px-2.5 sm:px-3"
                        title="Hausto books the viewings for you"
                      >
                        <span className="sm:hidden">📅</span>
                        <span className="hidden sm:inline">📅 Schedule viewing</span>
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={handleRequestHuman}
                        disabled={isRequestingHuman}
                        className="h-8 text-xs rounded-full px-2.5 sm:px-3"
                        title="Ask a real person from the Hausto team to step in"
                      >
                        <span className="sm:hidden">🙋</span>
                        <span className="hidden sm:inline">{isRequestingHuman ? 'Contacting…' : '🙋 Talk to a human'}</span>
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
                      {userType === 'renter' && !loadingDirectMessages && (
                        <div className="flex flex-wrap justify-center gap-2 mt-4 max-w-md mx-auto">
                          {[
                            'Is this property still available?',
                            "What's the pet policy?",
                            'Can I visit this weekend?',
                            'Is the price negotiable?',
                          ].map(q => (
                            <Button
                              key={q}
                              size="sm"
                              variant="outline"
                              disabled={isSendingDirectMessage}
                              onClick={() => handleSendMessage(q)}
                              className="text-xs h-auto py-1.5 px-3 rounded-full glass bg-white/70 hover:bg-white border-purple-200/50 hover:border-purple-300 text-purple-700 shadow-sm"
                            >
                              {q}
                            </Button>
                          ))}
                        </div>
                      )}
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
                                  📅 Schedule a viewing
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
                {/* "Asking about" context chip — set from the property list */}
                {userType === 'renter' && (() => {
                  const currentConv = conversations.find(c => c.id === selectedMatch);
                  const activeProp = activePropertyId
                    ? currentConv?.properties?.find(p => p.property_id === activePropertyId)
                    : undefined;
                  if (!activeProp) return null;
                  return (
                    <div className="flex items-center">
                      <Badge variant="secondary" className="text-[11px] max-w-[260px] flex items-center gap-1 rounded-full">
                        <span className="truncate">Asking about: {activeProp.title || 'this property'}</span>
                        <button aria-label="Clear property context" onClick={() => setActivePropertyId(null)} className="shrink-0">
                          <X className="w-3 h-3" />
                        </button>
                      </Badge>
                    </div>
                  );
                })()}
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

        {/* Property detail: the editorial card (platform's current listing design) in a frameless dialog */}
        <Dialog open={!!detailModalApartment} onOpenChange={o => !o && setDetailModalApartment(null)}>
          <DialogContent className="max-w-[420px] w-[92vw] p-0 bg-transparent border-none shadow-none [&>button]:bg-black/40 [&>button]:text-white [&>button]:rounded-full [&>button]:opacity-100 [&>button]:z-20">
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
              />
            )}
          </DialogContent>
        </Dialog>

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
          <DialogContent className="max-w-md">
            <DialogTitle className="font-serif text-2xl font-normal">
              Matched properties
            </DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground">
              {userType === 'renter'
                ? 'Tap a listing for details · use the pill to pick which one to ask about'
                : 'Tap a listing to view details'}
            </DialogDescription>
            <div className="space-y-2 mt-3 max-h-[420px] overflow-y-auto pr-0.5">
              {(() => {
                const currentConv = conversations.find(c => c.id === selectedMatch);
                return currentConv?.properties?.map((prop) => {
                  const isSelected = activePropertyId === prop.property_id;
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
                      className={`w-full flex items-center gap-3 rounded-xl border p-2 text-left cursor-pointer transition-colors hover:bg-accent/50 ${
                        isSelected ? 'border-primary/60 bg-primary/5' : 'border-border'
                      }`}
                    >
                      {prop.images?.[0] ? (
                        <img
                          src={prop.images[0]}
                          alt={prop.title || 'Property'}
                          className="w-20 h-14 object-cover rounded-lg shrink-0"
                          onError={e => {
                            const target = e.target as HTMLImageElement;
                            target.onerror = null;
                            target.src = '/placeholder-property.jpg';
                          }}
                        />
                      ) : (
                        <div className="w-20 h-14 rounded-lg bg-muted shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium leading-snug line-clamp-1">
                          {prop.title || 'Untitled Property'}
                        </p>
                        <p className="text-xs text-muted-foreground line-clamp-1 flex items-center gap-1">
                          <MapPin className="w-3 h-3 shrink-0" />
                          {prop.location}
                        </p>
                        <p className="text-sm font-semibold mt-0.5">
                          {formatPrice(Number(prop.price || 0))}
                          <span className="text-xs font-normal text-muted-foreground">/mo</span>
                        </p>
                      </div>
                      {userType === 'renter' ? (
                        <Button
                          size="sm"
                          variant={isSelected ? 'default' : 'outline'}
                          className="h-7 text-xs rounded-full shrink-0"
                          onClick={e => {
                            e.stopPropagation();
                            setActivePropertyId(prop.property_id);
                            setShowPropertyList(false);
                          }}
                        >
                          {isSelected ? (
                            <><Check className="w-3 h-3 mr-1" />Asking</>
                          ) : (
                            'Ask about this'
                          )}
                        </Button>
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