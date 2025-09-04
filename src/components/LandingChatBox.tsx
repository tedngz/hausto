import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Loader2, Send, MapPin, Home, DollarSign, ArrowRight, Sparkles, Upload, X } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useCurrency } from '@/contexts/CurrencyContext';
import { useToast } from '@/components/ui/use-toast';
import { PropertyDetailModal } from '@/components/PropertyDetailModal';
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
}

interface SearchResult {
  results: PropertyMatch[];
  summary: string;
  totalMatches: number;
}

export const LandingChatBox = () => {
  const [query, setQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResult | null>(null);
  const [showAuthPrompt, setShowAuthPrompt] = useState(false);
  const [selectedProperty, setSelectedProperty] = useState<PropertyMatch | null>(null);
  const [showPropertyModal, setShowPropertyModal] = useState(false);
  const [uploadedImages, setUploadedImages] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const { formatPrice } = useCurrency();
  const { toast } = useToast();
  const { createConversation, isCreatingConversation } = useChat();

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

  const handleSearch = async (searchQuery?: string) => {
    const queryToUse = searchQuery || query;
    
    if (!user) {
      // Store query for after login
      localStorage.setItem('pendingSearchQuery', queryToUse);
      setShowAuthPrompt(true);
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

    try {
      // Create a conversation first for this search
      let conversationId: string | undefined;
      
      // Generate a meaningful title for the conversation
      const conversationTitle = queryToUse.trim() 
        ? `Property Search: ${queryToUse.slice(0, 50)}${queryToUse.length > 50 ? '...' : ''}`
        : 'Image-based Property Search';
      
      await new Promise<void>((resolve) => {
        createConversation(conversationTitle);
        // Wait for the conversation to be created
        const checkConversation = setInterval(() => {
          if (!isCreatingConversation) {
            clearInterval(checkConversation);
            resolve();
          }
        }, 100);
      });

      let searchBody: any = { query: queryToUse.trim() };

      // Convert uploaded images to base64 if present
      if (uploadedImages.length > 0) {
        const imageData = await Promise.all(
          uploadedImages.map(async (file) => ({
            name: file.name,
            data: await convertImageToBase64(file)
          }))
        );
        searchBody.images = imageData;
        
        // If only images without text, provide a default query
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
      
      if (data.results && data.results.length > 0) {
        toast({
          title: "Found matches!",
          description: `We found ${data.totalMatches} properties that might be perfect for you`,
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
      <div className="w-full max-w-4xl mx-auto p-6 bg-card border border-border rounded-2xl">
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-4xl mx-auto p-6 bg-card border border-border rounded-2xl shadow-xl">
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
        <h3 className="text-2xl font-bold text-foreground mb-2">Describe Your Dream Home</h3>
        <p className="text-muted-foreground">
          Tell our AI what you're looking for and discover your perfect match
        </p>
      </div>

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
                <Send className="h-4 w-4" />
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
            {/* Summary */}
            <div className="bg-secondary/20 p-4 rounded-lg">
              <p className="text-sm text-muted-foreground">{searchResults.summary}</p>
            </div>

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
                              <Badge variant="secondary" className="bg-primary/10 text-primary border-primary/20 text-xs">
                                {property.matchScore}% match
                              </Badge>
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

                            {/* AI Generated Highlights */}
                            {property.highlights && property.highlights.length > 0 && (
                              <div className="flex flex-wrap gap-1">
                                {property.highlights.slice(0, 2).map((highlight, index) => (
                                  <Badge key={index} variant="outline" className="text-xs border-primary/30 bg-primary/5">
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
          }
        } : null}
        isOpen={showPropertyModal}
        onClose={() => {
          setShowPropertyModal(false);
          setSelectedProperty(null);
        }}
      />
    </div>
  );
};