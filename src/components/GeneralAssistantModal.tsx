import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Loader2, Send, MessageSquare, Plus, History, ArrowRight, X } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useNavigate } from 'react-router-dom';
import { useToast } from '@/hooks/use-toast';
import { useSupportChat } from '@/hooks/useSupportChat';

interface GeneralAssistantModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const GeneralAssistantModal = ({ isOpen, onClose }: GeneralAssistantModalProps) => {
  const [query, setQuery] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const {
    conversations,
    messages,
    currentConversationId,
    setCurrentConversationId,
    createConversation,
    sendMessage,
    isCreatingConversation,
    isSendingMessage,
    loadingMessages,
    loadingConversations
  } = useSupportChat();

  // Initialize first conversation if needed
  useEffect(() => {
    if (user && isOpen && conversations.length === 0 && !currentConversationId) {
      createConversation('General Assistance');
    }
  }, [user, isOpen, conversations.length, currentConversationId, createConversation]);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSendMessage = async () => {
    if (!user) {
      toast({
        title: "Sign in required",
        description: "Please sign in to chat with the assistant",
        variant: "destructive"
      });
      navigate('/auth');
      return;
    }

    if (!query.trim()) {
      toast({
        title: "Please enter a message",
        description: "Type your question or message to get started",
        variant: "destructive"
      });
      return;
    }

    // Check if user is asking about property search
    const propertyKeywords = ['property', 'apartment', 'house', 'rent', 'rental', 'home', 'search', 'find', 'looking for'];
    const isPropertyQuery = propertyKeywords.some(keyword => 
      query.toLowerCase().includes(keyword)
    );

    if (isPropertyQuery) {
      toast({
        title: "Property Search Available",
        description: "For property searches, please use our AI Property Search in the Discover section",
        action: (
          <Button
            size="sm"
            onClick={() => {
              onClose();
              navigate('/discover');
            }}
            className="ml-2"
          >
            Go to Property Search <ArrowRight className="h-4 w-4 ml-1" />
          </Button>
        ),
      });
      return;
    }

    if (!currentConversationId) {
      createConversation('General Assistance');
      return;
    }

    try {
      sendMessage({
        message: query,
        conversationId: currentConversationId,
        userType: 'renter'
      });
      
      setQuery('');
      
      toast({
        title: "Message sent!",
        description: "Hausto AI is processing your request.",
      });
    } catch (error) {
      console.error('Send message error:', error);
      toast({
        title: "Send failed",
        description: "There was an error sending your message. Please try again.",
        variant: "destructive"
      });
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const createNewChat = () => {
    createConversation('New Chat');
    setQuery('');
    setShowHistory(false);
  };

  const switchToConversation = (conversationId: string) => {
    setCurrentConversationId(conversationId);
    setShowHistory(false);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl h-[80vh] flex flex-col">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-gradient-to-r from-orange-500 to-pink-500 flex items-center justify-center">
                <MessageSquare className="h-5 w-5 text-white" />
              </div>
              <div>
                <DialogTitle>Hausto AI Assistant</DialogTitle>
                <p className="text-sm text-muted-foreground">General questions and support</p>
              </div>
            </div>
            <div className="flex gap-2">
              {user && (
                <>
                  <Button
                    onClick={() => setShowHistory(!showHistory)}
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0"
                  >
                    <History className="h-4 w-4" />
                  </Button>
                  <Button
                    onClick={createNewChat}
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0"
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </>
              )}
              <Button
                onClick={onClose}
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </DialogHeader>

        <div className="flex-1 flex flex-col gap-4 overflow-hidden">
          {/* Chat History Dropdown */}
          {showHistory && user && (
            <Card className="border-border">
              <CardContent className="p-4">
                <div className="space-y-2 max-h-40 overflow-y-auto">
                  {loadingConversations ? (
                    <div className="flex items-center justify-center py-4">
                      <Loader2 className="h-4 w-4 animate-spin" />
                    </div>
                  ) : (
                    conversations.map((conversation) => (
                      <div
                        key={conversation.id}
                        onClick={() => switchToConversation(conversation.id)}
                        className={`p-3 rounded-lg cursor-pointer transition-colors ${
                          conversation.id === currentConversationId 
                            ? 'bg-primary/10 border border-primary/20' 
                            : 'hover:bg-secondary/50'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <MessageSquare className="h-4 w-4 text-muted-foreground" />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{conversation.title || 'Untitled Chat'}</p>
                            <p className="text-xs text-muted-foreground">
                              {new Date(conversation.created_at).toLocaleDateString()}
                            </p>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Messages */}
          <div className="flex-1 overflow-y-auto space-y-4 p-4 bg-muted/20 rounded-lg">
            {!user ? (
              <div className="text-center py-8">
                <MessageSquare className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-lg font-medium text-foreground mb-2">Welcome to Hausto AI Assistant</h3>
                <p className="text-muted-foreground mb-4">Get help with general questions, account support, and more.</p>
                <Button onClick={() => navigate('/auth')} className="mb-2">
                  Sign In to Start Chatting
                </Button>
                <p className="text-xs text-muted-foreground">
                  For property searches, use our AI Property Search in the Discover section
                </p>
              </div>
            ) : loadingMessages ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            ) : messages.length === 0 ? (
              <div className="text-center py-8">
                <MessageSquare className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-lg font-medium text-foreground mb-2">Start a conversation</h3>
                <p className="text-muted-foreground mb-4">Ask me anything about using Hausto, account questions, or general support.</p>
                <p className="text-xs text-muted-foreground">
                  For property searches, use our AI Property Search in the Discover section
                </p>
              </div>
            ) : (
              messages.map((message, index) => (
                <div key={message.id || index} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'} animate-fade-in`}>
                  <div className={`max-w-[80%] p-3 rounded-lg ${
                    message.role === 'user' 
                      ? 'bg-primary text-primary-foreground' 
                      : 'bg-background border border-border'
                  }`}>
                    <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                    <p className="text-xs opacity-70 mt-1">
                      {new Date(message.created_at).toLocaleTimeString()}
                    </p>
                  </div>
                </div>
              ))
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input Area */}
          {user && (
            <div className="space-y-3">
              <div className="flex gap-2">
                <div className="flex-1 relative">
                  <Textarea
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyPress={handleKeyPress}
                    placeholder="Ask about your account, general questions, or need support..."
                    className="min-h-[60px] pr-12 resize-none"
                    disabled={isSendingMessage}
                  />
                  <Button
                    onClick={handleSendMessage}
                    disabled={!query.trim() || isSendingMessage}
                    size="sm"
                    className="absolute bottom-2 right-2 h-8 w-8 p-0"
                  >
                    {isSendingMessage ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>
              <div className="text-xs text-muted-foreground text-center">
                For property searches, visit the <button 
                  onClick={() => {onClose(); navigate('/discover');}} 
                  className="text-primary hover:underline"
                >
                  Discover section
                </button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};