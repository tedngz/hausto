import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Loader2, Send, MapPin, Home, DollarSign, ArrowRight, Sparkles, Upload, X, MessageSquare, Plus, History, PlaneTakeoff, Heart } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useCurrency } from '@/contexts/CurrencyContext';
import { useToast } from '@/components/ui/use-toast';
import { PropertyDetailModal } from '@/components/PropertyDetailModal';
import { useUsageTracking } from '@/hooks/useUsageTracking';
import { useMatches } from '@/hooks/useMatches';
import { SubscriptionModal } from '@/components/SubscriptionModal';
import { calculateVibeScore } from '@/utils/vibeScoring';
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

interface ChatSession {
  id: string;
  title: string;
  timestamp: Date;
  messages: Array<{
    type: 'user' | 'ai';
    content: string;
    images?: File[];
    results?: SearchResult;
  }>;
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
  const [chatSessions, setChatSessions] = useState<ChatSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string>('');
  const [showHistory, setShowHistory] = useState(false);
  const [messages, setMessages] = useState<ChatSession['messages']>([]);
  const [searchCount, setSearchCount] = useState(0);
  const [likedProperties, setLikedProperties] = useState<Set<string>>(new Set());
  const [allResults, setAllResults] = useState<PropertyMatch[]>([]);
  const [showSubscriptionModal, setShowSubscriptionModal] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const { formatPrice } = useCurrency();
  const { toast } = useToast();
  const { canPerformAction, updateUsage } = useUsageTracking();
  const { createMatch } = useMatches();

  // Initialize first chat session
  useEffect(() => {
    if (!currentSessionId) {
      const newSessionId = `session-${Date.now()}`;
      setCurrentSessionId(newSessionId);
      const newSession: ChatSession = {
        id: newSessionId,
        title: 'New Chat',
        timestamp: new Date(),
        messages: []
      };
      setChatSessions([newSession]);
    }
  }, [currentSessionId]);

  // Load stored sessions
  useEffect(() => {
    const storedSessions = localStorage.getItem('aiChatSessions');
    if (storedSessions) {
      const sessions = JSON.parse(storedSessions);
      setChatSessions(sessions);
      if (sessions.length > 0 && !currentSessionId) {
        setCurrentSessionId(sessions[0].id);
        setMessages(sessions[0].messages);
      }
    }
  }, []);

  // Save sessions to localStorage
  useEffect(() => {
    if (chatSessions.length > 0) {
      localStorage.setItem('aiChatSessions', JSON.stringify(chatSessions));
    }
  }, [chatSessions]);

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
    const newSessionId = `session-${Date.now()}`;
    const newSession: ChatSession = {
      id: newSessionId,
      title: 'New Chat',
      timestamp: new Date(),
      messages: []
    };
    setChatSessions(prev => [newSession, ...prev]);
    setCurrentSessionId(newSessionId);
    setMessages([]);
    setQuery('');
    setUploadedImages([]);
    setSearchResults(null);
    setAllResults([]);
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
      
      console.log('Creating match for property:', propertyId, 'with realtor:', actualRealtorId);
      
