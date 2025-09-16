import { useState, useEffect, useRef, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Loader2, Send, MapPin, Home, DollarSign, Upload, X, MessageSquare, Plus, History, PlaneTakeoff, Heart } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useCurrency } from '@/contexts/CurrencyContext';
import { useToast } from '@/components/ui/use-toast';
import { PropertyDetailModal } from '@/components/PropertyDetailModal';
import { calculateVibeScore } from '@/utils/vibeScoring';
import { VibeScore } from '@/components/VibeScore';
import { HighlightTags } from '@/components/HighlightTags';
import { UserPreferences } from '@/types';
import { useChat } from '@/hooks/useChat';
import { useAuth } from '@/hooks/useAuth';
import { useMatches } from '@/hooks/useMatches';
import { useUsageTracking } from '@/hooks/useUsageTracking';
import { supabase } from '@/integrations/supabase/client';
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
interface LandingChatBoxProps {
  userPreferences?: UserPreferences;
}
export const LandingChatBox = ({
  userPreferences
}: LandingChatBoxProps) => {
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
  const [typedPlaceholder, setTypedPlaceholder] = useState('');
  const [hasSearched, setHasSearched] = useState(false);
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
    updateUsage
  } = useUsageTracking();

  // Use the proper chat hook for database-backed conversations
  const {
    conversations,
    messages,
    currentConversationId,
    setCurrentConversationId,
    createConversation,
    isCreatingConversation,
    sendMessage,
    isSendingMessage
  } = useChat();

  // Typing effect for placeholder
  const fullPlaceholder = "I'm looking for a modern apartment with city views, close to cafes and markets. I love minimalist design and need good natural light...";
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

  // Initialize first conversation if needed - load existing conversation with messages first
  useEffect(() => {
    if (user && conversations.length > 0) {
      // If no current conversation is selected, find the most recent one with messages
      if (!currentConversationId) {
        // Try to find a conversation with messages by checking each one
        const findConversationWithMessages = async () => {
          for (const conversation of conversations) {
            const {
              data: conversationMessages
            } = await supabase.from('chat_messages').select('id').eq('conversation_id', conversation.id).limit(1);
            if (conversationMessages && conversationMessages.length > 0) {
              setCurrentConversationId(conversation.id);
              return;
            }
          }
          // If no conversation has messages, use the most recent one or create new
          if (conversations.length > 0) {
            setCurrentConversationId(conversations[0].id);
          } else {
            createConversation('AI Property Search');
          }
        };
        findConversationWithMessages();
      }
    } else if (user && conversations.length === 0) {
      // Only create a new conversation if the user has no conversations at all
      createConversation('AI Property Search');
    }
  }, [user, conversations, currentConversationId, createConversation, setCurrentConversationId]);

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
    createConversation('New Search');
    setQuery('');
    setUploadedImages([]);
    setSearchResults(null);
    setShowHistory(false);
  };
  const switchToConversation = async (conversationId: string) => {
    setCurrentConversationId(conversationId);
    setShowHistory(false);

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
      // Store query for after login
      localStorage.setItem('pendingSearchQuery', query);
      navigate('/auth', {
        state: {
          returnTo: '/'
        }
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
        const {
          data: propertyData
        } = await supabase.from('properties').select('realtor_id').eq('id', propertyId).single();
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
  const handleSearch = async (searchQuery?: string) => {
    const queryToUse = searchQuery || query;

    // Check if user has already searched (1 search limit for all users)
    if (hasSearched) {
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

      // Send message using the chat hook for logged in users
      const messageData = {
        message: queryToUse,
        conversationId: currentConversationId!,
        userType: 'renter' as const,
        userPreferences,
        propertyImages: uploadedImages.length > 0 ? await Promise.all(uploadedImages.map(async file => await convertImageToBase64(file))) : []
      };
      try {
        // Update conversation title with the user's request content (first 50 chars)
        const titleFromMessage = queryToUse.length > 50 ? queryToUse.substring(0, 47) + '...' : queryToUse;
        await supabase.from('chat_conversations').update({
          title: titleFromMessage
        }).eq('id', currentConversationId!);

        // Send message to AI chat
        sendMessage(messageData);

        // Update AI search usage
        await updateUsage('ai-search');
        setHasSearched(true);
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
      } finally {
        setQuery('');
        setUploadedImages([]);
        // Clear temporary message after a short delay to let the real message appear
        setTimeout(() => setTempUserMessageForLoggedIn(null), 1000);
      }
    } else {
      // Handle search for anonymous users - call AI chat directly
      setTempUserMessage(queryToUse); // Show user message immediately
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
  const handlePropertyClick = (property: PropertyMatch) => {
    setSelectedProperty(property);
    setShowPropertyModal(true);
  };
  return <div className="w-full max-w-4xl mx-auto p-6 shadow-xl bg-transparent rounded-md">
      {/* Header */}
      <div className="text-center mb-6 relative">
        
        {/* History and New Chat buttons - positioned to avoid text overlap */}
        {user && <div className="absolute -top-5 right-0 flex gap-2 z-10 py-0 px-[2px] mx-px my-0">
            <Button onClick={() => setShowHistory(!showHistory)} variant="ghost" size="sm" className="h-8 w-8 p-0 hover:bg-secondary/50">
              <History className="h-4 w-4" />
            </Button>
            <Button onClick={createNewChat} variant="ghost" size="sm" className="h-8 w-8 p-0 hover:bg-secondary/50">
              <Plus className="h-4 w-4" />
            </Button>
          </div>}
        
        
      </div>

      {/* Chat History Dropdown */}
      {showHistory && user && <Card className="mb-6 border-border">
          <CardContent className="p-4">
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {conversations.map(conversation => <div key={conversation.id} onClick={() => switchToConversation(conversation.id)} className={`p-3 rounded-lg cursor-pointer transition-colors ${conversation.id === currentConversationId ? 'bg-primary/10 border border-primary/20' : 'hover:bg-secondary/50'}`}>
                  <div className="flex items-center gap-2">
                    <MessageSquare className="h-4 w-4 text-muted-foreground" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{conversation.title || 'New Search'}</p>
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
                </div>)}
            </div>
          </CardContent>
        </Card>}

      {/* Chat Messages */}
      {(messages.length > 0 || tempUserMessageForLoggedIn) && user && <div className="space-y-4 mb-6 max-h-96 overflow-y-auto">
          {/* Temporary user message for instant feedback */}
          {tempUserMessageForLoggedIn && <div className="flex justify-end animate-fade-in">
              <div className="max-w-[80%] p-3 rounded-lg bg-primary text-primary-foreground">
                <p className="text-sm text-left">{tempUserMessageForLoggedIn}</p>
              </div>
            </div>}
          
          {messages.map((message, index) => {
        if (message.role === 'user') {
          return <div key={index} className="flex justify-end animate-fade-in">
                  <div className="max-w-[80%] p-3 rounded-lg bg-primary text-primary-foreground">
                    <p className="text-sm text-left">{message.content}</p>
                  </div>
                </div>;
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
              displayContent = "I found some amazing properties that match your preferences! Let me show you the top matches.";
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
                                      {property.images && property.images.length > 0 ? <img src={property.images[0]} alt={property.title} className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center">
                                          <Home className="h-8 w-8 sm:h-10 sm:w-10 text-muted-foreground" />
                                        </div>}
                                      {/* Match Score Overlay */}
                                      <div className="absolute top-2 left-2">
                                        <Badge className="bg-primary/90 text-primary-foreground border-none text-sm font-semibold px-2 py-1">
                                          {property.matchScore}% match
                                        </Badge>
                                      </div>
                                      {/* Like Button - Mobile position */}
                                      <div className="absolute top-2 right-2 sm:hidden">
                                        <Button onClick={e => {
                              e.stopPropagation();
                              handleLikeProperty(property.id, property.realtor_id);
                            }} size="sm" variant={likedProperties.has(property.id) ? "default" : "ghost"} className={`h-8 w-8 p-0 ${likedProperties.has(property.id) ? "bg-green-500 hover:bg-green-600 text-white" : "bg-white/90 hover:bg-white text-green-600 backdrop-blur"}`}>
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
                                          <Button onClick={e => {
                                e.stopPropagation();
                                handleLikeProperty(property.id, property.realtor_id);
                              }} size="sm" variant={likedProperties.has(property.id) ? "default" : "ghost"} className={`h-8 w-8 p-0 ${likedProperties.has(property.id) ? "bg-green-500 hover:bg-green-600 text-white" : "hover:bg-green-50 text-green-600"}`}>
                                            <Heart className={`h-4 w-4 ${likedProperties.has(property.id) ? "fill-current" : ""}`} />
                                          </Button>
                                          
                                          {userPreferences && <VibeScore score={calculateVibeScore({
                                id: property.id,
                                images: property.images,
                                title: property.title,
                                location: property.location,
                                price: property.price,
                                size: property.size,
                                vibe: property.vibe,
                                description: property.description,
                                highlights: property.highlights,
                                realtor: {
                                  id: '',
                                  name: '',
                                  phone: '',
                                  email: ''
                                },
                                vibe_analysis: property.vibe_analysis
                              }, userPreferences)} size="sm" />}
                                        </div>
                                      </div>

                                      <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground mb-3">
                                        <div className="flex items-center">
                                          <span className="font-semibold text-foreground text-sm">{formatPrice(property.price)}</span>
                                        </div>
                                        {property.size && <span className="font-medium">{property.size}</span>}
                                        {property.vibe && <Badge variant="outline" className="text-xs">{property.vibe}</Badge>}
                                      </div>

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
                           
                         </div>}
                    </div>
                  </div>;
          } else {
            // Regular text message - use cleaned content
            return <div key={index} className="flex justify-start animate-fade-in">
                    <div className="bg-secondary text-secondary-foreground p-3 rounded-lg max-w-[85%] sm:max-w-[70%] md:max-w-[60%] w-fit">
                      <p className="text-sm whitespace-pre-wrap">{displayContent}</p>
                     </div>
                   </div>;
          }
        }
      })}

          {/* Continue to AI Chat CTA for Signed In Users after search */}
          {user && hasSearched && <div className="bg-secondary/20 p-4 rounded-lg animate-fade-in text-center">
              <Button onClick={() => navigate('/discover')} className="bg-primary hover:bg-primary/90 text-primary-foreground px-8 py-2">
                Continue to AI Chat View
              </Button>
            </div>}
          
          {/* AI Thinking Animation */}
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
            <div className="max-w-[80%] p-3 rounded-lg bg-primary text-primary-foreground">
              <p className="text-sm text-left">{tempUserMessage}</p>
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
                            {property.images && property.images.length > 0 ? <img src={property.images[0]} alt={property.title} className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center">
                                <Home className="h-8 w-8 sm:h-10 sm:w-10 text-muted-foreground" />
                              </div>}
                            {/* Match Score Overlay */}
                            <div className="absolute top-2 left-2">
                              <Badge className="bg-primary/90 text-primary-foreground border-none text-sm font-semibold px-2 py-1">
                                {property.matchScore}% match
                              </Badge>
                            </div>
                            {/* Like Button - Mobile position */}
                            <div className="absolute top-2 right-2 sm:hidden">
                              <Button onClick={e => {
                        e.stopPropagation();
                        handleLikeProperty(property.id, property.realtor_id);
                      }} size="sm" variant={likedProperties.has(property.id) ? "default" : "ghost"} className={`h-8 w-8 p-0 ${likedProperties.has(property.id) ? "bg-green-500 hover:bg-green-600 text-white" : "bg-white/90 hover:bg-white text-green-600 backdrop-blur"}`}>
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
                                  <span className="line-clamp-1">{property.location}</span>
                                </div>
                              </div>
                              
                              {/* Desktop buttons */}
                              <div className="hidden sm:flex flex-col items-end gap-1">
                                <Button onClick={e => {
                          e.stopPropagation();
                          handleLikeProperty(property.id, property.realtor_id);
                        }} size="sm" variant={likedProperties.has(property.id) ? "default" : "ghost"} className={`h-8 w-8 p-0 ${likedProperties.has(property.id) ? "bg-green-500 hover:bg-green-600 text-white" : "hover:bg-green-50 text-green-600"}`}>
                                  <Heart className={`h-4 w-4 ${likedProperties.has(property.id) ? "fill-current" : ""}`} />
                                </Button>
                                
                                {userPreferences && <VibeScore score={calculateVibeScore({
                          id: property.id,
                          images: property.images,
                          title: property.title,
                          location: property.location,
                          price: property.price,
                          size: property.size,
                          vibe: property.vibe,
                          description: property.description,
                          highlights: property.highlights,
                          realtor: {
                            id: '',
                            name: '',
                            phone: '',
                            email: ''
                          },
                          vibe_analysis: property.vibe_analysis
                        }, userPreferences)} size="sm" />}
                              </div>
                            </div>

                            <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground mb-3">
                              <div className="flex items-center">
                                <span className="font-semibold text-foreground text-sm">{formatPrice(property.price)}</span>
                              </div>
                              {property.size && <span className="font-medium">{property.size}</span>}
                              {property.vibe && <Badge variant="outline" className="text-xs">{property.vibe}</Badge>}
                            </div>

                            {/* Property Highlights */}
                            {property.highlights && property.highlights.length > 0 && <div className="mb-3">
                                <HighlightTags highlights={property.highlights} maxWords={3} />
                              </div>}

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


      {/* Chat Input - Only show if hasn't searched yet */}
      {!hasSearched && <div className="space-y-4">
          <div className="relative">
            <Textarea value={query} onChange={e => setQuery(e.target.value)} onKeyDown={handleKeyPress} placeholder={typedPlaceholder} disabled={isSendingMessage} className="min-h-[100px] pr-20 resize-none bg-transparent" />
          <div className="absolute bottom-3 right-3 flex gap-2">
            <input ref={fileInputRef} type="file" accept="image/*" multiple onChange={handleImageUpload} className="hidden" />
            <Button onClick={() => fileInputRef.current?.click()} disabled={isSendingMessage || uploadedImages.length >= 3} size="sm" variant="outline" className="h-8 w-8 p-0">
              <Upload className="h-4 w-4" />
            </Button>
            <Button onClick={() => handleSearch()} disabled={isSendingMessage || !query.trim() && uploadedImages.length === 0} size="sm" className="h-8 w-8 p-0">
              {isSendingMessage ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlaneTakeoff className="h-4 w-4" />}
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
      realtor: {
        id: "contact",
        name: "Contact for details",
        phone: "",
        email: ""
      },
      vibe_analysis: selectedProperty.vibe_analysis
    } : null} userPreferences={userPreferences} isOpen={showPropertyModal} onClose={() => {
      setShowPropertyModal(false);
      setSelectedProperty(null);
    }} onLike={selectedProperty ? () => handleLikeProperty(selectedProperty.id, selectedProperty.realtor_id) : undefined} />
    </div>;
};