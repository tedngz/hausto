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

import { useAuth } from '@/hooks/useAuth';
import { useCurrency } from '@/contexts/CurrencyContext';
import { PropertyDetailModal } from '@/components/PropertyDetailModal';
import { RealtorProfileModal } from '@/components/RealtorProfileModal';
import { RenterProfileModal } from '@/components/RenterProfileModal';
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
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const aiTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const {
    formatPrice
  } = useCurrency();
  const {
    user
  } = useAuth();
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
    messagesEndRef.current?.scrollIntoView({
      behavior: 'smooth'
    });
  };
  useEffect(() => {
    scrollToBottom();
  }, [directMessages]);

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
  const handleSendMessage = () => {
    if (!inputMessage.trim()) return;
    if (selectedMatch) {
      const currentConv = conversations.find(c => c.id === selectedMatch);
      if (currentConv) {
        const receiverId = user?.id === currentConv.realtor_id ? currentConv.renter_id : currentConv.realtor_id;
        sendDirectMessage({
          conversationId: selectedMatch,
          content: inputMessage.trim(),
          receiverId
        });
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

  // AI auto-exit after 5 minutes
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

  // Reset AI timer only when AI sends a message
  useEffect(() => {
    if (isAIActive && directMessages.length > 0) {
      const lastMessage = directMessages[directMessages.length - 1];
      const isAIMessage = lastMessage?.metadata && 
        (lastMessage.metadata.type === 'ai-greeting' || 
         lastMessage.metadata.type === 'ai-suggestion');
      
      if (isAIMessage) {
        setAiLastActiveTime(Date.now());
      }
    }
  }, [directMessages.length, isAIActive, directMessages]);

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

      const { data, error } = await supabase.functions.invoke('hausto-ai-assist', {
        body: {
          conversationId: selectedMatch,
          userType,
          messages: recentMessages,
          properties: currentConv.properties
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
    
    setIsRequestingAI(true);
    setAiLastActiveTime(Date.now()); // Reset timer
    
    try {
      const currentConv = conversations.find(c => c.id === selectedMatch);
      if (!currentConv) return;

      const receiverId = user?.id === currentConv.realtor_id ? currentConv.renter_id : currentConv.realtor_id;

      // Get action label
      const actionLabels: Record<string, string> = {
        schedule_viewing: 'Schedule Viewing',
        discuss_price: 'Discuss Price',
        ask_amenities: 'Ask About Amenities',
        request_documents: 'Request Documents'
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

      const { data, error } = await supabase.functions.invoke('hausto-ai-assist', {
        body: {
          conversationId: selectedMatch,
          userType,
          messages: recentMessages,
          properties: currentConv.properties,
          action
        }
      });

      if (error) throw error;

      // Send AI follow-up
      await supabase.from('direct_messages').insert({
        conversation_id: selectedMatch,
        sender_id: user?.id,
        receiver_id: receiverId,
        content: data.suggestion,
        metadata: { type: 'ai-suggestion' }
      });

      await refetchMessages();
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
  const getPlaceholder = () => {
    return 'Type your message...';
  };
  const convs = conversations;
  return <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="w-full max-w-4xl h-[85vh] sm:h-[90vh] max-h-[85vh] sm:max-h-[90vh] p-0 flex flex-col bg-white overflow-hidden sm:rounded-lg">
        <DialogTitle className="sr-only">Hausto Chat Assistant</DialogTitle>
        <DialogDescription className="sr-only">
          Chat with Hausto AI assistant for property recommendations and real estate help
        </DialogDescription>
        <div className="p-3 md:p-4 border-b bg-gradient-to-r from-orange-50 to-pink-50 flex-shrink-0">
          <h2 className="text-lg md:text-xl font-semibold bg-gradient-to-r from-orange-600 to-pink-600 bg-clip-text text-transparent">Hausto Chat</h2>
          
        </div>

        

        <div className="flex-1 flex flex-col overflow-hidden">
          {showPropertyList ? (
            /* Property List View */
            <div className="flex-1 flex flex-col overflow-hidden">
              <div className="p-4 border-b bg-gradient-to-r from-orange-50 to-pink-50 flex-shrink-0">
                <div className="flex items-center space-x-3">
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    onClick={() => setShowPropertyList(false)} 
                    className="hover:bg-white/50 p-1" 
                    aria-label="Back to conversation"
                  >
                    <ArrowLeft className="w-4 h-4" />
                  </Button>
                  <h3 className="font-semibold text-gray-900">Matched Properties</h3>
                </div>
              </div>

              <ScrollArea className="flex-1 p-4">
                <div className="space-y-3">
                  {(() => {
                    const currentConv = conversations.find(c => c.id === selectedMatch);
                    return currentConv?.properties?.map((prop, index) => (
                      <button
                        key={prop.property_id}
                        onClick={async () => {
                          try {
                            const { data: fullProperty, error } = await supabase
                              .from('properties')
                              .select('*')
                              .eq('id', prop.property_id)
                              .single();

                            if (error) throw error;

                            if (fullProperty) {
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
                            }
                          } catch (error) {
                            console.error('Error fetching property details:', error);
                            toast({
                              title: 'Error',
                              description: 'Failed to load property details',
                              variant: 'destructive'
                            });
                          }
                        }}
                        className="w-full text-left p-4 rounded-lg hover:bg-gray-50 transition-colors border border-gray-200 hover:border-orange-200"
                      >
                        <div className="flex items-start gap-3">
                          <span className="font-semibold text-orange-600 mt-1 flex-shrink-0 text-lg">{index + 1}.</span>
                          <div className="flex-1 min-w-0 space-y-2">
                            <p className="font-medium text-base break-words">{prop.title}</p>
                            <div className="flex items-center gap-1">
                              <MapPin className="w-3 h-3 text-gray-400 flex-shrink-0" />
                              <p className="text-sm text-gray-600 break-words">{prop.location}</p>
                            </div>
                            <Badge variant="secondary" className="text-sm bg-orange-100 text-orange-800">
                              {formatPrice(Number(prop.price || 0))}/mo
                            </Badge>
                          </div>
                        </div>
                      </button>
                    ));
                  })()}
                </div>
              </ScrollArea>
            </div>
          ) : !selectedMatch && !isStartingNewChat ? <div className="flex-1 flex flex-col overflow-hidden">
              <div className="p-3 border-b bg-gray-50 flex items-center justify-between">
                <div>
                  
                  <p className="text-sm text-gray-600">
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
                        className="p-3 sm:p-4 cursor-pointer hover:bg-gray-50 transition-colors rounded-lg border border-gray-200 hover:border-orange-200"
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
        <div className="flex-1 flex flex-col overflow-hidden">
              <div className="p-2 sm:p-4 border-b bg-gradient-to-r from-orange-50 to-pink-50 flex-shrink-0">
                <div className="flex items-center justify-between w-full gap-2">
                  <div className="flex items-center space-x-2 sm:space-x-3">
                    <Button variant="ghost" size="sm" onClick={() => setSelectedMatch(null)} className="hover:bg-white/50 p-1" aria-label="Back to conversations">
                      <ArrowLeft className="w-3 h-3 sm:w-4 sm:h-4" />
                    </Button>
                    <Avatar className="w-8 h-8 sm:w-10 sm:h-10 flex-shrink-0">
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
                      className="text-xs sm:text-sm text-blue-600 hover:text-blue-800 hover:underline text-left"
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
                      className="bg-gradient-to-r from-purple-50 to-pink-50 border-purple-200 hover:border-purple-300 text-purple-700 text-[10px] sm:text-xs"
                    >
                      <MessageCircle className="w-3 h-3 sm:mr-1" />
                      <span className="hidden sm:inline">{isRequestingAI ? 'Calling AI...' : 'Ask Hausto AI'}</span>
                      <span className="sm:hidden">{isRequestingAI ? 'AI...' : 'AI'}</span>
                    </Button>
                  ) : (
                    <Badge className="bg-gradient-to-r from-purple-500 to-pink-500 text-white border-0 text-[8px] sm:text-xs px-1.5 py-0.5 sm:px-2 sm:py-1">
                      AI Active
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
                      const isAIMessage = message.metadata?.type === 'ai-greeting' || message.metadata?.type === 'ai-suggestion' || message.metadata?.type === 'ai-exit';
                      const isUserAction = message.metadata?.type === 'user-action';
                      const currentConv = conversations.find(c => c.id === selectedMatch);
                      const isRealtor = userType === 'realtor';
                      const senderName = isAIMessage ? 'Hausto AI' : (isOwnMessage ? 'You' : (isRealtor ? (currentConv?.renter_name || 'Renter') : (currentConv?.realtor_name || 'Property Owner')));
                      
                      // Hide user action messages
                      if (isUserAction) return null;
                      
                      if (isAIMessage) {
                        return (
                          <div key={message.id}>
                            <div className="flex justify-center my-4">
                              <div className="max-w-[85%] bg-gradient-to-r from-purple-50 to-pink-50 border border-purple-200 rounded-lg p-3 shadow-sm">
                                <div className="flex items-center gap-2 mb-2">
                                  <div className="w-7 h-7 rounded-full bg-gradient-to-r from-purple-500 to-pink-500 flex items-center justify-center flex-shrink-0">
                                    <MessageCircle className="w-4 h-4 text-white" />
                                  </div>
                                  <span className="text-xs font-semibold text-purple-700">Hausto AI Assistant</span>
                                </div>
                                <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{message.content}</p>
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
                                    schedule_viewing: '📅 Schedule Viewing',
                                    discuss_price: '💰 Discuss Price',
                                    ask_amenities: '🏠 Ask About Amenities',
                                    request_documents: '📄 Request Documents'
                                  };
                                  return (
                                    <Button
                                      key={action}
                                      size="sm"
                                      variant="outline"
                                      onClick={() => handleAIAction(action)}
                                      disabled={isRequestingAI}
                                      className="text-xs bg-white hover:bg-purple-50 border-purple-300 text-purple-700"
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
                            <div className={`w-full px-3 py-2 sm:px-4 sm:py-2.5 rounded-lg break-words ${isOwnMessage ? 'bg-gradient-to-r from-orange-500 to-pink-500 text-white' : 'bg-gray-100 text-gray-900'}`}>
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

              <div className="p-4 border-t border-gray-200 flex-shrink-0">
                <div className="flex space-x-2">
                  <Input value={inputMessage} onChange={e => setInputMessage(e.target.value)} placeholder="Type your message..." onKeyPress={handleKeyPress} disabled={isSendingDirectMessage} className="flex-1 text-sm md:text-base" />
                  <Button onClick={handleSendMessage} disabled={!inputMessage.trim() || isSendingDirectMessage} className="bg-gradient-to-r from-orange-500 to-pink-500 hover:from-orange-600 hover:to-pink-600 flex-shrink-0" size="sm">
                    <Send className="w-3 md:w-4 h-3 md:h-4" />
                  </Button>
                </div>
              </div>
            </div>)}
        </div>

        {detailModalApartment && <PropertyDetailModal apartment={detailModalApartment} userPreferences={userPreferences} isOpen={!!detailModalApartment} onClose={() => setDetailModalApartment(null)} />}

        {selectedRealtorId && <RealtorProfileModal realtorId={selectedRealtorId} isOpen={!!selectedRealtorId} onClose={() => setSelectedRealtorId(null)} />}

        {selectedRenterId && <RenterProfileModal userId={selectedRenterId} isOpen={!!selectedRenterId} onClose={() => setSelectedRenterId(null)} />}
      </DialogContent>
    </Dialog>
};