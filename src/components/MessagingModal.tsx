
import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { X, Send, User, MapPin } from 'lucide-react';
import { Match, Apartment } from '@/types';
import { PropertyDetailModal } from '@/components/PropertyDetailModal';
import { ScrollArea } from '@/components/ui/scroll-area';

interface MessagingModalProps {
  matches: Match[];
  selectedMatch: Match | null;
  onClose: () => void;
}

interface Message {
  id: string;
  sender: 'realtor' | 'renter';
  text: string;
  timestamp: Date;
}

export const MessagingModal = ({ matches, selectedMatch, onClose }: MessagingModalProps) => {
  const [activeMatch, setActiveMatch] = useState<Match | null>(selectedMatch);
  const [message, setMessage] = useState('');
  const [detailModalApartment, setDetailModalApartment] = useState<Apartment | null>(null);
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      sender: 'renter',
      text: 'Hi! I\'m very interested in your property. Could we schedule a viewing?',
      timestamp: new Date(Date.now() - 3600000)
    }
  ]);

  const sendMessage = () => {
    if (!message.trim()) return;

    const newMessage: Message = {
      id: Date.now().toString(),
      sender: 'realtor',
      text: message,
      timestamp: new Date()
    };

    setMessages(prev => [...prev, newMessage]);
    setMessage('');
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-5xl h-[80vh] bg-white flex">
        {/* Matches Sidebar */}
        <div className="w-1/3 border-r flex flex-col">
          <div className="p-4 border-b">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-gray-900">Matches</h3>
              <Button variant="ghost" size="sm" onClick={onClose}>
                <X className="w-4 h-4" />
              </Button>
            </div>
            <p className="text-sm text-gray-600">{matches.length} interested renters</p>
          </div>
          
          <ScrollArea className="flex-1">
            {matches.length === 0 ? (
              <div className="p-4 text-center text-gray-500">
                <User className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">No matches yet</p>
              </div>
            ) : (
              <div className="space-y-1">
                {matches.map((match) => (
                  <div
                    key={match.id}
                    onClick={() => setActiveMatch(match)}
                    className={`p-3 cursor-pointer hover:bg-gray-50 transition-colors ${
                      activeMatch?.id === match.id ? 'bg-blue-50 border-r-2 border-blue-500' : ''
                    }`}
                  >
                     <div className="flex items-center space-x-3">
                       <div className="w-10 h-10 bg-gradient-to-r from-primary to-secondary rounded-full flex items-center justify-center">
                         <User className="w-5 h-5 text-white" />
                       </div>
                       <div className="flex-1 min-w-0">
                         <p className="font-medium text-sm text-gray-900 truncate">Interested Renter</p>
                            <button 
                              onClick={() => {
                                setDetailModalApartment(match.apartment);
                              }}
                              className="text-xs text-blue-600 hover:text-blue-800 hover:underline truncate block text-left"
                            >
                              {match.apartment.title}
                            </button>
                         <div className="flex items-center mt-1">
                           <MapPin className="w-3 h-3 text-gray-400 mr-1" />
                           <span className="text-xs text-gray-500">{match.apartment.location}</span>
                         </div>
                       </div>
                     </div>
                    <div className="mt-2">
                      <Badge variant="secondary" className="text-xs">
                        ${match.apartment.price}/mo
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </div>

        {/* Chat Area */}
        <div className="flex-1 flex flex-col">
          {activeMatch ? (
            <>
              {/* Chat Header */}
              <div className="p-4 border-b bg-gray-50">
                <div className="flex items-center space-x-3">
                  <div className="w-10 h-10 bg-gradient-to-r from-primary to-secondary rounded-full flex items-center justify-center">
                    <User className="w-5 h-5 text-white" />
                  </div>
                   <div>
                     <h4 className="font-semibold text-gray-900">Interested Renter</h4>
                      <button 
                        onClick={() => {
                          setDetailModalApartment(activeMatch.apartment);
                        }}
                        className="text-sm text-blue-600 hover:text-blue-800 hover:underline text-left"
                      >
                        {activeMatch.apartment.title}
                      </button>
                   </div>
                </div>
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`flex ${msg.sender === 'realtor' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-xs lg:max-w-md px-4 py-2 rounded-lg ${
                        msg.sender === 'realtor'
                          ? 'bg-gradient-to-r from-primary to-secondary text-white'
                          : 'bg-gray-100 text-gray-900'
                      }`}
                    >
                      <p className="text-sm">{msg.text}</p>
                      <p className={`text-xs mt-1 ${
                        msg.sender === 'realtor' ? 'text-white/70' : 'text-gray-500'
                      }`}>
                        {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                  </div>
                ))}
              </div>

              {/* Message Input */}
              <div className="p-4 border-t">
                <div className="flex space-x-2">
                  <Input
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder="Type your message..."
                    onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
                    className="flex-1"
                  />
                  <Button 
                    onClick={sendMessage}
                    className="bg-gradient-to-r from-primary to-secondary hover:shadow-lg"
                  >
                    <Send className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-gray-500">
              <div className="text-center">
                <User className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>Select a match to start messaging</p>
              </div>
            </div>
          )}
        </div>
      </Card>
      
      {detailModalApartment && (
        <PropertyDetailModal
          apartment={detailModalApartment}
          isOpen={!!detailModalApartment}
          onClose={() => setDetailModalApartment(null)}
        />
      )}
    </div>
  );
};
