import { useState, useEffect, useRef, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Loader2, Send, MapPin, Home, DollarSign, ArrowRight, Sparkles, Upload, X, MessageSquare, Plus, History, PlaneTakeoff, Heart } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
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
import { useChat } from '@/hooks/useChat';

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

export const AIChatView = ({ showNavigation = true, userPreferences }: AIChatViewProps) => {
  const [query, setQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResult | null>(null);
  const [showAuthPrompt, setShowAuthPrompt] = useState(false);
  const [selectedProperty, setSelectedProperty] = useState<PropertyMatch | null>(null);
  const [showPropertyModal, setShowPropertyModal] = useState(false);
  const [uploadedImages, setUploadedImages] = useState<File[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [likedProperties, setLikedProperties] = useState<Set<string>>(new Set());
  const [showSubscriptionModal, setShowSubscriptionModal] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const { formatPrice } = useCurrency();
  const { toast } = useToast();
  const { canPerformAction, updateUsage } = useUsageTracking();
  const { createMatch } = useMatches();
  
  // Use the proper chat hook for database-backed conversations
  const {
    conversations,
    messages,
    currentConversationId,
    setCurrentConversationId,
    createConversation,
    isCreatingConversation,
    sendMessage,
    isSendingMessage,
    deleteConversation,
    isDeletingConversation,
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

  // Initialize first conversation if needed
  useEffect(() => {
    if (user && conversations.length === 0 && !currentConversationId) {
      createConversation('AI Property Search');
    }
  }, [user, conversations.length, currentConversationId, createConversation]);

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
    createConversation('New AI Search');
    setQuery('');
    setUploadedImages([]);
    setSearchResults(null);
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

  const switchToConversation = (conversationId: string) => {
    setCurrentConversationId(conversationId);
    setShowHistory(false);
  };

  const handleSearch = async (searchQuery?: string) => {
    const queryToUse = searchQuery || query;
    
    if (!user) {
      localStorage.setItem('pendingSearchQuery', queryToUse);
      setShowAuthPrompt(true);
      return;
    }

    // Check search limit using usage tracking
    if (!canPerformAction('ai-search')) {
      setShowSubscriptionModal(true);
      return;
    }

    if (!queryToUse.trim() && uploadedImages.length === 0) {
      toast({
        title: "Please describe your ideal home or upload an image",
        description: "Tell us what you're looking for or show us a reference image",
        variant: "destructive"
      });
      return;
    }

    // Send message using the chat hook
    const messageData = {
      message: queryToUse,
      conversationId: currentConversationId!,
      userType: 'renter' as const,
      userPreferences,
      propertyImages: uploadedImages.length > 0 ? await Promise.all(
        uploadedImages.map(async (file) => await convertImageToBase64(file))
      ) : []
    };

    try {
      // Send message to AI chat
      sendMessage(messageData);
      
      // Update AI search usage
      await updateUsage('ai-search');
      
      toast({
        title: "Message sent!",
        description: "Your AI assistant is processing your request.",
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
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSearch();
    }
  };

  const handleBrowseAll = () => {
    navigate('/discover');
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

  return (
    <div className={`min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-100 ${showNavigation ? 'pt-20' : 'pt-8'}`}>
      <div className="container mx-auto px-4 py-8">
        <div className="max-w-4xl mx-auto relative">
          <div className="w-full p-6 bg-card border border-border rounded-2xl shadow-xl">
            {/* Header */}
            <div className="text-center mb-6 relative">
              <div className="flex justify-center mb-4">
                <div className="relative">
                  <div className="absolute inset-0 bg-primary/20 rounded-full blur-lg"></div>
                  <div className="relative bg-primary/10 p-3 rounded-full">
                    <Sparkles className="h-8 w-8 text-primary" />
                  </div>
                </div>
              </div>
              
              {/* History and New Chat buttons positioned at sparkle level */}
              <div className="absolute top-0 right-0 flex gap-2">
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
              
              <h3 className="text-2xl font-bold text-foreground mb-2">Haus Finder</h3>
              <p className="text-muted-foreground">
                Describe your dream home or upload reference images
              </p>
            </div>

            {/* Chat History Dropdown */}
            {showHistory && (
              <Card className="mb-6 border-border">
                <CardContent className="p-4">
                  <div className="space-y-2 max-h-60 overflow-y-auto">
                    {conversations.map((conversation) => (
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
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Chat Messages */}
            {messages.length > 0 && (
              <div className="space-y-4 mb-6 max-h-96 overflow-y-auto">
                {messages.map((message, index) => {
                  if (message.role === 'user') {
                    return (
                      <div key={index} className="flex justify-end">
                        <div className="max-w-[80%] p-3 rounded-lg bg-primary text-primary-foreground">
                          <p className="text-sm">{message.content}</p>
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
                      // Clean up any JSON artifacts that might be visible
                      if (message.content.includes('{"results":') || message.content.includes('"summary":')) {
                        displayContent = "I found some properties that might interest you! Let me show them in a better format.";
                      }
                    }

                    if (searchResults) {
                      return (
                        <div key={index} className="flex justify-start">
                          <div className="max-w-[95%] space-y-4">
                            {searchResults.summary && (
                              <div className="bg-secondary text-secondary-foreground p-3 rounded-lg">
                                <p className="text-sm">{searchResults.summary}</p>
                              </div>
                            )}
                            
                            {searchResults.results.length > 0 && (
                              <div className="space-y-4">
                                {searchResults.results.map((property) => (
                                  <Card 
                                    key={property.id} 
                                    className="bg-white border border-border hover:shadow-lg transition-all duration-300 cursor-pointer"
                                    onClick={() => handlePropertyClick(property)}
                                  >
                                    <CardContent className="p-0">
                                      <div className="grid md:grid-cols-2 gap-0">
                                        {/* Property Image */}
                                        <div className="relative h-48 md:h-full">
                                          <img
                                            src={property.images?.[0] || '/placeholder-property.jpg'}
                                            alt={property.title}
                                            className="w-full h-full object-cover"
                                          />
                                          {/* Match Score Overlay */}
                                          <div className="absolute top-3 left-3">
                                            <Badge className="bg-primary/90 text-primary-foreground border-none text-xs font-semibold">
                                              {property.matchScore}% match
                                            </Badge>
                                          </div>
                                          {/* Vibe Score Overlay */}
                                          {userPreferences && (
                                            <div className="absolute top-3 right-3">
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
                                        </div>
                                        
                                        {/* Property Details */}
                                        <div className="p-4 flex flex-col justify-between">
                                          <div className="space-y-3">
                                            <div>
                                              <h3 className="font-semibold text-lg text-foreground mb-1">{property.title}</h3>
                                              <div className="flex items-center gap-1 text-muted-foreground mb-2">
                                                <MapPin className="h-4 w-4" />
                                                <span className="text-sm">{property.location}</span>
                                              </div>
                                            </div>

                                            <div className="space-y-2">
                                              <div className="flex items-center justify-between">
                                                <div className="flex items-center gap-4">
                                                  <div className="flex items-center gap-1">
                                                    <DollarSign className="h-4 w-4 text-muted-foreground" />
                                                    <span className="font-semibold text-lg text-primary">
                                                      {formatPrice(property.price)}
                                                    </span>
                                                  </div>
                                                  <div className="flex items-center gap-1">
                                                    <Home className="h-4 w-4 text-muted-foreground" />
                                                    <span className="text-sm text-muted-foreground">{property.size}</span>
                                                  </div>
                                                </div>
                                              </div>
                                              
                                              <p className="text-sm text-muted-foreground line-clamp-2">
                                                {property.description}
                                              </p>

                                              {/* Highlights */}
                                              {property.highlights && property.highlights.length > 0 && (
                                                <div className="flex flex-wrap gap-1 mt-2">
                                                  {property.highlights.slice(0, 4).map((highlight, idx) => (
                                                    <Badge key={idx} variant="secondary" className="text-xs">
                                                      {highlight}
                                                    </Badge>
                                                  ))}
                                                </div>
                                              )}
                                            </div>

                                            {/* Match Reason */}
                                            <div className="p-2 bg-primary/5 rounded border border-primary/10">
                                              <p className="text-xs text-foreground">
                                                <span className="font-medium text-primary">Why it matches:</span> {property.matchReason}
                                              </p>
                                            </div>
                                          </div>

                                          {/* Action Button */}
                                          <div className="flex justify-between items-center pt-3 mt-3 border-t border-border">
                                            <Button
                                              size="sm"
                                              variant="outline"
                                              className="text-xs"
                                            >
                                              View Details
                                            </Button>
                                            <Button
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                handleLikeProperty(property.id, property.realtor_id);
                                              }}
                                              size="sm"
                                              variant={likedProperties.has(property.id) ? "default" : "outline"}
                                              className={`h-8 w-8 p-0 ${
                                                likedProperties.has(property.id) 
                                                  ? 'bg-red-500 hover:bg-red-600 text-white' 
                                                  : 'hover:bg-red-50 hover:text-red-500'
                                              }`}
                                            >
                                              <Heart className={`h-4 w-4 ${likedProperties.has(property.id) ? 'fill-current' : ''}`} />
                                            </Button>
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
                      );
                    } else {
                      // Regular text message - use cleaned content
                      return (
                        <div key={index} className="flex justify-start">
                          <div className="max-w-[80%] p-3 rounded-lg bg-secondary text-secondary-foreground">
                            <p className="text-sm whitespace-pre-wrap">{displayContent}</p>
                          </div>
                        </div>
                      );
                    }
                  }
                })}
                
                {/* AI Thinking Animation */}
                {isSendingMessage && (
                  <div className="flex justify-start">
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
                  placeholder={messages.length === 0 ? "I'm looking for a modern apartment with city views, close to cafes and markets. I love minimalist design and need good natural light..." : "Ask me about properties, neighborhoods, or anything else..."}
                  className="min-h-[100px] pr-20 resize-none"
                  disabled={isSendingMessage}
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
                    onClick={() => handleSearch()}
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
                <div className="flex gap-2 flex-wrap">
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

              {/* Auth Prompt */}
              {showAuthPrompt && !user && (
                <Card className="border-primary/20 bg-primary/5">
                  <CardContent className="p-4">
                    <div className="text-center">
                      <p className="text-foreground mb-3">
                        Sign in to search for your perfect home match!
                      </p>
                      <Button 
                        onClick={() => navigate('/auth', { state: { returnTo: '/discover' } })}
                        className="bg-primary hover:bg-primary/90 text-primary-foreground"
                      >
                        Sign In to Continue
                      </Button>
                    </div>
                  </CardContent>
                </Card>
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
                  email: "",
                },
                vibe_analysis: selectedProperty.vibe_analysis
              } : null}
              userPreferences={userPreferences}
              isOpen={showPropertyModal}
              onClose={() => {
                setShowPropertyModal(false);
                setSelectedProperty(null);
              }}
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