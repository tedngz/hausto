import { useState, useEffect, useRef } from 'react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { X, Send, MessageCircle, MapPin, ArrowLeft } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useDirectMessages } from '@/hooks/useDirectMessages';
import { useMatches } from '@/hooks/useMatches';
import { useAuth } from '@/hooks/useAuth';
import { useCurrency } from '@/contexts/CurrencyContext';
import { PropertyDetailModal } from '@/components/PropertyDetailModal';
import { RealtorProfileModal } from '@/components/RealtorProfileModal';
import { RenterProfileModal } from '@/components/RenterProfileModal';
import { Apartment } from '@/types';

interface AIChatAgentProps {
  isOpen: boolean;
  onClose: () => void;
  userPreferences?: any;
  userType: 'renter' | 'realtor';
  propertyImages?: string[];
  initialMatchId?: string | null;
}

export const AIChatAgent = ({ 
  isOpen, 
  onClose, 
  userPreferences, 
  userType,
  propertyImages = [],
  initialMatchId = null
}: AIChatAgentProps) => {
  const [inputMessage, setInputMessage] = useState('');
  const [activeTab, setActiveTab] = useState<'messages'>('messages');
  const [selectedMatch, setSelectedMatch] = useState<string | null>(null);
  const [pendingMessage, setPendingMessage] = useState<string>('');
  const [detailModalApartment, setDetailModalApartment] = useState<Apartment | null>(null);
  const [selectedRealtorId, setSelectedRealtorId] = useState<string | null>(null);
  const [selectedRenterId, setSelectedRenterId] = useState<string | null>(null);
  const [isStartingNewChat, setIsStartingNewChat] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  
  const { formatPrice } = useCurrency();
  const { user } = useAuth();
  
  const {
    sendMessage: sendDirectMessage,
    isSendingMessage: isSendingDirectMessage,
    messages: directMessages,
    setCurrentMatchId,
    loadingMessages: loadingDirectMessages,
    markAsRead,
  } = useDirectMessages();
  const { realtorMatches, renterMatches } = useMatches();

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };



  useEffect(() => {
    scrollToBottom();
  }, [directMessages]);

  // Sync selected match with direct messages hook
  useEffect(() => {
    setCurrentMatchId(selectedMatch ?? null);
  }, [selectedMatch, setCurrentMatchId]);

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
      const matches = userType === 'renter' ? renterMatches : realtorMatches;
      const match = matches.find(m => m.id === selectedMatch);
      if (match) {
        const receiverId = user?.id === match.realtor_id ? match.renter_id : match.realtor_id;
        sendDirectMessage({
          matchId: selectedMatch,
          content: inputMessage.trim(),
          receiverId,
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

  const getPlaceholder = () => {
    return 'Type your message...';
  };


  const matches = userType === 'renter' ? renterMatches : realtorMatches;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="w-full max-w-4xl h-[90vh] max-h-[90vh] p-0 flex flex-col bg-white overflow-hidden sm:rounded-lg">
        <DialogTitle className="sr-only">Hausto Chat Assistant</DialogTitle>
        <DialogDescription className="sr-only">
          Chat with Hausto AI assistant for property recommendations and real estate help
        </DialogDescription>
        <div className="p-3 md:p-4 border-b bg-gradient-to-r from-orange-50 to-pink-50 flex-shrink-0">
          <h2 className="text-lg md:text-xl font-semibold bg-gradient-to-r from-orange-600 to-pink-600 bg-clip-text text-transparent">Hausto Chat</h2>
        </div>

        <div className="flex-1 flex flex-col overflow-hidden">
          {!selectedMatch && !isStartingNewChat ? (
            <div className="flex-1 flex flex-col overflow-hidden">
              <div className="p-3 border-b bg-gray-50 flex items-center justify-between">
                <div>
                  <h3 className="font-semibold text-gray-900">Your Conversations</h3>
                  <p className="text-sm text-gray-600">
                    {matches.length} conversation{matches.length !== 1 ? 's' : ''}
                  </p>
                </div>
                <Button 
                  onClick={handleStartNewChat}
                  variant="outline" 
                  size="sm"
                  className="text-orange-600 border-orange-200 hover:bg-orange-50"
                >
                  New Chat
                </Button>
              </div>
              
              <ScrollArea className="flex-1 p-3">
                <div className="space-y-3">
                  
                  {/* User conversations */}
                  {matches.map((match) => {
                    const isRealtor = userType === 'realtor';
                    const otherUserName = isRealtor ? match.renter_name : match.realtor_name;
                    const otherUserId = isRealtor ? match.renter_id : match.realtor_id;
                    
                    return (
                      <div
                        key={match.id}
                        onClick={() => handleMatchSelect(match.id)}
                        className="p-4 cursor-pointer hover:bg-gray-50 transition-colors rounded-lg border border-gray-200 hover:border-orange-200"
                      >
                        <div className="flex items-start space-x-3">
                          <Avatar className="w-12 h-12 flex-shrink-0">
                            <AvatarImage src={isRealtor ? match.renter_avatar : match.realtor_avatar} />
                            <AvatarFallback className="bg-gradient-to-r from-blue-500 to-purple-500 text-white font-semibold">
                              {isRealtor ? 'R' : 'P'}
                            </AvatarFallback>
                          </Avatar>
                          <div className="flex-1 min-w-0">
                            <p 
                              className="font-medium text-gray-900 mb-1 hover:text-orange-600 cursor-pointer"
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
                            <p className="text-sm text-gray-600 truncate mb-2">{match.properties?.title}</p>
                            <div className="flex items-center mb-2">
                              <MapPin className="w-3 h-3 text-gray-400 mr-1" />
                              <span className="text-xs text-gray-500 truncate">{match.properties?.location}</span>
                            </div>
                            <div className="flex items-center justify-between">
                              <Badge variant="secondary" className="text-xs bg-orange-100 text-orange-800">
                                {formatPrice(match.properties?.price || 0)}/mo
                              </Badge>
                              <span className="text-xs text-gray-400">
                                {new Date(match.created_at).toLocaleDateString()}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </ScrollArea>
            </div>
          ) : (
            /* User Messages Interface */
            <div className="flex-1 flex flex-col overflow-hidden">
              <div className="p-4 border-b bg-gradient-to-r from-orange-50 to-pink-50 flex-shrink-0">
                <div className="flex items-center space-x-3">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelectedMatch(null)}
                    className="hover:bg-white/50 p-1"
                  >
                    <ArrowLeft className="w-4 h-4" />
                  </Button>
                  <div className="w-10 h-10 bg-gradient-to-r from-blue-500 to-purple-500 rounded-full flex items-center justify-center text-white font-semibold">
                    {userType === 'realtor' ? 'R' : 'P'}
                  </div>
                  <div>
                    {(() => {
                      const currentMatch = matches.find(m => m.id === selectedMatch);
                      const isRealtor = userType === 'realtor';
                      const otherUserName = isRealtor ? currentMatch?.renter_name : currentMatch?.realtor_name;
                      const otherUserId = isRealtor ? currentMatch?.renter_id : currentMatch?.realtor_id;
                      
                      return (
                        <>
                          <h4 
                            className="font-semibold text-gray-900 hover:text-orange-600 cursor-pointer"
                            onClick={() => {
                              if (isRealtor) {
                                setSelectedRenterId(otherUserId);
                              } else {
                                setSelectedRealtorId(otherUserId);
                              }
                            }}
                          >
                            {otherUserName || (isRealtor ? 'Interested Renter' : 'Property Owner')}
                          </h4>
                        </>
                      );
                    })()}
                    <button
                      onClick={() => {
                        const currentMatch = matches.find(m => m.id === selectedMatch);
                        if (currentMatch) {
                          // Transform match data exactly like in MatchesView for consistent vibe scoring
                          const rawVA = currentMatch.properties?.vibe_analysis;
                          let parsedVA = rawVA;
                          if (rawVA && typeof rawVA === 'string') {
                            try { parsedVA = JSON.parse(rawVA); } catch { parsedVA = null; }
                          }
                          setDetailModalApartment({
                            id: currentMatch.properties.id,
                            images: currentMatch.properties.images || [],
                            title: currentMatch.properties.title,
                            location: currentMatch.properties.location,
                            price: Number(currentMatch.properties.price),
                            size: currentMatch.properties.size || '',
                            vibe: currentMatch.properties.vibe || '',
                            description: currentMatch.properties.description || '',
                            highlights: currentMatch.properties.highlights || [],
                            vibe_analysis: parsedVA,
                            realtor: {
                              id: currentMatch.properties.realtor_id || '',
                              name: currentMatch.realtor_name || 'Property Owner',
                              phone: '+1-234-567-8900',
                              email: 'contact@realtor.com'
                            },
                            matchId: currentMatch.id
                          });
                        }
                      }}
                      className="text-sm text-blue-600 hover:text-blue-800 hover:underline text-left"
                    >
                      {matches.find(m => m.id === selectedMatch)?.properties?.title}
                    </button>
                  </div>
                </div>
              </div>

              <div className="flex-1 p-4 overflow-y-auto" style={{ maxHeight: 'calc(90vh - 200px)' }}>
                {directMessages.length === 0 ? (
                  <div className="flex items-center justify-center h-full text-gray-500">
                    <div className="text-center">
                      <MessageCircle className="w-12 h-12 mx-auto mb-4 opacity-50" />
                      <p className="text-base">Start the conversation!</p>
                      <p className="text-sm text-gray-400 mt-1">Send a message to connect</p>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {directMessages.map((message) => {
                      const isOwnMessage = message.sender_id === user?.id;
                      const currentMatch = matches.find(m => m.id === selectedMatch);
                      const isRealtor = userType === 'realtor';
                      const senderName = isOwnMessage 
                        ? 'You' 
                        : (isRealtor ? (currentMatch?.renter_name || 'Renter') : (currentMatch?.realtor_name || 'Property Owner'));
                      
                      return (
                        <div
                          key={message.id}
                          className={`flex ${isOwnMessage ? 'justify-end' : 'justify-start'}`}
                        >
                          <div className={`flex flex-col ${isOwnMessage ? 'items-end' : 'items-start'}`}>
                            <p className="text-xs text-gray-500 mb-1 px-1">
                              {senderName}
                            </p>
                            <div
                              className={`max-w-[85%] md:max-w-xs lg:max-w-md px-4 py-2 rounded-lg break-words ${
                                isOwnMessage
                                  ? 'bg-gradient-to-r from-orange-500 to-pink-500 text-white'
                                  : 'bg-gray-100 text-gray-900'
                              }`}
                            >
                              <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                              <p className={`text-xs mt-1 ${
                                isOwnMessage ? 'text-white/70' : 'text-gray-500'
                              }`}>
                                {new Date(message.created_at).toLocaleTimeString([], { 
                                  hour: '2-digit', 
                                  minute: '2-digit' 
                                })}
                              </p>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>

              <div className="p-4 border-t border-gray-200 flex-shrink-0">
                <div className="flex space-x-2">
                  <Input
                    value={inputMessage}
                    onChange={(e) => setInputMessage(e.target.value)}
                    placeholder="Type your message..."
                    onKeyPress={handleKeyPress}
                    disabled={isSendingDirectMessage}
                    className="flex-1 text-sm md:text-base"
                  />
                  <Button 
                    onClick={handleSendMessage}
                    disabled={!inputMessage.trim() || isSendingDirectMessage}
                    className="bg-gradient-to-r from-orange-500 to-pink-500 hover:from-orange-600 hover:to-pink-600 flex-shrink-0"
                    size="sm"
                  >
                    <Send className="w-3 md:w-4 h-3 md:h-4" />
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>

        {detailModalApartment && (
          <PropertyDetailModal
            apartment={detailModalApartment}
            userPreferences={userPreferences}
            isOpen={!!detailModalApartment}
            onClose={() => setDetailModalApartment(null)}
          />
        )}

        {selectedRealtorId && (
          <RealtorProfileModal
            realtorId={selectedRealtorId}
            isOpen={!!selectedRealtorId}
            onClose={() => setSelectedRealtorId(null)}
          />
        )}

        {selectedRenterId && (
          <RenterProfileModal
            userId={selectedRenterId}
            isOpen={!!selectedRenterId}
            onClose={() => setSelectedRenterId(null)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
};