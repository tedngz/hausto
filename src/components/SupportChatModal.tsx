import { useState, useEffect, useRef } from 'react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { X, Send, Bot, ArrowLeft, History, Plus, Trash2 } from 'lucide-react';
import { useSupportChat } from '@/hooks/useSupportChat';
import { useAuth } from '@/hooks/useAuth';

interface SupportChatModalProps {
  isOpen: boolean;
  onClose: () => void;
  userType: 'renter' | 'realtor';
}

export const SupportChatModal = ({ isOpen, onClose, userType }: SupportChatModalProps) => {
  const [inputMessage, setInputMessage] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const [pendingMessage, setPendingMessage] = useState<string>('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  
  const { user } = useAuth();
  
  const {
    conversations,
    messages,
    currentConversationId,
    setCurrentConversationId,
    createConversation,
    sendMessage,
    deleteConversation,
    isSendingMessage,
    isCreatingConversation,
    isDeletingConversation,
  } = useSupportChat();

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    if (isOpen && !currentConversationId && conversations.length === 0) {
      createConversation('General Support');
    }
  }, [isOpen, currentConversationId, conversations.length]);

  useEffect(() => {
    if (currentConversationId && pendingMessage) {
      sendMessage({
        message: pendingMessage,
        conversationId: currentConversationId,
        userType,
      });
      setPendingMessage('');
    }
  }, [currentConversationId, pendingMessage]);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSendMessage = () => {
    if (!inputMessage.trim()) return;
    
    if (currentConversationId) {
      sendMessage({
        message: inputMessage.trim(),
        conversationId: currentConversationId,
        userType,
      });
    } else {
      setPendingMessage(inputMessage.trim());
      createConversation('General Support');
    }
    
    setInputMessage('');
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const getWelcomeMessage = () => {
    if (userType === 'realtor') {
      return "Hi! I'm Hausto AI, your general assistant. I can help with platform questions, account issues, best practices, and general support.";
    }
    return "Hi! I'm Hausto AI, your general assistant. I can help with platform questions, account issues, renting tips, and general support.";
  };

  const getSuggestions = () => {
    if (userType === 'realtor') {
      return [
        "How do I optimize my property listings?",
        "What are the best practices for photos?",
        "How does the matching system work?",
        "Help with subscription management"
      ];
    }
    return [
      "How do I update my preferences?",
      "What should I know about renting?",
      "How does the matching system work?",
      "Help with my account settings"
    ];
  };

  const handleCreateNewChat = () => {
    createConversation('New Support Chat');
    setShowHistory(false);
  };

  const handleDeleteConversation = (conversationId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    deleteConversation(conversationId);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="w-full max-w-4xl h-[90vh] max-h-[90vh] p-0 flex flex-col bg-white overflow-hidden sm:rounded-lg">
        <DialogTitle className="sr-only">Hausto Support Assistant</DialogTitle>
        <DialogDescription className="sr-only">
          Chat with Hausto AI assistant for general support and platform help
        </DialogDescription>
        
        {/* Header */}
        <div className="p-3 md:p-4 border-b bg-gradient-to-r from-orange-50 to-pink-50 flex-shrink-0">
          <div className="flex items-center justify-between">
            <h2 className="text-lg md:text-xl font-semibold bg-gradient-to-r from-orange-600 to-pink-600 bg-clip-text text-transparent">
              Hausto Support
            </h2>
            <div className="flex gap-2">
              <Button
                onClick={() => setShowHistory(!showHistory)}
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0 hover:bg-white/50"
              >
                <History className="h-4 w-4" />
              </Button>
              <Button
                onClick={handleCreateNewChat}
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0 hover:bg-white/50"
              >
                <Plus className="h-4 w-4" />
              </Button>
              <Button
                onClick={onClose}
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0 hover:bg-white/50"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>

        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Chat History Dropdown */}
          {showHistory && (
            <div className="border-b bg-gray-50 p-4 max-h-60 overflow-y-auto">
              <h3 className="font-semibold text-gray-900 mb-3">Chat History</h3>
              <div className="space-y-2">
                {conversations.map((conversation) => (
                  <div
                    key={conversation.id}
                    className={`p-3 rounded-lg cursor-pointer transition-colors flex items-center justify-between ${
                      conversation.id === currentConversationId 
                        ? 'bg-orange-100 border border-orange-200' 
                        : 'hover:bg-gray-100 border border-gray-200'
                    }`}
                    onClick={() => {
                      setCurrentConversationId(conversation.id);
                      setShowHistory(false);
                    }}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{conversation.title}</p>
                      <p className="text-xs text-gray-500">
                        {new Date(conversation.created_at).toLocaleDateString()}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0 text-gray-400 hover:text-red-600"
                      onClick={(e) => handleDeleteConversation(conversation.id, e)}
                      disabled={isDeletingConversation}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Chat Interface */}
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="p-4 border-b bg-gradient-to-r from-orange-50 to-pink-50 flex-shrink-0">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 bg-gradient-to-r from-orange-500 to-pink-500 rounded-full flex items-center justify-center text-white font-semibold">
                  <Bot className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="font-semibold text-gray-900">
                    Hausto AI Assistant
                  </h4>
                  <p className="text-sm text-green-600">Always online to help</p>
                </div>
              </div>
            </div>

            <ScrollArea className="flex-1">
              <div className="p-2 md:p-4 space-y-3 md:space-y-4">
                {messages.length === 0 && (
                  <div className="text-center text-gray-500 py-4 md:py-8">
                    <Bot className="w-8 md:w-12 h-8 md:h-12 mx-auto mb-2 md:mb-4 opacity-50" />
                    <p className="text-base md:text-lg font-medium mb-1 md:mb-2">{getWelcomeMessage()}</p>
                    <p className="text-xs md:text-sm">How can I help you today?</p>
                    
                    {/* Quick Chat Suggestions */}
                    <div className="mt-6 space-y-2">
                      <p className="text-sm font-medium text-gray-700">Common questions:</p>
                      <div className="flex flex-col gap-2">
                        {getSuggestions().map((suggestion, index) => (
                          <Button 
                            key={index}
                            variant="outline" 
                            size="sm" 
                            onClick={() => setInputMessage(suggestion)}
                            className="text-xs"
                          >
                            {suggestion}
                          </Button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
                {messages.map((message) => (
                  <div key={message.id} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'} animate-fade-in`}>
                    <div className={`max-w-[85%] md:max-w-xs lg:max-w-md px-3 md:px-4 py-2 rounded-lg break-words ${
                      message.role === 'user'
                        ? 'bg-gradient-to-r from-orange-500 to-pink-500 text-white'
                        : 'bg-gray-100 text-gray-900'
                    }`}>
                      <p className="text-xs md:text-sm whitespace-pre-wrap">{message.content}</p>
                      <p className={`text-xs mt-1 ${
                        message.role === 'user' ? 'text-white/70' : 'text-gray-500'
                      }`}>
                        {new Date(message.created_at).toLocaleTimeString([], { 
                          hour: '2-digit', 
                          minute: '2-digit' 
                        })}
                      </p>
                    </div>
                  </div>
                ))}
                {isSendingMessage && (
                  <div className="flex justify-start animate-fade-in">
                    <div className="max-w-[85%] md:max-w-xs lg:max-w-md px-3 md:px-4 py-2 rounded-lg bg-gray-100 text-gray-900">
                      <div className="flex items-center space-x-2">
                        <div className="flex space-x-1">
                          <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></div>
                          <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{animationDelay: '0.1s'}}></div>
                          <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{animationDelay: '0.2s'}}></div>
                        </div>
                        <span className="text-xs text-gray-500">AI is thinking...</span>
                      </div>
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>
            </ScrollArea>

            <div className="p-4 border-t bg-white flex-shrink-0">
              <div className="flex space-x-2">
                <Input
                  value={inputMessage}
                  onChange={(e) => setInputMessage(e.target.value)}
                  onKeyPress={handleKeyPress}
                  placeholder="Ask me anything about the platform..."
                  className="flex-1"
                  disabled={isSendingMessage || isCreatingConversation}
                />
                <Button 
                  onClick={handleSendMessage}
                  disabled={!inputMessage.trim() || isSendingMessage || isCreatingConversation}
                  className="bg-gradient-to-r from-orange-500 to-pink-500 hover:from-orange-600 hover:to-pink-600"
                >
                  <Send className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};