import { useState, useEffect, useRef, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Loader2, Send, MapPin, Home, DollarSign, ArrowRight, Sparkles, Upload, X, MessageSquare, Plus, History, PlaneTakeoff, Heart } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useChat } from '@/hooks/useChat';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useCurrency } from '@/contexts/CurrencyContext';
import { useToast } from '@/hooks/use-toast';
import { PropertyDetailModal } from '@/components/PropertyDetailModal';
import { useUsageTracking } from '@/hooks/useUsageTracking';
import { useMatches } from '@/hooks/useMatches';
import { SubscriptionModal } from '@/components/SubscriptionModal';
import { calculateVibeScore } from '@/utils/vibeScoring';
import { VibeScore } from '@/components/VibeScore';
import { UserPreferences } from '@/types';

interface PropertyMatch {
  id: string;
  title: string;
  location: string;
  price: number;
  size: string;
  vibe: string;
  description: string;
  highlights: string[];
  images: string[];
  matchScore: number;
  matchReason: string;
  realtor_id?: string;
  vibe_analysis?: any;
}

interface SearchResult {
  results: PropertyMatch[];
  summary: string;
  totalMatches: number;
}

interface AIChatViewProps {
  showNavigation?: boolean;
  userPreferences?: UserPreferences;
}

const AIChatView = ({
  showNavigation = true,
  userPreferences
}: AIChatViewProps) => {
  const [query, setQuery] = useState('');
  const [selectedProperty, setSelectedProperty] = useState<PropertyMatch | null>(null);
  const [showPropertyModal, setShowPropertyModal] = useState(false);
  const [uploadedImages, setUploadedImages] = useState<File[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [likedProperties, setLikedProperties] = useState<Set<string>>(new Set());
  const [showSubscriptionModal, setShowSubscriptionModal] = useState(false);
  const [tempUserMessage, setTempUserMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const { user, loading } = useAuth();
  const { createMatch } = useMatches();
  const { formatPrice } = useCurrency();
  const { toast } = useToast();
  const navigate = useNavigate();
  const { canPerformAction, updateUsage } = useUsageTracking();

  // Use the proper chat hook for database-backed conversations
  const {
    conversations,
    messages,
    currentConversationId,
    setCurrentConversationId,
    sendMessage,
    sendMessageWithoutConversation,
    isSendingMessage
  } = useChat();

  // Compute all results from messages to avoid infinite re-renders
  const allResults = useMemo(() => {
    const results: PropertyMatch[] = [];
    messages.forEach(message => {
      if (message.role === 'assistant') {
        try {
          const parsed = JSON.parse(message.content);
          if (parsed.results && Array.isArray(parsed.results)) {
            results.push(...parsed.results);
          }
        } catch (e) {
          // Not JSON, ignore
        }
      }
    });
    return results;
  }, [messages]);

  // Initialize conversation selection based on existing conversations with messages
  useEffect(() => {
    if (user && conversations.length > 0 && !currentConversationId) {
      const findConversationWithMessages = async () => {
        for (const conversation of conversations) {
          const { data: conversationMessages } = await supabase
            .from('chat_messages')
            .select('id')
            .eq('conversation_id', conversation.id)
            .limit(1);
          if (conversationMessages && conversationMessages.length > 0) {
            setCurrentConversationId(conversation.id);
            return;
          }
        }
        // If no conversation has messages, don't select any
      };
      findConversationWithMessages();
    }
  }, [user, conversations, currentConversationId, setCurrentConversationId]);

  const handleImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files) {
      const newImages = Array.from(files).slice(0, 3);
      setUploadedImages(prev => [...prev, ...newImages].slice(0, 3));
    }
  };

  const removeImage = (index: number) => {
    setUploadedImages(prev => prev.filter((_, i) => i !== index));
  };

  const convertImageToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const createNewChat = () => {
    setCurrentConversationId(null);
    setQuery('');
    setUploadedImages([]);
    setShowHistory(false);
  };
    setQuery('');
    setUploadedImages([]);
    setShowHistory(false);
  };

  const switchToConversation = async (conversationId: string) => {
    setCurrentConversationId(conversationId);
    setShowHistory(false);
  };

  const handleLikeProperty = async (propertyId: string, realtorId?: string) => {
    if (!user) {
      toast({
        title: "Sign in required",
        description: "Please sign in to like properties",
        variant: "destructive"
      });
      return;
    }

    try {
      setLikedProperties(prev => new Set([...prev, propertyId]));

      // Find the actual realtor ID from the search results
      const property = allResults.find(p => p.id === propertyId);
      const actualRealtorId = property?.realtor_id || realtorId;
      
      if (!actualRealtorId) {
        // Fallback: try to get realtor_id from database
        const { data: propertyData } = await supabase
          .from('properties')
          .select('realtor_id')
          .eq('id', propertyId)
          .single();
        
        if (propertyData?.realtor_id) {
          await createMatch(propertyId, propertyData.realtor_id);
          toast({
            title: "Property liked!",
            description: "Added to your matches"
          });
        } else {
          toast({
            title: "Error",
            description: "Could not create match - realtor information missing",
            variant: "destructive"
          });
        }
      } else {
        await createMatch(propertyId, actualRealtorId);
        toast({
          title: "Property liked!",
          description: "Added to your matches"
        });
      }
    } catch (error) {
      console.error('Error liking property:', error);
      setLikedProperties(prev => {
        const newSet = new Set(prev);
        newSet.delete(propertyId);
        return newSet;
      });
      toast({
        title: "Error",
        description: "Failed to like property",
        variant: "destructive"
      });
    }
  };

  const handleSearch = async () => {
    if (!query.trim() && uploadedImages.length === 0) {
      toast({
        title: "Please describe your ideal home or upload an image",
        description: "Tell us what you're looking for or show us a reference image",
        variant: "destructive"
      });
      return;
    }

    if (!user) {
      toast({
        title: "Sign in required",
        description: "Please sign in to use AI search",
        variant: "destructive"
      });
      return;
    }

    if (!canPerformAction('ai-search')) {
      setShowSubscriptionModal(true);
      return;
    }

    // Show user message immediately
    setTempUserMessage(query);

    const messageData = {
      message: query,
      userType: 'renter' as const,
      userPreferences,
      propertyImages: uploadedImages.length > 0 
        ? await Promise.all(uploadedImages.map(async file => await convertImageToBase64(file))) 
        : []
    };

    try {
      // Send message - this will create a conversation if needed
      if (currentConversationId) {
        await sendMessage({
          ...messageData,
          conversationId: currentConversationId
        });
      } else {
        await sendMessageWithoutConversation(
          messageData.message,
          messageData.userType,
          messageData.userPreferences,
          messageData.propertyImages
        );
      }

      // Update AI search usage
      await updateUsage('ai-search');
      
      toast({
        title: "Search complete!",
        description: "Found some great matches for you."
      });
    } catch (error) {
      console.error('Search error:', error);
      toast({
        title: "Search failed",
        description: "There was an error processing your search. Please try again.",
        variant: "destructive"
      });
    } finally {
      setQuery('');
      setUploadedImages([]);
      // Clear temporary message after a short delay to let the real message appear
      setTimeout(() => setTempUserMessage(null), 1000);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSearch();
    }
  };

  const handlePropertyClick = (property: PropertyMatch) => {
    setSelectedProperty(property);
    setShowPropertyModal(true);
  };

  if (loading) {
    return (
      <div className={`min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-100 ${showNavigation ? 'pt-20' : 'pt-8'}`}>
        <div className="container mx-auto px-4 py-8">
          <div className="max-w-4xl mx-auto">
            <div className="w-full p-6 bg-card border border-border rounded-2xl">
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="h-screen flex items-center justify-center">
        <Card className="p-6 max-w-md mx-auto">
          <CardContent className="text-center">
            <h2 className="text-xl font-bold mb-4">AI Property Search</h2>
            <p className="text-muted-foreground mb-4">
              Sign in to access our AI-powered property search
            </p>
            <Button onClick={() => navigate('/auth')}>
              Sign In
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className={`min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-100 ${showNavigation ? 'pt-20' : 'pt-8'}`}>
      <div className="container mx-auto px-4 py-8">
        <div className="max-w-4xl mx-auto relative">
          {/* Title outside chat box */}
          <div className="text-center mb-6">
            <h2 className="text-xl font-semibold text-foreground mb-2">Describe your dream home</h2>
          </div>
          
          {/* History and New Chat buttons - positioned below header, above chat box */}
          {user && (
            <div className="flex justify-end mb-4">
              <div className="flex gap-2">
                <Button 
                  onClick={() => setShowHistory(!showHistory)} 
                  variant="ghost" 
                  size="sm" 
                  className="h-8 w-8 p-0 hover:bg-secondary/50"
                >
                  <History className="h-4 w-4" />
                </Button>
                <Button 
                  onClick={createNewChat} 
                  variant="ghost" 
                  size="sm" 
                  className="h-8 w-8 p-0 hover:bg-secondary/50"
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}

          <div className="w-full p-6 bg-transparent rounded-md shadow-xl">
            {/* Header */}
            <div className="text-center mb-6 relative">
            </div>

            {/* Chat History Dropdown */}
            {showHistory && (
              <Card className="mb-6 border-border">
                <CardContent className="p-4">
                  <div className="space-y-2 max-h-60 overflow-y-auto">
                    {conversations.length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-4">No conversations yet</p>
                    ) : (
                      conversations.map(conversation => (
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
                              <p className="text-sm font-medium truncate">
                                {conversation.title || 'New Search'}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {new Date(conversation.updated_at || conversation.created_at).toLocaleString('en-US', {
                                  month: 'short',
                                  day: 'numeric',
                                  hour: 'numeric',
                                  minute: '2-digit',
                                  hour12: true
                                })}
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

            {/* Temp User Message Display */}
            {tempUserMessage && (
              <div className="space-y-4 mb-6">
                <div className="flex justify-end animate-fade-in">
                  <div className="max-w-[80%] p-3 rounded-lg bg-primary text-primary-foreground">
                    <p className="text-sm">{tempUserMessage}</p>
                  </div>
                </div>
                
                {/* AI Thinking Animation */}
                <div className="flex justify-start animate-fade-in">
                  <div className="bg-secondary text-secondary-foreground p-3 rounded-lg">
                    <div className="flex space-x-1">
                      <div className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                      <div className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                      <div className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Chat Messages */}
            {messages.length > 0 && (
              <div className="space-y-6 mb-6 max-h-96 overflow-y-auto">
                {messages.map((message, index) => {
                  if (message.role === 'user') {
                    return (
                      <div key={index} className="flex justify-end mb-4 animate-fade-in">
                        <div className="max-w-[80%] p-3 rounded-lg bg-primary text-primary-foreground">
                          <p className="text-sm">{message.content}</p>
                          <p className="text-xs opacity-70 mt-1">
                            {new Date(message.created_at).toLocaleString()}
                          </p>
                        </div>
                      </div>
                    );
                  } else {
                    // AI message - try to parse for property results
                    let searchResults: SearchResult | null = null;
                    let displayContent = message.content;
                    try {
                      const parsed = JSON.parse(message.content);
                      if (parsed.results && Array.isArray(parsed.results)) {
                        searchResults = parsed;
                      }
                    } catch (e) {
                      // Not JSON, treat as regular text
                      if (message.content.includes('{"results":') || message.content.includes('"summary":')) {
                        displayContent = "I found some amazing properties that match your preferences! Let me show you the top matches.";
                      }
                    }
                    
                    if (searchResults) {
                      return (
                        <div key={index} className="animate-fade-in">
                          {/* AI Response with Results */}
                          <div className="flex justify-start">
                            <div className="max-w-[95%] space-y-4">
                              {searchResults.summary && (
                                <div className="bg-secondary text-secondary-foreground p-3 rounded-lg">
                                  <p className="text-sm">{searchResults.summary}</p>
                                </div>
                              )}
                              
                              {searchResults.results.length > 0 && (
                                <div className="space-y-3">
                                  {searchResults.results.map(property => (
                                    <Card 
                                      key={property.id} 
                                      className="border-border hover:shadow-lg transition-all duration-200 cursor-pointer hover-scale" 
                                      onClick={() => handlePropertyClick(property)}
                                    >
                                      <CardContent className="p-3 sm:p-4">
                                        {/* Vibe Rating */}
                                        {userPreferences && (
                                          <div className="mb-3">
                                            <VibeScore 
                                              score={calculateVibeScore({
                                                id: property.id,
                                                images: property.images,
                                                title: property.title,
                                                location: property.location,
                                                price: property.price,
                                                size: property.size,
                                                vibe: property.vibe,
                                                description: property.description,
                                                highlights: property.highlights,
                                                realtor: { id: '', name: '', phone: '', email: '' },
                                                vibe_analysis: property.vibe_analysis
                                              }, userPreferences)} 
                                              size="sm" 
                                            />
                                          </div>
                                        )}
                                        
                                        <div className="flex flex-col sm:flex-row gap-3 sm:gap-4">
                                          {/* Property Image */}
                                          <div className="w-full h-48 sm:w-28 sm:h-28 md:w-32 md:h-32 rounded-lg overflow-hidden bg-muted flex-shrink-0 relative sm:order-1">
                                            {property.images && property.images.length > 0 ? (
                                              <img src={property.images[0]} alt={property.title} className="w-full h-full object-cover" />
                                            ) : (
                                              <div className="w-full h-full flex items-center justify-center">
                                                <Home className="h-8 w-8 sm:h-10 sm:w-10 text-muted-foreground" />
                                              </div>
                                            )}
                                            
                                            {/* Match Score Overlay */}
                                            <div className="absolute top-2 left-2">
                                              <Badge className="bg-primary/90 text-primary-foreground border-none text-sm font-semibold px-2 py-1">
                                                {property.matchScore}% match
                                              </Badge>
                                            </div>
                                            
                                            {/* Like Button - Mobile position */}
                                            <div className="absolute top-2 right-2 sm:hidden">
                                              <Button 
                                                onClick={e => {
                                                  e.stopPropagation();
                                                  handleLikeProperty(property.id, property.realtor_id);
                                                }} 
                                                size="sm" 
                                                variant={likedProperties.has(property.id) ? "default" : "ghost"} 
                                                className={`h-8 w-8 p-0 ${
                                                  likedProperties.has(property.id) 
                                                    ? "bg-green-500 hover:bg-green-600 text-white" 
                                                    : "bg-white/90 hover:bg-white text-green-600 backdrop-blur"
                                                }`}
                                              >
                                                <Heart className={`h-4 w-4 ${likedProperties.has(property.id) ? "fill-current" : ""}`} />
                                              </Button>
                                            </div>
                                          </div>

                                          {/* Property Details */}
                                          <div className="flex-1 min-w-0 sm:order-2 text-left">
                                            <div className="flex items-start justify-between mb-2">
                                              <div className="flex-1 min-w-0 pr-2">
                                                <h5 className="font-semibold text-foreground line-clamp-1 text-base sm:text-base text-left">
                                                  {property.title}
                                                </h5>
                                                <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
                                                  <MapPin className="h-4 w-4 flex-shrink-0" />
                                                  <span className="line-clamp-1">{property.location}</span>
                                                </div>
                                              </div>
                                              
                                              {/* Desktop buttons */}
                                              <div className="hidden sm:flex flex-col items-end gap-1">
                                                <Button 
                                                  onClick={e => {
                                                    e.stopPropagation();
                                                    handleLikeProperty(property.id, property.realtor_id);
                                                  }} 
                                                  size="sm" 
                                                  variant={likedProperties.has(property.id) ? "default" : "ghost"} 
                                                  className={`h-8 w-8 p-0 ${
                                                    likedProperties.has(property.id) 
                                                      ? "bg-green-500 hover:bg-green-600 text-white" 
                                                      : "hover:bg-green-50 text-green-600"
                                                  }`}
                                                >
                                                  <Heart className={`h-4 w-4 ${likedProperties.has(property.id) ? "fill-current" : ""}`} />
                                                </Button>
                                              </div>
                                            </div>

                                            <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground mb-3">
                                              <div className="flex items-center">
                                                <span className="font-semibold text-foreground text-lg">{formatPrice(property.price)}</span>
                                              </div>
                                              {property.size && <span className="font-medium">{property.size}</span>}
                                              {property.vibe && <Badge variant="outline" className="text-xs">{property.vibe}</Badge>}
                                            </div>

                                            {/* Why it matches */}
                                            <div className="bg-secondary/10 p-3 rounded-lg mb-3 text-left">
                                              <p className="text-sm text-foreground text-left">
                                                <span className="font-semibold text-primary">Why it matches: </span>
                                                {property.matchReason}
                                              </p>
                                            </div>
                                          </div>
                                        </div>
                                      </CardContent>
                                    </Card>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    } else {
                      // Regular text message
                      return (
                        <div key={index} className="flex justify-start animate-fade-in">
                          <div className="bg-secondary text-secondary-foreground p-3 rounded-lg max-w-[85%] sm:max-w-[70%] md:max-w-[60%] w-fit">
                            <p className="text-sm whitespace-pre-wrap">{displayContent}</p>
                          </div>
                        </div>
                      );
                    }
                  }
                })}

                {/* AI Thinking Animation */}
                {isSendingMessage && (
                  <div className="flex justify-start animate-fade-in">
                    <div className="bg-secondary text-secondary-foreground p-3 rounded-lg">
                      <div className="flex space-x-1">
                        <div className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                        <div className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                        <div className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Chat Input */}
            <div className="space-y-4">
              <div className="relative">
                <Textarea
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={handleKeyPress}
                  placeholder="Tell me about your ideal home - style, location, features, vibe..."
                  disabled={isSendingMessage}
                  className="min-h-[100px] pr-20 resize-none bg-transparent"
                />
                <div className="absolute bottom-3 right-3 flex gap-2">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={handleImageUpload}
                    className="hidden"
                  />
                  <Button 
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isSendingMessage || uploadedImages.length >= 3}
                    size="sm"
                    variant="outline"
                    className="h-8 w-8 p-0"
                  >
                    <Upload className="h-4 w-4" />
                  </Button>
                  <Button 
                    onClick={handleSearch}
                    disabled={isSendingMessage || (!query.trim() && uploadedImages.length === 0)}
                    size="sm"
                    className="h-8 w-8 p-0"
                  >
                    {isSendingMessage ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <PlaneTakeoff className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>

              {/* Image Preview */}
              {uploadedImages.length > 0 && (
                <div className="flex gap-2 flex-wrap animate-fade-in">
                  {uploadedImages.map((image, index) => (
                    <div key={index} className="relative">
                      <img 
                        src={URL.createObjectURL(image)} 
                        alt={`Upload ${index + 1}`} 
                        className="w-16 h-16 object-cover rounded-lg border border-border" 
                      />
                      <Button 
                        onClick={() => removeImage(index)}
                        size="sm"
                        variant="destructive"
                        className="absolute -top-2 -right-2 h-5 w-5 p-0 rounded-full"
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>

          {/* Property Detail Modal */}
          <PropertyDetailModal 
            apartment={selectedProperty ? {
              id: selectedProperty.id,
              title: selectedProperty.title,
              location: selectedProperty.location,
              price: selectedProperty.price,
              size: selectedProperty.size,
              vibe: selectedProperty.vibe,
              description: selectedProperty.description,
              highlights: selectedProperty.highlights,
              images: selectedProperty.images,
              realtor: {
                id: "contact",
                name: "Contact for details",
                phone: "",
                email: ""
              },
              vibe_analysis: selectedProperty.vibe_analysis
            } : null}
            userPreferences={userPreferences}
            isOpen={showPropertyModal}
            onClose={() => {
              setShowPropertyModal(false);
              setSelectedProperty(null);
            }}
            onLike={selectedProperty ? () => handleLikeProperty(selectedProperty.id, selectedProperty.realtor_id) : undefined}
          />

          {/* Subscription Modal */}
          <SubscriptionModal 
            isOpen={showSubscriptionModal} 
            onClose={() => setShowSubscriptionModal(false)} 
          />
          </div>
        </div>
      </div>
    </div>
  );
};

export default AIChatView;