      if (actualRealtorId) {
        await createMatch(propertyId, actualRealtorId);
        toast({
          title: "Property liked!",
          description: "Added to your matches"
        });
      } else {
        console.error('No realtor ID found for property:', propertyId);
        toast({
          title: "Error",
          description: "Could not create match - realtor information missing",
          variant: "destructive"
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

  const switchToSession = (sessionId: string) => {
    const session = chatSessions.find(s => s.id === sessionId);
    if (session) {
      setCurrentSessionId(sessionId);
      setMessages(session.messages);
      const lastUserMessage = session.messages.filter(m => m.type === 'user').pop();
      const lastAiMessage = session.messages.filter(m => m.type === 'ai').pop();
      if (lastAiMessage?.results) {
        setSearchResults(lastAiMessage.results);
      }
    }
    setShowHistory(false);
  };

  const updateCurrentSession = (newMessages: ChatSession['messages']) => {
    setChatSessions(prev => prev.map(session => 
      session.id === currentSessionId 
        ? { 
            ...session, 
            messages: newMessages,
            title: newMessages.length > 0 
              ? newMessages[0].content.slice(0, 30) + (newMessages[0].content.length > 30 ? '...' : '')
              : 'New Chat'
          }
        : session
    ));
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

    setIsSearching(true);
    setSearchResults(null);

    // Add user message
    const userMessage = {
      type: 'user' as const,
      content: queryToUse,
      images: uploadedImages.length > 0 ? [...uploadedImages] : undefined
    };
    
    const updatedMessages = [...messages, userMessage];
    setMessages(updatedMessages);

    try {
      let searchBody: any = { query: queryToUse.trim() };

      if (uploadedImages.length > 0) {
        const imageData = await Promise.all(
          uploadedImages.map(async (file) => ({
            name: file.name,
            data: await convertImageToBase64(file)
          }))
        );
        searchBody.images = imageData;
        
        if (!queryToUse.trim()) {
          searchBody.query = "Find similar apartments to the uploaded images";
        }
      }

      const { data, error } = await supabase.functions.invoke('ai-property-search', {
        body: searchBody
      });

      if (error) {
        throw error;
      }

      setSearchResults(data);
      
      // Update AI search usage
      await updateUsage('ai-search');
      
      // Add new results to all results
      if (data.results && data.results.length > 0) {
        setAllResults(prev => {
          const existing = new Map(prev.map(p => [p.id, p]));
          data.results.forEach((p: PropertyMatch) => existing.set(p.id, p));
          return Array.from(existing.values());
        });
      }
      
      // Add AI response message
      const aiMessage = {
        type: 'ai' as const,
        content: data.summary || 'Here are the properties I found for you:',
        results: data
      };

      const finalMessages = [...updatedMessages, aiMessage];
      setMessages(finalMessages);
      updateCurrentSession(finalMessages);
      
      if (data.results && data.results.length > 0) {
        toast({
          title: "Found matches!",
          description: `We found ${data.totalMatches} properties that might be perfect for you.`,
        });
      } else {
        toast({
          title: "No matches found",
          description: "Try describing different preferences or browse all properties",
        });
      }
    } catch (error) {
      console.error('Search error:', error);
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
          {/* Floating buttons outside the box */}
          <div className="absolute -top-2 right-0 flex gap-2 z-10">
            <Button
              onClick={() => setShowHistory(!showHistory)}
              variant="outline"
              size="sm"
              className="flex items-center gap-2 bg-card shadow-md"
            >
              <History className="h-4 w-4" />
              History
            </Button>
            <Button
              onClick={createNewChat}
              variant="outline"
              size="sm"
              className="flex items-center gap-2 bg-card shadow-md"
            >
              <Plus className="h-4 w-4" />
              New Chat
            </Button>
          </div>

          <div className="w-full p-6 bg-card border border-border rounded-2xl shadow-xl">
            {/* Header */}
            <div className="text-center mb-6">
              <div className="flex justify-center mb-4">
                <div className="relative">
                  <div className="absolute inset-0 bg-primary/20 rounded-full blur-lg"></div>
                  <div className="relative bg-primary/10 p-3 rounded-full">
                    <Sparkles className="h-8 w-8 text-primary" />
                  </div>
                </div>
              </div>
              <h3 className="text-2xl font-bold text-foreground mb-2">AI Property Assistant</h3>
              <p className="text-muted-foreground">
                Describe your dream home or upload reference images
              </p>
              {/* Remove the hardcoded search count display */}
            </div>

            {/* Chat History Dropdown */}
            {showHistory && (
              <Card className="mb-6 border-border">
                <CardContent className="p-4">
                  <div className="space-y-2 max-h-60 overflow-y-auto">
                    {chatSessions.map((session) => (
                      <div
                        key={session.id}
                        onClick={() => switchToSession(session.id)}
                        className={`p-3 rounded-lg cursor-pointer transition-colors ${
                          session.id === currentSessionId 
                            ? 'bg-primary/10 border border-primary/20' 
                            : 'hover:bg-secondary/50'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <MessageSquare className="h-4 w-4 text-muted-foreground" />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{session.title}</p>
                            <p className="text-xs text-muted-foreground">
                              {new Date(session.timestamp).toLocaleDateString()}
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
                {messages.map((message, index) => (
                  <div key={index} className={`flex ${message.type === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[80%] p-3 rounded-lg ${
                      message.type === 'user' 
                        ? 'bg-primary text-primary-foreground' 
                        : 'bg-secondary text-secondary-foreground'
                    }`}>
                      <p className="text-sm">{message.content}</p>
                      {message.images && message.images.length > 0 && (
                        <div className="flex gap-2 mt-2">
                          {message.images.map((image, imgIndex) => (
                            <img
                              key={imgIndex}
                              src={image instanceof File ? URL.createObjectURL(image) : ''}
                              alt={`Upload ${imgIndex + 1}`}
                              className="w-12 h-12 object-cover rounded"
                            />
                          ))}
                        </div>
                      )}
                      {message.results && message.results.results.length > 0 && (
                        <div className="mt-2 text-xs">
                          Found {message.results.totalMatches} matching properties
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Chat Input */}
            <div className="space-y-4">
              <div className="relative">
                <Textarea
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={handleKeyPress}
                  placeholder="I'm looking for a modern apartment with city views, close to cafes and markets. I love minimalist design and need good natural light..."
                  className="min-h-[100px] pr-20 resize-none"
                  disabled={isSearching}
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
                    disabled={isSearching || uploadedImages.length >= 3}
                    size="sm"
                    variant="outline"
                    className="h-8 w-8 p-0"
                  >
                    <Upload className="h-4 w-4" />
                  </Button>
                  <Button
                    onClick={() => handleSearch()}
                    disabled={isSearching || (!query.trim() && uploadedImages.length === 0)}
                    size="sm"
                    className="h-8 w-8 p-0"
                  >
                    {isSearching ? (
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

              {/* Search Results */}
              {searchResults && (
                <div className="space-y-4">
                  {/* Property Results */}
                  {searchResults.results.length > 0 ? (
                    <div className="space-y-3">
                      <h4 className="font-semibold text-foreground">Top Matches for You:</h4>
                      <div className="grid gap-3 sm:grid-cols-1">
                        {searchResults.results.map((property) => (
                          <Card 
                            key={property.id} 
                            className="border-border hover:shadow-lg transition-all duration-200 cursor-pointer"
                            onClick={() => handlePropertyClick(property)}
                          >
                            <CardContent className="p-3 sm:p-4">
                              <div className="flex gap-3 sm:gap-4">
                                {/* Property Image */}
                                <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-lg overflow-hidden bg-muted flex-shrink-0">
                                  {property.images && property.images.length > 0 ? (
                                    <img 
                                      src={property.images[0]} 
                                      alt={property.title}
                                      className="w-full h-full object-cover"
                                    />
                                  ) : (
                                    <div className="w-full h-full flex items-center justify-center">
                                      <Home className="h-6 w-6 sm:h-8 sm:w-8 text-muted-foreground" />
                                    </div>
                                  )}
                                </div>

                                 {/* Property Details */}
                                 <div className="flex-1 min-w-0">
                                   <div className="flex items-start justify-between mb-2">
                                     <div className="flex-1 min-w-0 pr-2">
                                       <h5 className="font-semibold text-foreground line-clamp-1 text-sm sm:text-base">{property.title}</h5>
                                       <div className="flex items-center gap-2 text-xs sm:text-sm text-muted-foreground mb-1">
                                         <MapPin className="h-3 w-3 flex-shrink-0" />
                                         <span className="line-clamp-1">{property.location}</span>
                                       </div>
                                     </div>
                                      <div className="flex items-center gap-2">
                                        <Badge variant="secondary" className="bg-primary/10 text-primary border-primary/20 text-xs">
                                          {property.matchScore}% match
                                        </Badge>
                                        {userPreferences && (
                                          <Badge variant="outline" className="bg-secondary/50 border-secondary text-xs">
                                            {Math.round(calculateVibeScore({
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
                                            }, userPreferences).overall)}% vibe
                                          </Badge>
                                        )}
                          <Button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleLikeProperty(property.id);
                            }}
                           size="sm"
                           variant={likedProperties.has(property.id) ? "default" : "outline"}
                           className={`h-7 w-7 p-0 ${
                             likedProperties.has(property.id) 
                               ? 'bg-red-500 hover:bg-red-600 text-white' 
                               : 'hover:bg-red-50 hover:text-red-500'
                           }`}
                         >
                           <Heart className={`h-3 w-3 ${likedProperties.has(property.id) ? 'fill-current' : ''}`} />
                         </Button>
                                      </div>
                                   </div>

                                   <div className="flex flex-wrap items-center gap-2 sm:gap-4 text-xs sm:text-sm text-muted-foreground mb-2">
                                     <div className="flex items-center gap-1">
                                       <DollarSign className="h-3 w-3" />
                                       <span className="font-medium text-foreground">{formatPrice(property.price)}</span>
                                     </div>
                                     {property.size && (
                                       <span>{property.size}</span>
                                     )}
                                     {property.vibe && (
                                       <Badge variant="outline" className="text-xs">{property.vibe}</Badge>
                                     )}
                                   </div>

                                   <p className="text-xs text-muted-foreground line-clamp-2 mb-2">
                                     <strong>Why it matches:</strong> {property.matchReason}
                                   </p>

                                   {/* Property Highlights */}
                                   {property.highlights && property.highlights.length > 0 && (
                                     <div className="flex flex-wrap gap-1">
                                       {property.highlights.slice(0, 2).map((highlight, index) => (
                                         <Badge key={index} variant="outline" className="text-xs">
                                           {highlight}
                                         </Badge>
                                       ))}
                                       {property.highlights.length > 2 && (
                                         <Badge variant="outline" className="text-xs">
                                           +{property.highlights.length - 2} more
                                         </Badge>
                                       )}
                                     </div>
                                   )}
                                 </div>
                              </div>
                            </CardContent>
                          </Card>
                        ))}
                      </div>

                      {/* Browse All Button */}
                      <div className="text-center pt-4">
                        <Button 
                          onClick={handleBrowseAll}
                          variant="outline"
                          className="border-primary text-primary hover:bg-primary hover:text-primary-foreground"
                        >
                          Explore All Properties
                          <ArrowRight className="ml-2 h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="text-center py-6">
                      <p className="text-muted-foreground mb-4">
                        No properties match your specific criteria, but don't worry!
                      </p>
                      <Button 
                        onClick={handleBrowseAll}
                        className="bg-primary hover:bg-primary/90 text-primary-foreground"
                      >
                        Browse All Properties
                        <ArrowRight className="ml-2 h-4 w-4" />
                      </Button>
                    </div>
                  )}
                </div>
              )}

              {/* All Previous Results */}
              {allResults.length > 0 && !searchResults && (
                <div className="space-y-4">
                  <h4 className="font-semibold text-foreground">All Your Previous Matches:</h4>
                  <div className="grid gap-3 sm:grid-cols-1 max-h-96 overflow-y-auto">
                    {allResults.map((property) => (
                      <Card 
                        key={property.id} 
                        className="border-border hover:shadow-lg transition-all duration-200 cursor-pointer"
                        onClick={() => handlePropertyClick(property)}
                      >
                        <CardContent className="p-3 sm:p-4">
                          <div className="flex gap-3 sm:gap-4">
                            {/* Property Image */}
                            <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-lg overflow-hidden bg-muted flex-shrink-0">
                              {property.images && property.images.length > 0 ? (
                                <img 
                                  src={property.images[0]} 
                                  alt={property.title}
                                  className="w-full h-full object-cover"
                                />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center">
                                  <Home className="h-6 w-6 sm:h-8 sm:w-8 text-muted-foreground" />
                                </div>
                              )}
                            </div>

                            {/* Property Details */}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-start justify-between mb-2">
                                <div className="flex-1 min-w-0 pr-2">
                                  <h5 className="font-semibold text-foreground line-clamp-1 text-sm sm:text-base">{property.title}</h5>
                                  <div className="flex items-center gap-2 text-xs sm:text-sm text-muted-foreground mb-1">
                                    <MapPin className="h-3 w-3 flex-shrink-0" />
                                    <span className="line-clamp-1">{property.location}</span>
                                  </div>
                                </div>
                                 <div className="flex items-center gap-2">
                                   <Badge variant="secondary" className="bg-primary/10 text-primary border-primary/20 text-xs">
                                     {property.matchScore}% match
                                   </Badge>
                                   {userPreferences && (
                                     <Badge variant="outline" className="bg-secondary/50 border-secondary text-xs">
                                       {Math.round(calculateVibeScore({
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
                                       }, userPreferences).overall)}% vibe
                                     </Badge>
                                   )}
                                     <Button
                                       onClick={(e) => {
                                         e.stopPropagation();
                                         handleLikeProperty(property.id);
                                       }}
                                      size="sm"
                                      variant={likedProperties.has(property.id) ? "default" : "outline"}
                                      className={`h-7 w-7 p-0 ${
                                        likedProperties.has(property.id) 
                                          ? 'bg-red-500 hover:bg-red-600 text-white' 
                                          : 'hover:bg-red-50 hover:text-red-500'
                                      }`}
                                    >
                                      <Heart className={`h-3 w-3 ${likedProperties.has(property.id) ? 'fill-current' : ''}`} />
                                    </Button>
                                 </div>
                              </div>

                              <div className="flex flex-wrap items-center gap-2 sm:gap-4 text-xs sm:text-sm text-muted-foreground mb-2">
                                <div className="flex items-center gap-1">
                                  <DollarSign className="h-3 w-3" />
                                  <span className="font-medium text-foreground">{formatPrice(property.price)}</span>
                                </div>
                                {property.size && (
                                  <span>{property.size}</span>
                                )}
                                {property.vibe && (
                                  <Badge variant="outline" className="text-xs">{property.vibe}</Badge>
                                )}
                              </div>

                              <p className="text-xs text-muted-foreground line-clamp-2 mb-2">
                                <strong>Why it matches:</strong> {property.matchReason}
                              </p>

                              {/* Property Highlights */}
                              {property.highlights && property.highlights.length > 0 && (
                                <div className="flex flex-wrap gap-1">
                                  {property.highlights.slice(0, 2).map((highlight, index) => (
                                    <Badge key={index} variant="outline" className="text-xs">
                                      {highlight}
                                    </Badge>
                                  ))}
                                  {property.highlights.length > 2 && (
                                    <Badge variant="outline" className="text-xs">
                                      +{property.highlights.length - 2} more
                                    </Badge>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
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