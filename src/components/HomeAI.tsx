import { useState, useEffect, useRef, useMemo } from 'react';
import { translateLocationToEnglish } from '@/utils/locationTranslation';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Send, MapPin, Home, DollarSign, Upload, X, MessageSquare, Plus, History, PlaneTakeoff, Heart } from 'lucide-react';
import { PropertyAmenities } from '@/components/PropertyAmenities';
import { useNavigate } from 'react-router-dom';
import { useCurrency } from '@/contexts/CurrencyContext';
import { useToast } from '@/components/ui/use-toast';
import { PropertyDetailModal } from '@/components/PropertyDetailModal';
import { calculateVibeScore } from '@/utils/vibeScoring';
import { VibeScore } from '@/components/VibeScore';
import { HighlightTags } from '@/components/HighlightTags';
import { UserPreferences } from '@/types';
import { useHomeAI } from '@/hooks/useHomeAI';
import { useAuth } from '@/hooks/useAuth';
import { useMatches } from '@/hooks/useMatches';
import { useUsageTracking } from '@/hooks/useUsageTracking';
import { supabase } from '@/integrations/supabase/client';
import { ExternalPropertyBadge } from '@/components/ExternalPropertyBadge';
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
  amenities?: string[];
  // External marketplace properties
  isExternal?: boolean;
  source?: 'batdongsan' | 'nhatot' | 'airbnb' | null;
  sourceUrl?: string | null;
  sourceProviderName?: string;
  sourceProviderPhone?: string;
  // Cache metadata
  cached?: boolean;
  crawledAt?: string;
}
interface SearchResult {
  results: PropertyMatch[];
  summary: string;
  totalMatches: number;
}
interface HomeAIProps {
  userPreferences?: UserPreferences;
}
export const HomeAI = ({
  userPreferences
}: HomeAIProps) => {
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedProperty, setSelectedProperty] = useState<PropertyMatch | null>(null);
  const [showPropertyModal, setShowPropertyModal] = useState(false);
  const [uploadedImages, setUploadedImages] = useState<File[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [likedProperties, setLikedProperties] = useState<Set<string>>(new Set());
  const [tempUserMessage, setTempUserMessage] = useState<string | null>(null);
  const [tempUserMessageForLoggedIn, setTempUserMessageForLoggedIn] = useState<string | null>(null);
  const [tempUserImages, setTempUserImages] = useState<string[]>([]);
  const [typedPlaceholder, setTypedPlaceholder] = useState('');
  const [hasSearched, setHasSearched] = useState(false);
  const [wantsNewChat, setWantsNewChat] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const {
    formatPrice
  } = useCurrency();
  const {
    toast
  } = useToast();
  const {
    user
  } = useAuth();
  const {
    createMatch
  } = useMatches();
  const {
    canPerformAction,
    updateUsage,
    refetchUsage
  } = useUsageTracking();

  // Use the proper chat hook for database-backed conversations
  const {
    conversations,
    messages,
    currentConversationId,
    setCurrentConversationId,
    sendMessage,
    sendMessageWithoutConversation,
    startFreshChat,
    isSendingMessage
  } = useHomeAI();

  // Clear temporary message when user's message appears in database
  useEffect(() => {
    if (messages.length > 0 && tempUserMessageForLoggedIn) {
      // Check if the most recent user message matches our temporary message
      const userMessages = messages.filter(message => message.role === 'user');
      const latestUserMessage = userMessages[userMessages.length - 1];
      if (latestUserMessage && latestUserMessage.content === tempUserMessageForLoggedIn) {
        setTempUserMessageForLoggedIn(null);
        setTempUserImages([]);
      }
    }
  }, [messages, tempUserMessageForLoggedIn]);

  // Typing effect for placeholder
  const fullPlaceholder = "I'm looking for a modern apartment with city views, close to cafes and markets. I love minimalist design and need good natural light... (or upload reference images)";
  useEffect(() => {
    if (messages.length === 0) {
      let i = 0;
      const typingInterval = setInterval(() => {
        setTypedPlaceholder(fullPlaceholder.slice(0, i + 1));
        i++;
        if (i >= fullPlaceholder.length) {
          clearInterval(typingInterval);
        }
      }, 50);
      return () => clearInterval(typingInterval);
    } else {
      setTypedPlaceholder("Ask me about properties, neighborhoods, or anything else...");
    }
  }, [messages.length, fullPlaceholder]);

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

  // Always start with empty session by default - user can manually select chat history if needed
  useEffect(() => {
    if (user && !currentConversationId) {
      // Start fresh - no automatic loading of previous conversations
      startFreshChat();
    }
  }, [user, startFreshChat]);

  // Check for stored search query on component mount
  useEffect(() => {
    const storedQuery = localStorage.getItem('pendingSearchQuery');
    if (storedQuery) {
      setQuery(storedQuery);
      if (user) {
        localStorage.removeItem('pendingSearchQuery');
        // Auto-trigger search with stored query after a brief delay
        setTimeout(() => handleSearch(storedQuery), 100);
      }
    }
  }, [user]);
  const handleImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files) {
      const newImages = Array.from(files).slice(0, 3); // Limit to 3 images
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
    // Clear all chat-related state completely
    startFreshChat();
    setQuery('');
    setUploadedImages([]);
    setSearchResults(null);
    setShowHistory(false);
    setWantsNewChat(true);
    setHasSearched(false);
    setTempUserMessage(null);
    setTempUserMessageForLoggedIn(null);
    setTempUserImages([]);
    // Clear any stored pending queries
    localStorage.removeItem('pendingSearchQuery');
  };
  const switchToConversation = async (conversationId: string) => {
    setCurrentConversationId(conversationId);
    setShowHistory(false);
    setWantsNewChat(false);
    setHasSearched(true); // Existing conversation means user has searched before
    // Clear any temporary states when switching to existing conversation
    setTempUserMessage(null);
    setTempUserMessageForLoggedIn(null);
    setTempUserImages([]);
    setSearchResults(null); // Clear anonymous search results

    // Ensure the conversation has messages, if not, it might be an empty one
    const {
      data: conversationMessages
    } = await supabase.from('chat_messages').select('id').eq('conversation_id', conversationId).limit(1);
    if (!conversationMessages || conversationMessages.length === 0) {
      console.log(`Conversation ${conversationId} appears to be empty`);
    }
  };
  const handleLikeProperty = async (propertyId: string, realtorId?: string) => {
    if (!user) {
      localStorage.setItem('pendingSearchQuery', query);
      navigate('/auth', { state: { returnTo: '/' } });
      return;
    }
    try {
      setLikedProperties(prev => new Set([...prev, propertyId]));

      // Find the actual realtor ID from the search results
      const property = allResults.find(p => p.id === propertyId);
      const actualRealtorId = property?.realtor_id || realtorId;

      // Check if this is an external property (realtor_id starts with "ext-")
      const isExternal = actualRealtorId?.startsWith('ext-');

      if (isExternal) {
        // External properties can't be matched via property_matches (FK constraint).
        const { data: internalProp } = await supabase
          .from('properties')
          .select('realtor_id')
          .eq('id', propertyId)
          .maybeSingle();

        if (internalProp?.realtor_id) {
          await createMatch(propertyId, internalProp.realtor_id);
        } else {
          toast({
            title: "External property saved!",
            description: "This is an external listing. Visit the source link to contact the owner directly.",
          });
        }
        return;
      }

      if (!actualRealtorId) {
        const { data: propertyData } = await supabase
          .from('properties')
          .select('realtor_id')
          .eq('id', propertyId)
          .single();
        if (propertyData?.realtor_id) {
          await createMatch(propertyId, propertyData.realtor_id);
        } else {
          toast({
            title: "Error",
            description: "Could not create match - realtor information missing",
            variant: "destructive"
          });
        }
      } else {
        await createMatch(propertyId, actualRealtorId);
      }
    } catch (error: any) {
      console.error('Error liking property:', error);
      // Don't revert if it's ALREADY_MATCHED - keep it visually liked
      if (error?.message !== 'ALREADY_MATCHED') {
        setLikedProperties(prev => {
          const newSet = new Set(prev);
          newSet.delete(propertyId);
          return newSet;
        });
      }
      // Toast is already handled by useMatches onError
    }
  };
  const handleSearch = async (searchQuery?: string) => {
    const queryToUse = searchQuery || query;

    // Prevent new messages while AI is processing for both user types
    if (isSendingMessage || isSearching) {
      return;
    }

    // Check AI request limits for logged-in users
    if (user && !canPerformAction('ai-search')) {
      toast({
        title: "Daily AI Search Limit Reached",
        description: "Free tier users can make 10 AI searches per day. Upgrade to premium for unlimited searches or try again tomorrow.",
        variant: "destructive"
      });
      return;
    }

    // For anonymous users, limit to a single search
    if (!user && hasSearched) {
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
    if (user) {
      // Show user message immediately for logged-in users
      setTempUserMessageForLoggedIn(queryToUse);
      setTempUserImages(uploadedImages.length > 0 ? await Promise.all(uploadedImages.map(async file => await convertImageToBase64(file))) : []);
      const messageData = {
        message: queryToUse,
        userType: 'renter' as const,
        userPreferences,
        propertyImages: uploadedImages.length > 0 ? await Promise.all(uploadedImages.map(async file => await convertImageToBase64(file))) : []
      };
      try {
        // Send message - this will create a conversation if needed
        if (currentConversationId) {
          await sendMessage({
            ...messageData,
            conversationId: currentConversationId
          });
        } else {
          await sendMessageWithoutConversation(messageData.message, messageData.userType, messageData.userPreferences, messageData.propertyImages);
        }

        // Note: AI search usage is now tracked server-side in chat-ai edge function
        // Refetch usage to get updated counts
        await refetchUsage();
        setHasSearched(true);
        setWantsNewChat(false); // Reset new chat flag after successful search
        toast({
          title: "Message sent!",
          description: "Your AI assistant is processing your request."
        });
      } catch (error) {
        console.error('Search error:', error);
        toast({
          title: "Search failed",
          description: "There was an error processing your search. Please try again.",
          variant: "destructive"
        });
        // Clear temporary message on error
        setTempUserMessageForLoggedIn(null);
        setTempUserImages([]);
      } finally {
        setQuery('');
        setUploadedImages([]);
      }
    } else {
      // Handle search for anonymous users - call AI chat directly
      setTempUserMessage(queryToUse); // Show user message immediately
      setTempUserImages(uploadedImages.length > 0 ? await Promise.all(uploadedImages.map(async file => await convertImageToBase64(file))) : []);
      setIsSearching(true);
      try {
        const messageData = {
          message: queryToUse,
          userType: 'renter' as const,
          userPreferences: null,
          // Anonymous users don't have saved preferences
          propertyImages: uploadedImages.length > 0 ? await Promise.all(uploadedImages.map(async file => await convertImageToBase64(file))) : []
        };
        const response = await supabase.functions.invoke('chat-ai', {
          body: messageData
        });
        if (response.error) {
          throw response.error;
        }

        // Check if auth is required (returned from edge function)
        if (response.data?.requiresAuth) {
          toast({
            title: "Sign in to continue",
            description: response.data.response || "Please sign in to continue chatting."
          });
          setTimeout(() => {
            navigate('/auth', {
              state: {
                returnTo: '/'
              }
            });
          }, 2000);
          return;
        }

        // Parse AI response to extract search results
        let searchResults = null;
        if (response.data?.response) {
          try {
            const parsed = JSON.parse(response.data.response);
            if (parsed.results && Array.isArray(parsed.results)) {
              searchResults = parsed;
            }
          } catch (e) {
            // If not JSON, treat as text response
            searchResults = {
              results: [],
              summary: response.data.response,
              totalMatches: 0
            };
          }
        }
        if (searchResults) {
          setSearchResults(searchResults);
        }
        setHasSearched(true);
        toast({
          title: "Search completed!",
          description: "AI has processed your search request."
        });
      } catch (error) {
        console.error('Anonymous search error:', error);
        toast({
          title: "Search failed",
          description: "There was an error processing your search. Please try again.",
          variant: "destructive"
        });
      } finally {
        setIsSearching(false);
        setQuery('');
        setUploadedImages([]);
        // Keep tempUserMessage and images so the user's message remains visible after results
      }
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
  const handlePropertyClick = async (property: PropertyMatch) => {
    try {
      // Try to fetch full property details from database by ID
      const {
        data: fullProperty
      } = await supabase.from('properties').select('*').eq('id', property.id).single();
      if (fullProperty) {
        const enriched = {
          ...property,
          images: fullProperty.images?.length ? fullProperty.images : property.images,
          description: fullProperty.description || property.description,
          highlights: fullProperty.highlights?.length ? fullProperty.highlights : property.highlights,
          size: fullProperty.size || property.size,
          price: Number(fullProperty.price ?? property.price),
          vibe: fullProperty.vibe || property.vibe,
          vibe_analysis: fullProperty.vibe_analysis ?? property.vibe_analysis,
          realtor_id: fullProperty.realtor_id || property.realtor_id
        } as PropertyMatch;
        setSelectedProperty(enriched);
      } else {
        setSelectedProperty(property);
      }
    } catch (e) {
      // Fallback to original result on error
      setSelectedProperty(property);
    }
    setShowPropertyModal(true);
  };
  return <div className="w-full max-w-4xl mx-auto mt-4 px-1">
      <div className="p-3 md:p-6 shadow-xl bg-background/95 backdrop-blur-sm rounded-xl border border-border/50">
      {/* Header */}
      <div className="text-center mb-2 relative">
        
        {/* History and New Chat buttons - positioned to avoid text overlap */}
        {user && <div className="absolute top-0 right-2 flex gap-2 z-10">
            <Button onClick={() => setShowHistory(!showHistory)} variant="ghost" size="sm" className="h-8 w-8 p-0 hover:bg-secondary/50">
              <History className="h-4 w-4" />
            </Button>
            <Button onClick={createNewChat} variant="ghost" size="sm" className="h-8 w-8 p-0 hover:bg-secondary/50">
              <Plus className="h-4 w-4" />
            </Button>
          </div>}
        
        
      </div>

      {/* Chat History Dropdown */}
      {showHistory && user && <Card className="mb-3 mt-12 border-border">
          <CardContent className="p-4">
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {conversations.map(conversation => <div key={conversation.id} onClick={() => switchToConversation(conversation.id)} className={`p-3 rounded-lg cursor-pointer transition-colors ${conversation.id === currentConversationId ? 'bg-primary/10 border border-primary/20' : 'hover:bg-secondary/50'}`}>
                  <div className="flex items-center gap-2">
                    <MessageSquare className="h-4 w-4 text-muted-foreground" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate text-left">{conversation.title || 'New Search'}</p>
                      <p className="text-xs text-muted-foreground text-left">
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
                </div>)}
            </div>
          </CardContent>
        </Card>}

      {/* Chat Messages for Signed In Users */}
      {user && <div className="space-y-4 mb-4 mt-6 max-h-96 overflow-y-auto my-[30px]">
          {messages.map((message, index) => {
          if (message.role === 'user') {
            return <div key={index} className="flex justify-end animate-fade-in">
                  <div className="max-w-[80%] p-3 rounded-lg bg-primary text-primary-foreground space-y-2">
                    <p className="text-sm text-left">{message.content}</p>
                    {message.metadata?.images && message.metadata.images.length > 0 && <div className="flex gap-2 flex-wrap">
                        {message.metadata.images.map((image, imgIndex) => <img key={imgIndex} src={image} alt={`Reference ${imgIndex + 1}`} className="w-16 h-16 object-cover rounded-lg border border-white/20" />)}
                      </div>}
                  </div>
                </div>;
          } else {
            // AI message - try to parse for property results
            let searchResults: SearchResult | null = null;
            let displayContent = message.content;
            try {
              let jsonContent = message.content;

              // First try to parse - might be wrapped in { response: ... }
              const parsed = JSON.parse(message.content);

              // Check if it's wrapped in a response object
              if (parsed.response && typeof parsed.response === 'string') {
                jsonContent = parsed.response;
                // Try to parse the inner response as JSON
                try {
                  const innerParsed = JSON.parse(parsed.response);
                  if (innerParsed.results && Array.isArray(innerParsed.results)) {
                    searchResults = innerParsed;
                  } else {
                    displayContent = parsed.response;
                  }
                } catch {
                  displayContent = parsed.response;
                }
              } else if (parsed.results && Array.isArray(parsed.results)) {
                // Direct JSON with results
                searchResults = parsed;
              }
            } catch (e) {
              // Not JSON, treat as regular text
              // Clean up any JSON artifacts that might be visible
              if (message.content.includes('{"results":') || message.content.includes('"summary":')) {
                // Try one more time to extract JSON from the message
                const jsonMatch = message.content.match(/\{[\s\S]*"results"[\s\S]*\}/);
                if (jsonMatch) {
                  try {
                    const extracted = JSON.parse(jsonMatch[0]);
                    if (extracted.results && Array.isArray(extracted.results)) {
                      searchResults = extracted;
                    }
                  } catch {
                    displayContent = "I found some properties that match your preferences! Let me show you the results.";
                  }
                } else {
                  displayContent = "I found some properties that match your preferences! Let me show you the results.";
                }
              }
            }
            if (searchResults) {
              return <div key={index} className="flex justify-start animate-fade-in">
                    <div className="w-full space-y-4">
                      {searchResults.summary && <div className="bg-secondary text-secondary-foreground p-3 rounded-lg max-w-[85%] sm:max-w-[70%] md:max-w-[60%] w-fit">
                          <p className="text-sm text-left">{searchResults.summary}</p>
                        </div>}
                      
                           {searchResults.results.length > 0 && <div className="space-y-3">
                             {searchResults.results.map(property => <Card key={property.id} className="border-border hover:shadow-lg transition-all duration-200 cursor-pointer hover-scale" onClick={() => handlePropertyClick(property)}>
                                <CardContent className="p-3 sm:p-4">
                                  <div className="flex flex-col sm:flex-row gap-3 sm:gap-4">
                                    {/* Property Image - Bigger on mobile */}
                                    <div className="w-full h-48 sm:w-28 sm:h-28 md:w-32 md:h-32 rounded-lg overflow-hidden bg-muted flex-shrink-0 relative sm:order-1">
                                      {property.images && property.images.length > 0 ? <img src={property.images[0]} alt={property.title} className="w-full h-full object-cover" onError={e => {
                              const target = e.target as HTMLImageElement;
                              target.onerror = null;
                              const currentIndex = property.images.indexOf(target.src);
                              if (currentIndex < property.images.length - 1) {
                                target.src = property.images[currentIndex + 1];
                              } else {
                                target.style.display = 'none';
                                target.parentElement?.classList.add('fallback-active');
                              }
                            }} /> : <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-primary/10 to-primary/5">
                                          <Home className="h-8 w-8 sm:h-10 sm:w-10 text-muted-foreground" />
                                        </div>}
                                      {/* Fallback overlay for external properties */}
                                      {property.isExternal && (!property.images || property.images.length === 0) && <div className="absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-br from-primary/20 to-secondary/30">
                                          <Home className="h-10 w-10 text-primary mb-2" />
                                          <span className="text-xs text-muted-foreground font-medium">External Listing</span>
                                        </div>}
                                      {/* Match Score Overlay */}
                                      <div className="absolute top-2 left-2">
                                        <Badge className="bg-primary/90 text-primary-foreground border-none text-sm font-semibold px-2 py-1">
                                          {property.matchScore}% match
                                        </Badge>
                                      </div>
                                      {/* External Source Badge */}
                                      {property.isExternal && property.source && <div className="absolute bottom-2 left-2">
                                          <ExternalPropertyBadge source={property.source} sourceUrl={property.sourceUrl || undefined} cached={property.cached} crawledAt={property.crawledAt} />
                                        </div>}
                                      {/* Like Button - Mobile position */}
                                      <div className="absolute top-2 right-2 sm:hidden">
                                         <Button onClick={e => {
                                e.stopPropagation();
                                handleLikeProperty(property.id, property.realtor_id);
                              }} size="sm" variant={likedProperties.has(property.id) ? "default" : "ghost"} className={`h-8 w-8 p-0 ${likedProperties.has(property.id) ? "bg-orange-500 hover:bg-orange-600 text-white" : "bg-white/90 hover:bg-white text-orange-600 backdrop-blur"}`}>
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
                                            <span className="line-clamp-1">{translateLocationToEnglish(property.location)}</span>
                                          </div>
                                        </div>
                                        
                                         {/* Desktop buttons */}
                                         <div className="hidden sm:flex flex-col items-end gap-1">
                                            <Button onClick={e => {
                                  e.stopPropagation();
                                  handleLikeProperty(property.id, property.realtor_id);
                                }} size="sm" variant={likedProperties.has(property.id) ? "default" : "ghost"} className={`h-8 w-8 p-0 ${likedProperties.has(property.id) ? "bg-orange-500 hover:bg-orange-600 text-white" : "hover:bg-orange-50 text-orange-600"}`}>
                                             <Heart className={`h-4 w-4 ${likedProperties.has(property.id) ? "fill-current" : ""}`} />
                                           </Button>
                                         </div>
                                      </div>

                                       <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground mb-3">
                                         <div className="flex items-center">
                                           <span className="font-semibold text-foreground text-sm">{formatPrice(property.price)}</span>
                                         </div>
                                          {property.size && <span className="font-medium">{property.size}</span>}
                                        </div>

                                       {/* Amenities */}
                                       {(property.vibe_analysis?.amenities || property.amenities) && <PropertyAmenities amenities={property.vibe_analysis?.amenities || property.amenities || []} compact={true} />}

                                       {/* Why it matches - More prominent on mobile */}
                                      <div className="bg-secondary/10 p-3 rounded-lg mb-3 text-left px-0 py-0">
                                        <p className="text-sm text-foreground text-left">
                                          <span className="font-semibold text-primary">Why it matches: </span>
                                          {property.matchReason}
                                        </p>
                                      </div>

                                    </div>
                                  </div>
                                </CardContent>
                              </Card>)}
                           
                         </div>}
                    </div>
                  </div>;
            } else {
              // Regular text message - use cleaned content
              return <div key={index} className="flex justify-start animate-fade-in">
                    <div className="bg-secondary text-secondary-foreground p-3 rounded-lg max-w-[85%] sm:max-w-[70%] md:max-w-[60%] w-fit">
                      <p className="text-sm whitespace-pre-wrap text-justify">{displayContent}</p>
                     </div>
                   </div>;
            }
          }
        })}

          {/* Temporary user message for instant feedback - shows after all existing messages */}
          {tempUserMessageForLoggedIn && <div className="flex justify-end animate-fade-in">
              <div className="max-w-[80%] p-3 rounded-lg bg-primary text-primary-foreground space-y-2">
                <p className="text-sm text-left">{tempUserMessageForLoggedIn}</p>
                {tempUserImages.length > 0 && <div className="flex gap-2 flex-wrap">
                    {tempUserImages.map((image, index) => <img key={index} src={image} alt={`Reference ${index + 1}`} className="w-16 h-16 object-cover rounded-lg border border-white/20" />)}
                  </div>}
              </div>
            </div>}

          {/* AI Thinking Animation for Signed In Users */}
          {isSendingMessage && <div className="flex justify-start animate-fade-in">
              <div className="bg-secondary text-secondary-foreground p-3 rounded-lg">
                <div className="flex space-x-1">
                  <div className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{
                animationDelay: '0ms'
              }}></div>
                  <div className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{
                animationDelay: '150ms'
              }}></div>
                  <div className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{
                animationDelay: '300ms'
              }}></div>
                </div>
              </div>
            </div>}

        </div>}

      {/* Temporary Chat Messages for Non-Logged In Users */}
      {tempUserMessage && !user && <div className="space-y-4 mb-6 max-h-96 overflow-y-auto">
          {/* User Message */}
          <div className="flex justify-end animate-fade-in">
            <div className="max-w-[80%] p-3 rounded-lg bg-primary text-primary-foreground space-y-2">
              <p className="text-sm text-left">{tempUserMessage}</p>
              {tempUserImages.length > 0 && <div className="flex gap-2 flex-wrap">
                  {tempUserImages.map((image, index) => <img key={index} src={image} alt={`Reference ${index + 1}`} className="w-16 h-16 object-cover rounded-lg border border-white/20" />)}
                </div>}
            </div>
          </div>
          
          {/* AI Thinking Animation */}
          {isSearching && <div className="flex justify-start animate-fade-in">
              <div className="bg-secondary text-secondary-foreground p-3 rounded-lg">
                <div className="flex space-x-1">
                  <div className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{
                animationDelay: '0ms'
              }}></div>
                  <div className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{
                animationDelay: '150ms'
              }}></div>
                  <div className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{
                animationDelay: '300ms'
              }}></div>
                </div>
              </div>
            </div>}
        </div>}

      {/* Search Results for Non-Logged In Users */}
      {searchResults && !user && <div className="space-y-4 mb-6">
          <div className="flex justify-start animate-fade-in">
            <div className="w-full space-y-4">
              {searchResults.summary && <div className="bg-secondary text-secondary-foreground p-3 rounded-lg max-w-[85%] sm:max-w-[70%] md:max-w-[60%] w-fit">
                  <p className="text-sm text-left">{searchResults.summary}</p>
                </div>}
              
              {searchResults.results.length > 0 && <div className="space-y-3">
                  {searchResults.results.map(property => <Card key={property.id} className="border-border hover:shadow-lg transition-all duration-200 cursor-pointer hover-scale" onClick={() => handlePropertyClick(property)}>
                      <CardContent className="p-3 sm:p-4">
                        <div className="flex flex-col sm:flex-row gap-3 sm:gap-4">
                          {/* Property Image - Bigger on mobile */}
                          <div className="w-full h-48 sm:w-28 sm:h-28 md:w-32 md:h-32 rounded-lg overflow-hidden bg-muted flex-shrink-0 relative sm:order-1">
                            {property.images && property.images.length > 0 ? <img src={property.images[0]} alt={property.title} className="w-full h-full object-cover" onError={e => {
                        const target = e.target as HTMLImageElement;
                        target.onerror = null;
                        // Try next image if available
                        const currentIndex = property.images.indexOf(target.src);
                        if (currentIndex < property.images.length - 1) {
                          target.src = property.images[currentIndex + 1];
                        } else {
                          // Show fallback
                          target.style.display = 'none';
                          target.parentElement?.classList.add('fallback-active');
                        }
                      }} /> : <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-primary/10 to-primary/5">
                                <Home className="h-8 w-8 sm:h-10 sm:w-10 text-muted-foreground" />
                              </div>}
                            {/* Fallback overlay for external properties */}
                            {property.isExternal && (!property.images || property.images.length === 0) && <div className="absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-br from-primary/20 to-secondary/30">
                                <Home className="h-10 w-10 text-primary mb-2" />
                                <span className="text-xs text-muted-foreground font-medium">External Listing</span>
                              </div>}
                            {/* Match Score Overlay */}
                            <div className="absolute top-2 left-2">
                              <Badge className="bg-primary/90 text-primary-foreground border-none text-sm font-semibold px-2 py-1">
                                {property.matchScore}% match
                              </Badge>
                            </div>
                            {/* External Source Badge */}
                            {property.isExternal && property.source && <div className="absolute bottom-2 left-2">
                                <ExternalPropertyBadge source={property.source} sourceUrl={property.sourceUrl || undefined} cached={property.cached} crawledAt={property.crawledAt} />
                              </div>}
                            {/* Like Button - Mobile position */}
                            <div className="absolute top-2 right-2 sm:hidden">
                              <Button onClick={e => {
                          e.stopPropagation();
                          handleLikeProperty(property.id, property.realtor_id);
                        }} size="sm" variant={likedProperties.has(property.id) ? "default" : "ghost"} className={`h-8 w-8 p-0 ${likedProperties.has(property.id) ? "bg-orange-500 hover:bg-orange-600 text-white" : "bg-white/90 hover:bg-white text-orange-600 backdrop-blur"}`}>
                                <Heart className={`h-4 w-4 ${likedProperties.has(property.id) ? "fill-current" : ""}`} />
                              </Button>
                            </div>
                          </div>

                          {/* Property Details */}
                          <div className="flex-1 min-w-0 sm:order-2 text-left">
                            <div className="flex items-start justify-between mb-2">
                              <div className="flex-1 min-w-0 pr-2">
                                <h5 className="font-semibold text-foreground line-clamp-1 text-base sm:text-base text-left">{property.title}</h5>
                                <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
                                  <MapPin className="h-4 w-4 flex-shrink-0" />
                                  <span className="line-clamp-1">{translateLocationToEnglish(property.location)}</span>
                                </div>
                              </div>
                              
                               {/* Desktop buttons */}
                               <div className="hidden sm:flex flex-col items-end gap-1">
                                 <Button onClick={e => {
                            e.stopPropagation();
                            handleLikeProperty(property.id, property.realtor_id);
                          }} size="sm" variant={likedProperties.has(property.id) ? "default" : "ghost"} className={`h-8 w-8 p-0 ${likedProperties.has(property.id) ? "bg-orange-500 hover:bg-orange-600 text-white" : "hover:bg-orange-50 text-orange-600"}`}>
                                   <Heart className={`h-4 w-4 ${likedProperties.has(property.id) ? "fill-current" : ""}`} />
                                 </Button>
                               </div>
                            </div>

                             <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground mb-3">
                               <div className="flex items-center">
                                 <span className="font-semibold text-foreground text-sm">{formatPrice(property.price)}</span>
                               </div>
                               {property.size && <span className="font-medium">{property.size}</span>}
                             </div>

                             {/* Property Highlights */}
                             {property.highlights && property.highlights.length > 0 && <div className="mb-3">
                                 <HighlightTags highlights={property.highlights} maxWords={3} />
                               </div>}

                             {/* Amenities */}
                             {(property.vibe_analysis?.amenities || property.amenities) && <PropertyAmenities amenities={property.vibe_analysis?.amenities || property.amenities || []} compact={true} />}

                             {/* Why it matches - More prominent on mobile */}
                             <div className="bg-secondary/10 p-3 rounded-lg mb-3 text-left">
                               <p className="text-sm text-foreground text-left">
                                 <span className="font-semibold text-primary">Why it matches: </span>
                                 {property.matchReason}
                               </p>
                             </div>

                          </div>
                        </div>
                      </CardContent>
                    </Card>)}
                  
                  {/* Sign in CTA for Non-Logged In Users */}
                  <div className="bg-secondary/20 p-4 rounded-lg animate-fade-in text-center">
                    <Button onClick={() => navigate('/auth', {
                  state: {
                    returnTo: '/discover'
                  }
                })} className="bg-primary hover:bg-primary/90 text-primary-foreground px-8 py-2">
                      Sign in to chat more
                    </Button>
                  </div>
                </div>}
            </div>
          </div>
        </div>}


      {/* Chat Input - Show for everyone until they search */}
      {(user || !hasSearched) && <div className="space-y-4">
          <div className="relative">
            <Textarea value={query} onChange={e => setQuery(e.target.value)} onKeyDown={handleKeyPress} placeholder={typedPlaceholder} disabled={isSendingMessage || isSearching} className="min-h-[140px] pr-20 resize-none bg-transparent" />
          <div className="absolute bottom-3 right-3 flex gap-2">
            <input ref={fileInputRef} type="file" accept="image/*" multiple onChange={handleImageUpload} className="hidden" />
            <Button onClick={() => fileInputRef.current?.click()} disabled={isSendingMessage || isSearching || uploadedImages.length >= 3} size="sm" variant="outline" className="h-8 w-8 p-0">
              <Upload className="h-4 w-4" />
            </Button>
            <Button onClick={() => handleSearch()} disabled={isSendingMessage || isSearching || !query.trim() && uploadedImages.length === 0} size="sm" className="h-8 w-8 p-0">
              {isSendingMessage || isSearching ? <Send className="h-4 w-4" /> : <PlaneTakeoff className="h-4 w-4" />}
            </Button>
          </div>
        </div>

        {/* Image Preview */}
        {uploadedImages.length > 0 && <div className="flex gap-2 flex-wrap animate-fade-in">
            {uploadedImages.map((image, index) => <div key={index} className="relative">
                <img src={URL.createObjectURL(image)} alt={`Upload ${index + 1}`} className="w-16 h-16 object-cover rounded-lg border border-border" />
                <Button onClick={() => removeImage(index)} size="sm" variant="destructive" className="absolute -top-2 -right-2 h-5 w-5 p-0 rounded-full">
                  <X className="h-3 w-3" />
                </Button>
              </div>)}
          </div>}

        </div>}

      {/* Property Detail Modal */}
      <PropertyDetailModal apartment={selectedProperty ? {
        id: selectedProperty.id,
        title: selectedProperty.title,
        location: selectedProperty.location,
        price: selectedProperty.price,
        size: selectedProperty.size,
        vibe: selectedProperty.vibe,
        description: selectedProperty.description,
        highlights: selectedProperty.highlights,
        images: selectedProperty.images,
        amenities: selectedProperty.vibe_analysis?.amenities || selectedProperty.amenities || [],
        realtor: {
          id: selectedProperty.realtor_id || "contact",
          name: "Match for contact details",
          phone: "",
          email: ""
        },
        vibe_analysis: selectedProperty.vibe_analysis
      } : null} userPreferences={userPreferences} isOpen={showPropertyModal} onClose={() => {
        setShowPropertyModal(false);
        setSelectedProperty(null);
      }} onLike={selectedProperty ? () => handleLikeProperty(selectedProperty.id, selectedProperty.realtor_id) : undefined} isAnonymous={!user} />
      </div>
    </div>;
};