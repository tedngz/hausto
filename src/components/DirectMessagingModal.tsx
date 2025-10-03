import { useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { X, Send, User, MapPin, Trash2, MessageCircle } from 'lucide-react';
import { useDirectMessages } from '@/hooks/useDirectMessages';
import { useAuth } from '@/hooks/useAuth';
import { Apartment } from '@/types';
import { PropertyDetailModal } from '@/components/PropertyDetailModal';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { RenterProfileModal } from '@/components/RenterProfileModal';
import { RealtorProfileModal } from '@/components/RealtorProfileModal';
import { supabase } from '@/integrations/supabase/client';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

interface DirectMessagingModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialMatchId?: string;
}

export const DirectMessagingModal = ({ isOpen, onClose, initialMatchId }: DirectMessagingModalProps) => {
  const { user } = useAuth();
  const [detailModalApartment, setDetailModalApartment] = useState<Apartment | null>(null);
  const [selectedRenterId, setSelectedRenterId] = useState<string | null>(null);
  const [selectedRealtorId, setSelectedRealtorId] = useState<string | null>(null);
  const {
    conversations,
    messages,
    currentConversationId,
    setCurrentConversationId,
    sendMessage,
    isSendingMessage,
    deleteConversation,
    markAsRead,
    loadingConversations,
    loadingMessages,
    getOrCreateConversation,
  } = useDirectMessages();

  const [messageText, setMessageText] = useState('');

  useEffect(() => {
    console.log('DirectMessagingModal useEffect - initialMatchId:', initialMatchId, 'isOpen:', isOpen, 'conversations.length:', conversations.length, 'currentConversationId:', currentConversationId);
    
    const resolveConversation = async () => {
      if (!isOpen) return;

      if (initialMatchId) {
        // If a conversation already exists with this ID, use it
        const existingConv = conversations.find(c => c.id === initialMatchId);
        if (existingConv) {
          setCurrentConversationId(existingConv.id);
          return;
        }
        // Otherwise, treat initialMatchId as a property_match id and resolve renter/realtor pair
        const { data: match } = await supabase
          .from('property_matches')
          .select('renter_id,realtor_id')
          .eq('id', initialMatchId)
          .maybeSingle();
        if (match?.renter_id && match?.realtor_id) {
          const convId = await getOrCreateConversation(match.renter_id, match.realtor_id);
          setCurrentConversationId(convId);
          return;
        }
      }
      // Fallback: auto-select first conversation
      if (conversations.length > 0 && !currentConversationId) {
        setCurrentConversationId(conversations[0].id);
      }
    };

    resolveConversation();
  }, [initialMatchId, isOpen, conversations, currentConversationId, setCurrentConversationId, getOrCreateConversation]);

  useEffect(() => {
    if (currentConversationId && messages.length > 0) {
      markAsRead(currentConversationId);
    }
  }, [currentConversationId, messages.length, markAsRead]);

  const currentConversation = conversations.find(conv => conv.id === currentConversationId);
  const isUserRealtor = user?.id === currentConversation?.realtor_id;

  const handleSendMessage = () => {
    if (!messageText.trim() || !currentConversationId || !currentConversation) return;

    const receiverId = user?.id === currentConversation.realtor_id 
      ? currentConversation.renter_id 
      : currentConversation.realtor_id;

    sendMessage({
      conversationId: currentConversationId,
      content: messageText.trim(),
      receiverId
    });

    setMessageText('');
  };

  const handleDeleteConversation = () => {
    if (currentConversationId) {
      deleteConversation(currentConversationId);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-2 sm:p-4">
      <Card className="w-full max-w-6xl h-[95vh] sm:h-[85vh] bg-white flex flex-col overflow-hidden animate-fade-in animate-scale-in">
        {/* Header */}
        <div className="p-4 border-b bg-gradient-to-r from-purple-50 to-pink-50 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Messages</h2>
            <p className="text-sm text-gray-600">
              {conversations.length} conversation{conversations.length !== 1 ? 's' : ''}
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="h-8 w-8 p-0 rounded-full hover:bg-gray-100"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>

        <div className="flex-1 flex overflow-hidden">
          {/* Conversations List */}
          <div className="w-full sm:w-80 border-r flex flex-col sm:flex-none">
            <ScrollArea className="flex-1">
              {loadingConversations ? (
                <div className="p-4 text-center">
                  <div className="animate-spin w-6 h-6 border-2 border-purple-500 border-t-transparent rounded-full mx-auto mb-2"></div>
                  <p className="text-sm text-gray-500">Loading...</p>
                </div>
              ) : conversations.length === 0 ? (
                <div className="p-4 text-center text-gray-500">
                  <MessageCircle className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">No conversations yet</p>
                </div>
              ) : (
                <div className="p-2">
                  {conversations.map((conversation) => {
                    const properties = conversation.properties || [];
                    const property = properties[0]; // Show first property in conversation
                    const isSelected = currentConversationId === conversation.id;
                    const isRealtor = user?.id === conversation.realtor_id;
                    
                    return (
                      <div
                        key={conversation.id}
                        onClick={() => setCurrentConversationId(conversation.id)}
                        className={`p-3 cursor-pointer hover:bg-gray-50 transition-colors rounded-lg mb-2 ${
                          isSelected ? 'bg-purple-50 border border-purple-200' : 'border border-transparent'
                        }`}
                      >
                        <div className="flex items-center space-x-3">
                          <Avatar className="w-10 h-10">
                            <AvatarFallback className="bg-gradient-to-r from-purple-500 to-pink-500 text-white text-sm">
                              {isRealtor ? 'R' : 'O'}
                            </AvatarFallback>
                           </Avatar>
                            <div className="flex-1 min-w-0">
                              <button 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (isRealtor) {
                                    setSelectedRenterId(conversation.renter_id);
                                  } else {
                                    setSelectedRealtorId(conversation.realtor_id);
                                  }
                                }}
                                className="font-medium text-sm text-gray-900 truncate hover:text-blue-600 hover:underline text-left block"
                              >
                                {isRealtor ? conversation.renter_name || 'Interested Renter' : conversation.realtor_name || 'Property Owner'}
                              </button>
                               <button 
                                 onClick={() => {
                                   if (property) {
                                     const apartment = {
                                       id: property.property_id,
                                       images: property.images || [],
                                       title: property.title,
                                       location: property.location,
                                       price: Number(property.price),
                                       size: '',
                                       vibe: '',
                                       description: '',
                                       highlights: [],
                                       realtor: {
                                         id: conversation.realtor_id,
                                         name: 'Licensed Realtor',
                                         phone: '+1-234-567-8900',
                                         email: 'contact@realtor.com'
                                       }
                                     };
                                     setDetailModalApartment(apartment);
                                   }
                                 }}
                                 className="text-xs text-blue-600 hover:text-blue-800 hover:underline line-clamp-2 block text-left"
                               >
                                 {property?.title}
                               </button>
                             {conversation.last_message_preview && (
                               <p className="text-xs text-gray-400 mt-1 truncate">
                                 {conversation.last_message_preview}
                               </p>
                             )}
                           </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </ScrollArea>
          </div>

          {/* Chat Area */}
          <div className="flex-1 flex flex-col">
            {currentConversation ? (
              <>
                {/* Chat Header */}
                <div className="p-4 border-b bg-gray-50 flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <Avatar className="w-8 h-8">
                      <AvatarFallback className="bg-gradient-to-r from-purple-500 to-pink-500 text-white text-sm">
                        {isUserRealtor ? 'R' : 'O'}
                      </AvatarFallback>
                     </Avatar>
                      <div>
                        <button 
                          onClick={() => {
                            if (isUserRealtor) {
                              setSelectedRenterId(currentConversation.renter_id);
                            } else {
                              setSelectedRealtorId(currentConversation.realtor_id);
                            }
                          }}
                          className="font-medium text-gray-900 text-sm hover:text-blue-600 hover:underline text-left block"
                        >
                          {isUserRealtor ? 
                            currentConversation.renter_name || 'Interested Renter' : 
                            currentConversation.realtor_name || 'Property Owner'
                          }
                        </button>
                            {currentConversation.properties && currentConversation.properties.length > 0 && (
                              <button 
                                onClick={() => {
                                  const property = currentConversation.properties![0];
                                  const apartment = {
                                    id: property.property_id,
                                    images: property.images || [],
                                    title: property.title,
                                    location: property.location,
                                    price: Number(property.price),
                                    size: '',
                                    vibe: '',
                                    description: '',
                                    highlights: [],
                                    realtor: {
                                      id: currentConversation.realtor_id,
                                      name: 'Licensed Realtor',
                                      phone: '+1-234-567-8900',
                                      email: 'contact@realtor.com'
                                    }
                                  };
                                  setDetailModalApartment(apartment);
                                }}
                                className="text-xs text-blue-600 hover:text-blue-800 hover:underline text-left line-clamp-1"
                              >
                                {currentConversation.properties[0].title}
                              </button>
                            )}
                     </div>
                  </div>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="ghost" size="sm" className="text-red-500 hover:text-red-600 h-8 w-8 p-0">
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete Conversation</AlertDialogTitle>
                        <AlertDialogDescription>
                          Are you sure you want to delete this conversation? This action cannot be undone.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={handleDeleteConversation} className="bg-red-600 hover:bg-red-700">
                          Delete
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>

                {/* Messages */}
                <ScrollArea className="flex-1 p-4">
                  {loadingMessages ? (
                    <div className="flex items-center justify-center h-full">
                      <div className="animate-spin w-6 h-6 border-2 border-purple-500 border-t-transparent rounded-full"></div>
                    </div>
                  ) : messages.length === 0 ? (
                    <div className="flex items-center justify-center h-full text-gray-500">
                      <div className="text-center">
                        <MessageCircle className="w-12 h-12 mx-auto mb-4 opacity-50" />
                        <p className="text-sm">Start the conversation!</p>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {messages.map((message) => {
                        const isOwnMessage = message.sender_id === user?.id;
                        const isSystemMessage = message.metadata?.type === 'system';
                        
                        if (isSystemMessage) {
                          return (
                            <div key={message.id} className="flex justify-center my-4">
                              <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-2 max-w-md text-center">
                                <p className="text-sm text-blue-800">{message.content}</p>
                                {message.metadata?.property_id && (
                                  <button
                                    onClick={() => {
                                      const property = currentConversation?.properties?.find(
                                        p => p.property_id === message.metadata?.property_id
                                      );
                                      if (property) {
                                        const apartment = {
                                          id: property.property_id,
                                          images: property.images || [],
                                          title: property.title,
                                          location: property.location,
                                          price: Number(property.price),
                                          size: '',
                                          vibe: '',
                                          description: '',
                                          highlights: [],
                                          realtor: {
                                            id: currentConversation.realtor_id,
                                            name: 'Licensed Realtor',
                                            phone: '+1-234-567-8900',
                                            email: 'contact@realtor.com'
                                          }
                                        };
                                        setDetailModalApartment(apartment);
                                      }
                                    }}
                                    className="text-xs text-blue-600 hover:text-blue-800 hover:underline mt-1 inline-block"
                                  >
                                    View property →
                                  </button>
                                )}
                                <p className="text-xs text-blue-600 mt-1">
                                  {new Date(message.created_at).toLocaleTimeString([], { 
                                    hour: '2-digit', 
                                    minute: '2-digit' 
                                  })}
                                </p>
                              </div>
                            </div>
                          );
                        }
                        
                        return (
                          <div
                            key={message.id}
                            className={`flex ${isOwnMessage ? 'justify-end' : 'justify-start'} items-end space-x-2`}
                          >
                            {!isOwnMessage && (
                              <Avatar className="w-8 h-8 mb-1">
                                <AvatarFallback className="bg-gradient-to-r from-purple-500 to-pink-500 text-white text-xs">
                                  {isUserRealtor ? 'R' : 'O'}
                                </AvatarFallback>
                              </Avatar>
                            )}
                            <div
                              className={`max-w-xs px-4 py-2 rounded-2xl ${
                                isOwnMessage
                                  ? 'bg-gradient-to-r from-purple-500 to-pink-500 text-white'
                                  : 'bg-gray-100 text-gray-900'
                              }`}
                            >
                              <p className="text-sm">{message.content}</p>
                              <p className={`text-xs mt-1 ${
                                isOwnMessage ? 'text-white/70' : 'text-gray-500'
                              }`}>
                                {new Date(message.created_at).toLocaleTimeString([], { 
                                  hour: '2-digit', 
                                  minute: '2-digit' 
                                })}
                              </p>
                            </div>
                            {isOwnMessage && (
                              <Avatar className="w-8 h-8 mb-1">
                                <AvatarFallback className="bg-gradient-to-r from-purple-500 to-pink-500 text-white text-xs">
                                  You
                                </AvatarFallback>
                              </Avatar>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </ScrollArea>

                {/* Message Input */}
                <div className="p-4 border-t">
                  <div className="flex space-x-2">
                    <Input
                      value={messageText}
                      onChange={(e) => setMessageText(e.target.value)}
                      placeholder="Type your message..."
                      onKeyPress={(e) => e.key === 'Enter' && !e.shiftKey && handleSendMessage()}
                      className="flex-1 rounded-full border-gray-200 focus:border-purple-500 focus:ring-purple-500"
                      disabled={isSendingMessage}
                    />
                    <Button 
                      onClick={handleSendMessage}
                      disabled={!messageText.trim() || isSendingMessage}
                      className="bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 rounded-full h-10 w-10 p-0"
                    >
                      <Send className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center text-gray-500">
                <div className="text-center">
                  <MessageCircle className="w-12 h-12 mx-auto mb-4 opacity-50" />
                  <p>Select a conversation to start messaging</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </Card>
      
      {detailModalApartment && (
        <PropertyDetailModal
          apartment={detailModalApartment}
          isOpen={!!detailModalApartment}
          onClose={() => setDetailModalApartment(null)}
        />
      )}

      {selectedRenterId && (
        <RenterProfileModal
          userId={selectedRenterId}
          isOpen={!!selectedRenterId}
          onClose={() => setSelectedRenterId(null)}
        />
      )}

      {selectedRealtorId && (
        <RealtorProfileModal
          realtorId={selectedRealtorId}
          isOpen={!!selectedRealtorId}
          onClose={() => setSelectedRealtorId(null)}
        />
      )}
    </div>
  );
};