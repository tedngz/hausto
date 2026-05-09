import { useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Plus, MessageSquare, User, MapPin, Upload, Edit, Trash2, Eye, FileSpreadsheet, RefreshCw, CheckSquare, Square, Sparkles, Power, Globe, ExternalLink, X } from 'lucide-react';
import { Apartment } from '@/types';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { PropertyCard } from '@/components/PropertyCard';
import { PropertyEditModal } from '@/components/PropertyEditModal';
import { PropertyUploadModal } from '@/components/PropertyUploadModal';
import { BulkUploadModal } from '@/components/BulkUploadModal';
import { PropertyPreviewModal } from '@/components/PropertyPreviewModal';
import { HaustoChat } from '@/components/HaustoChat';
import { RenterProfileModal } from '@/components/RenterProfileModal';
import { BatchReanalyzeProgressModal } from '@/components/BatchReanalyzeProgressModal';
import { useProperties, Property } from '@/hooks/useProperties';
import { useAuth } from '@/hooks/useAuth';
import { useMatches, PropertyMatch } from '@/hooks/useMatches';
import { useCurrency } from '@/contexts/CurrencyContext';
import { useToast } from '@/hooks/use-toast';
import { useIsMobile } from '@/hooks/use-mobile';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import { useQueryClient, useQuery } from '@tanstack/react-query';
interface RealtorDashboardProps {
  onSwitchUserType: () => void;
  onViewProfile?: () => void;
  onOpenUploadModal?: () => void;
}
export const RealtorDashboard = ({
  onSwitchUserType,
  onViewProfile,
  onOpenUploadModal
}: RealtorDashboardProps) => {
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [isBulkUploadModalOpen, setIsBulkUploadModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isEditingExternal, setIsEditingExternal] = useState(false);
  const [isPreviewModalOpen, setIsPreviewModalOpen] = useState(false);
  const [previewCrawledApartment, setPreviewCrawledApartment] = useState<Apartment | null>(null);
  const [showRawHarvested, setShowRawHarvested] = useState(false);
  const [isChatModalOpen, setIsChatModalOpen] = useState(false);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [selectedProperty, setSelectedProperty] = useState<Property | null>(null);
  const [selectedMatch, setSelectedMatch] = useState<PropertyMatch | null>(null);
  const [isReanalyzing, setIsReanalyzing] = useState(false);
  const [selectedPropertyIds, setSelectedPropertyIds] = useState<Set<string>>(new Set());
  const [isProgressModalOpen, setIsProgressModalOpen] = useState(false);
  const [isReanalyzeDialogOpen, setIsReanalyzeDialogOpen] = useState(false);
  const [isReactivateDialogOpen, setIsReactivateDialogOpen] = useState(false);
  const [reanalyzeCount, setReanalyzeCount] = useState(0);
  const [isReactivating, setIsReactivating] = useState(false);
  const [propertyProgress, setPropertyProgress] = useState<Array<{
    id: string;
    title: string;
    status: 'pending' | 'analyzing' | 'success' | 'failed';
    error?: string;
  }>>([]);
  const [currentAnalyzingIndex, setCurrentAnalyzingIndex] = useState(0);
  const { user } = useAuth();
  const {
    realtorProperties,
    isLoading,
    deleteProperty,
    isDeleting,
    toggleProperty,
    isToggling
  } = useProperties();
  const queryClient = useQueryClient();
  const {
    realtorMatches,
    isLoadingMatches
  } = useMatches();
  const {
    formatPrice
  } = useCurrency();
  const {
    toast
  } = useToast();
  const isMobile = useIsMobile();

  // Check if current user is admin
  const { data: isAdmin = false } = useQuery({
    queryKey: ['is-admin', user?.id],
    queryFn: async () => {
      if (!user?.id) return false;
      const { data } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', user.id)
        .eq('role', 'admin')
        .maybeSingle();
      return !!data;
    },
    enabled: !!user?.id,
  });

  // Fetch crawled external listings for admin
  const { data: crawledListings = [], isLoading: isLoadingCrawled } = useQuery({
    queryKey: ['crawled-listings'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('external_properties')
        .select('*')
        .order('crawled_at', { ascending: false })
        .limit(200);
      if (error) throw error;
      const listings = data || [];

      // Auto-deactivate expired listings that still have is_active = true
      const now = new Date();
      const expiredActive = listings.filter(
        (l: any) => l.is_active && l.expires_at && new Date(l.expires_at) < now
      );
      if (expiredActive.length > 0) {
        console.log(`[CrawledListings] Auto-deactivating ${expiredActive.length} expired listings`);
        const ids = expiredActive.map((l: any) => l.id);
        supabase
          .from('external_properties')
          .update({ is_active: false, updated_at: now.toISOString() })
          .in('id', ids)
          .then(({ error: updateErr }) => {
            if (updateErr) {
              console.error('[CrawledListings] Failed to deactivate expired:', updateErr);
            } else {
              queryClient.invalidateQueries({ queryKey: ['crawled-listings'] });
            }
          });
        // Return with corrected status immediately
        return listings.map((l: any) =>
          ids.includes(l.id) ? { ...l, is_active: false } : l
        );
      }

      return listings;
    },
    enabled: isAdmin,
  });

  const handleToggleCrawledListing = async (id: string, currentActive: boolean) => {
    const { error } = await supabase
      .from('external_properties')
      .update({ is_active: !currentActive, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } else {
      queryClient.invalidateQueries({ queryKey: ['crawled-listings'] });
      queryClient.invalidateQueries({ queryKey: ['external-properties-swipe'] });
      toast({ title: !currentActive ? 'Listing activated' : 'Listing deactivated' });
    }
  };

  const handleDeleteCrawledListing = async (id: string) => {
    if (!window.confirm('Permanently delete this crawled listing?')) return;
    
    // Optimistically remove from cache immediately
    queryClient.setQueryData(['crawled-listings'], (old: any[] | undefined) => 
      old ? old.filter((item: any) => item.id !== id) : []
    );
    
    const { error } = await supabase
      .from('external_properties')
      .delete()
      .eq('id', id);
    if (error) {
      // Revert on error
      queryClient.invalidateQueries({ queryKey: ['crawled-listings'] });
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } else {
      queryClient.invalidateQueries({ queryKey: ['external-properties-swipe'] });
      toast({ title: 'Listing deleted' });
    }
  };

  const handlePreviewCrawled = (listing: any) => {
    const apartment: Apartment = {
      id: listing.id,
      images: listing.images || [],
      title: listing.title,
      location: listing.location,
      price: Number(listing.price) || 0,
      size: listing.size || '',
      vibe: listing.vibe || '',
      description: listing.description || '',
      highlights: listing.highlights || [],
      amenities: listing.amenities || [],
      realtor: {
        id: `ext-${listing.source}`,
        name: listing.contact_name || listing.source,
        phone: listing.contact_phone || '',
        email: '',
        avatar: '',
      },
      vibe_analysis: listing.vibe_analysis,
      rooms: listing.rooms,
      property_source_link: listing.source_url,
      property_source_provider_name: listing.contact_name || undefined,
      property_source_provider_phone: listing.contact_phone || undefined,
      latitude: listing.latitude,
      longitude: listing.longitude,
    };
    setPreviewCrawledApartment(apartment);
  };
  const unreadMatches = realtorMatches.filter(match => new Date(match.created_at).getTime() > Date.now() - 86400000);
  const handleEdit = (property: Property) => {
    setSelectedProperty(property);
    setIsEditingExternal(false);
    setIsEditModalOpen(true);
  };

  const handleEditCrawled = (listing: any) => {
    // Convert crawled listing to Property-like object for PropertyEditModal
    const asProperty: Property = {
      id: listing.id,
      realtor_id: `ext-${listing.source}`,
      title: listing.title,
      description: listing.description || '',
      location: listing.location,
      price: Number(listing.price) || 0,
      size: listing.size || null,
      rooms: listing.rooms || null,
      vibe: listing.vibe || null,
      highlights: listing.highlights || [],
      images: listing.images || [],
      vibe_analysis: listing.vibe_analysis || null,
      property_source_link: listing.source_url,
      property_source_provider_name: listing.contact_name || null,
      property_source_provider_phone: listing.contact_phone || null,
      amenities: listing.amenities || [],
      created_at: listing.created_at || listing.crawled_at || new Date().toISOString(),
      updated_at: listing.updated_at || new Date().toISOString(),
      is_active: listing.is_active ?? true,
      last_activated_at: listing.crawled_at || listing.created_at || new Date().toISOString(),
      latitude: listing.latitude || null,
      longitude: listing.longitude || null,
    };
    setSelectedProperty(asProperty);
    setIsEditingExternal(true);
    setIsEditModalOpen(true);
  };
  const handlePreview = (property: Property) => {
    setSelectedProperty(property);
    setIsPreviewModalOpen(true);
  };
  const handleDelete = (property: Property) => {
    if (window.confirm(`Are you sure you want to delete "${property.title}"? This action cannot be undone.`)) {
      deleteProperty(property.id);
    }
  };
  const handleViewProfile = (match: PropertyMatch) => {
    setSelectedMatch(match);
    setIsProfileModalOpen(true);
  };
  const handleChat = (match: PropertyMatch) => {
    setSelectedMatch(match);
    setIsChatModalOpen(true);
  };
  const handleToggleActive = (property: Property) => {
    toggleProperty({
      id: property.id,
      isActive: !property.is_active
    });
  };
  const getTimeRemaining = (lastActivated?: string): { value: number; unit: 'days' | 'hours' | 'minutes'; expired: boolean } => {
    if (!lastActivated) return { value: 0, unit: 'days', expired: true };
    const activatedDate = new Date(lastActivated);
    const now = new Date();
    const diffMs = 10 * 24 * 60 * 60 * 1000 - (now.getTime() - activatedDate.getTime());
    
    if (diffMs <= 0) return { value: 0, unit: 'days', expired: true };
    
    const diffHours = diffMs / (1000 * 60 * 60);
    const diffDays = diffHours / 24;
    
    if (diffDays >= 1) {
      return { value: Math.ceil(diffDays), unit: 'days', expired: false };
    } else if (diffHours >= 1) {
      return { value: Math.ceil(diffHours), unit: 'hours', expired: false };
    } else {
      const diffMinutes = diffMs / (1000 * 60);
      return { value: Math.max(1, Math.ceil(diffMinutes)), unit: 'minutes', expired: false };
    }
  };
  
  const formatTimeRemaining = (lastActivated?: string): string => {
    const { value, unit, expired } = getTimeRemaining(lastActivated);
    if (expired) return 'Expired';
    return `${value} ${unit} remaining`;
  };

  const getCrawledTimeRemaining = (expiresAt?: string): { value: number; unit: 'days' | 'hours' | 'minutes'; expired: boolean } => {
    if (!expiresAt) return { value: 0, unit: 'days', expired: true };
    const diffMs = new Date(expiresAt).getTime() - Date.now();
    if (diffMs <= 0) return { value: 0, unit: 'days', expired: true };
    const diffHours = diffMs / (1000 * 60 * 60);
    const diffDays = diffHours / 24;
    if (diffDays >= 1) return { value: Math.ceil(diffDays), unit: 'days', expired: false };
    if (diffHours >= 1) return { value: Math.ceil(diffHours), unit: 'hours', expired: false };
    return { value: Math.max(1, Math.ceil(diffMs / (1000 * 60))), unit: 'minutes', expired: false };
  };

  const formatCrawledTimeRemaining = (expiresAt?: string): string => {
    const { value, unit, expired } = getCrawledTimeRemaining(expiresAt);
    if (expired) return 'Expired';
    return `${value} ${unit} remaining`;
  };

  const handleBatchReanalyze = async () => {
    const propertiesToAnalyze = selectedPropertyIds.size > 0 
      ? realtorProperties.filter(p => selectedPropertyIds.has(p.id))
      : realtorProperties;

    if (propertiesToAnalyze.length === 0) {
      toast({
        title: "No properties",
        description: "You don't have any properties to re-analyze.",
        variant: "destructive"
      });
      return;
    }

    setReanalyzeCount(propertiesToAnalyze.length);
    setIsReanalyzeDialogOpen(true);
  };

  const confirmBatchReanalyze = async () => {
    setIsReanalyzeDialogOpen(false);
    
    const propertiesToAnalyze = selectedPropertyIds.size > 0 
      ? realtorProperties.filter(p => selectedPropertyIds.has(p.id))
      : realtorProperties;

    // Initialize progress tracking
    const initialProgress = propertiesToAnalyze.map(p => ({
      id: p.id,
      title: p.title,
      status: 'pending' as const
    }));
    setPropertyProgress(initialProgress);
    setCurrentAnalyzingIndex(0);
    setIsProgressModalOpen(true);
    setIsReanalyzing(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('No session');

      // Process each property one by one
      let successCounter = 0;
      let failureCounter = 0;
      for (let i = 0; i < propertiesToAnalyze.length; i++) {
        const property = propertiesToAnalyze[i];
        setCurrentAnalyzingIndex(i);

        // Update status to analyzing
        setPropertyProgress(prev => prev.map((p, idx) => 
          idx === i ? { ...p, status: 'analyzing' as const } : p
        ));

        try {
          if (!property.images || property.images.length === 0) {
            throw new Error('No images to analyze');
          }

          // Call analyze-vibe function
          const { data: analysisData, error: analysisError } = await supabase.functions.invoke(
            'analyze-vibe',
            {
              body: {
                imageUrls: property.images,
                generateContent: true
              },
              headers: {
                Authorization: `Bearer ${session.access_token}`
              }
            }
          );

          if (analysisError) throw analysisError;

          // Convert raw scores to formatted vibe_analysis
          const analysis = analysisData?.analysis || {};
          const aiStyles: string[] = [];
          const aiColors: string[] = [];
          const aiActivities: string[] = [];

          // Styles (aligned with analyze-vibe fields)
          if (analysis.modern >= 5) aiStyles.push('Modern');
          if (analysis.cozy >= 5) aiStyles.push('Cozy');
          if (analysis.luxurious >= 6) aiStyles.push('Luxury');
          if (analysis.urban >= 5) aiStyles.push('Urban');
          if (analysis.minimalist >= 5) aiStyles.push('Minimalist');
          if (analysis.elegant >= 5) aiStyles.push('Contemporary');
          if (analysis.rustic >= 4) aiStyles.push('Rustic');
          if (analysis.colorful >= 5) aiStyles.push('Bohemian');

          // Colors (derived from available properties)
          if (analysis.minimalist >= 6 || (analysis.modern >= 6 && analysis.colorful < 5)) aiColors.push('Neutral');
          if (analysis.cozy >= 6 || analysis.rustic >= 5) aiColors.push('Warm');
          if (analysis.modern >= 7 || analysis.elegant >= 6) aiColors.push('Cool');
          if (analysis.natural_light >= 7) aiColors.push('Bright');
          if (analysis.colorful >= 6) aiColors.push('Colorful');
          if (analysis.natural_light >= 6 && analysis.cozy >= 5) aiColors.push('Natural');
          if (analysis.minimalist >= 7) aiColors.push('White');
          if (analysis.rustic >= 6 || (analysis.cozy >= 6 && analysis.natural_light >= 5)) aiColors.push('Earth');
          if (analysis.colorful >= 7 || (analysis.modern >= 7 && analysis.colorful >= 5)) aiColors.push('Bold');

          // Activities (derived from available properties)
          if (analysis.modern >= 6 || analysis.spacious >= 7) aiActivities.push('Working');
          if ((analysis.cozy >= 6 && analysis.natural_light >= 6) || analysis.natural_light >= 8) aiActivities.push('Reading');
          if (analysis.cozy >= 6 || analysis.elegant >= 6) aiActivities.push('Relaxing');
          if (analysis.spacious >= 7 || (analysis.modern >= 6 && analysis.spacious >= 5) || analysis.luxurious >= 7) aiActivities.push('Entertaining');
          if (analysis.spacious >= 6 && analysis.modern >= 5) aiActivities.push('Cooking');
          if (analysis.spacious >= 8) aiActivities.push('Exercising');

          // Deduplicate and cap to 3 each
          const uniqueStyles = [...new Set(aiStyles)].slice(0, 3);
          const uniqueColors = [...new Set(aiColors)].slice(0, 3);
          const uniqueActivities = [...new Set(aiActivities)].slice(0, 3);

          let formattedVibeAnalysis = {
            ...analysis,
            styles: [...new Set(aiStyles)].slice(0, 3),
            colors: [...new Set(aiColors)].slice(0, 3),
            activities: [...new Set(aiActivities)].slice(0, 3)
          };

          // Extract image highlights and suggested amenities from individual image analyses
          const imageHighlights: string[] = [];
          const suggestedAmenitiesFromImages: string[] = [];
          let mappedImageAnalyses: any[] | undefined = undefined;
          if (analysisData?.image_analyses && Array.isArray(analysisData.image_analyses)) {
            mappedImageAnalyses = analysisData.image_analyses.map((ia: any, idx: number) => ({
              ...ia,
              image_index: ia?.image_index ?? idx + 1,
              image_highlight: ia?.image_highlight
                ? String(ia.image_highlight).charAt(0).toUpperCase() + String(ia.image_highlight).slice(1)
                : ia?.image_highlight,
            }));

            mappedImageAnalyses.forEach((imgAnalysis: any) => {
              if (imgAnalysis.image_highlight) {
                imageHighlights.push(imgAnalysis.image_highlight);
              }
              if (Array.isArray(imgAnalysis.suggested_amenities)) {
                suggestedAmenitiesFromImages.push(...imgAnalysis.suggested_amenities);
              }
            });
          }

          // Unique amenities from images and from overall analysis
          const uniqueAmenitiesFromImages = [...new Set(suggestedAmenitiesFromImages)].slice(0, 5);
          const mergedAmenities = Array.from(new Set([...(analysisData?.analysis?.amenities || []), ...uniqueAmenitiesFromImages]));

          // Attach amenities and image analyses into vibe_analysis for editor convenience
          formattedVibeAnalysis = {
            ...formattedVibeAnalysis,
            image_analyses: mappedImageAnalyses,
            amenities: mergedAmenities,
          };

          // Update the property in the database
          const { error: updateError } = await supabase
            .from('properties')
            .update({
              vibe_analysis: formattedVibeAnalysis,
              highlights: imageHighlights.length > 0 ? imageHighlights : [...uniqueStyles, ...uniqueColors, ...uniqueActivities],
              amenities: mergedAmenities.length > 0 ? mergedAmenities : (property as any).amenities || [],
              updated_at: new Date().toISOString()
            })
            .eq('id', property.id);

          if (updateError) throw updateError;

          // Update status to success
          successCounter += 1;
          setPropertyProgress(prev => prev.map((p, idx) => 
            idx === i ? { ...p, status: 'success' as const } : p
          ));

        } catch (error) {
          console.error(`Error analyzing property ${property.id}:`, error);
          // Update status to failed
          failureCounter += 1;
          setPropertyProgress(prev => prev.map((p, idx) => 
            idx === i ? { 
              ...p, 
              status: 'failed' as const,
              error: error instanceof Error ? error.message : 'Analysis failed'
            } : p
          ));
        }
      }

      // Refresh properties list
      queryClient.invalidateQueries({ queryKey: ['realtor-properties'] });
      queryClient.invalidateQueries({ queryKey: ['properties'] });
      setSelectedPropertyIds(new Set());

      toast({
        title: "Batch re-analysis complete",
        description: `Successfully updated ${successCounter} properties${failureCounter > 0 ? `, ${failureCounter} failed` : ''}.`,
      });

    } catch (error) {
      console.error('Batch re-analyze error:', error);
      toast({
        title: "Re-analysis failed",
        description: error instanceof Error ? error.message : "Failed to re-analyze properties",
        variant: "destructive"
      });
    } finally {
      setIsReanalyzing(false);
    }
  };

  const togglePropertySelection = (propertyId: string) => {
    setSelectedPropertyIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(propertyId)) {
        newSet.delete(propertyId);
      } else {
        newSet.add(propertyId);
      }
      return newSet;
    });
  };

  const allSelectableIds = [
    ...realtorProperties.map(p => p.id),
    ...(isAdmin ? crawledListings.map((l: any) => `ext-${l.id}`) : []),
  ];

  const selectAllProperties = () => {
    setSelectedPropertyIds(new Set(allSelectableIds));
  };

  const clearSelection = () => {
    setSelectedPropertyIds(new Set());
  };

  const handleReactivateAll = () => {
    const internalInactive = selectedPropertyIds.size > 0 
      ? realtorProperties.filter(p => selectedPropertyIds.has(p.id) && !p.is_active)
      : realtorProperties.filter(p => !p.is_active);
    
    const crawledInactive = isAdmin ? (selectedPropertyIds.size > 0
      ? crawledListings.filter((l: any) => selectedPropertyIds.has(`ext-${l.id}`) && !l.is_active)
      : []) : [];

    const totalInactive = internalInactive.length + crawledInactive.length;

    if (totalInactive === 0) {
      toast({
        title: "No inactive properties",
        description: selectedPropertyIds.size > 0 
          ? "All selected properties are already active."
          : "All your properties are already active.",
      });
      return;
    }

    setIsReactivateDialogOpen(true);
  };

  const confirmReactivateAll = async () => {
    setIsReactivateDialogOpen(false);
    setIsReactivating(true);

    const internalToReactivate = selectedPropertyIds.size > 0 
      ? realtorProperties.filter(p => selectedPropertyIds.has(p.id) && !p.is_active)
      : realtorProperties.filter(p => !p.is_active);

    const crawledToReactivate = isAdmin ? (selectedPropertyIds.size > 0
      ? crawledListings.filter((l: any) => selectedPropertyIds.has(`ext-${l.id}`) && !l.is_active)
      : []) : [];

    try {
      const now = new Date().toISOString();
      const expiresAt = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();
      
      const promises: Promise<any>[] = [];

      // Reactivate internal properties
      if (internalToReactivate.length > 0) {
        promises.push(
          (async () => {
            const { error } = await supabase
              .from('properties')
              .update({ is_active: true, last_activated_at: now, updated_at: now })
              .in('id', internalToReactivate.map(p => p.id));
            if (error) throw error;
          })()
        );
      }

      // Reactivate crawled external properties
      if (crawledToReactivate.length > 0) {
        promises.push(
          (async () => {
            const { error } = await supabase
              .from('external_properties')
              .update({ is_active: true, expires_at: expiresAt, updated_at: now })
              .in('id', crawledToReactivate.map((l: any) => l.id));
            if (error) throw error;
          })()
        );
      }

      await Promise.all(promises);

      queryClient.invalidateQueries({ queryKey: ['realtor-properties'] });
      queryClient.invalidateQueries({ queryKey: ['properties'] });
      queryClient.invalidateQueries({ queryKey: ['crawled-listings'] });
      
      // Invalidate discovery cache
      supabase.functions.invoke('property-discovery-cache', {
        body: { action: 'invalidate' },
      });

      setSelectedPropertyIds(new Set());

      const total = internalToReactivate.length + crawledToReactivate.length;
      toast({
        title: "Properties reactivated",
        description: `Successfully reactivated ${total} ${total === 1 ? 'property' : 'properties'}${crawledToReactivate.length > 0 ? ` (${crawledToReactivate.length} crawled)` : ''}.`,
      });
    } catch (error) {
      console.error('Reactivate all error:', error);
      toast({
        title: "Reactivation failed",
        description: error instanceof Error ? error.message : "Failed to reactivate properties",
        variant: "destructive"
      });
    } finally {
      setIsReactivating(false);
    }
  };

  const inactiveCount = (() => {
    if (selectedPropertyIds.size > 0) {
      const internalInactive = realtorProperties.filter(p => selectedPropertyIds.has(p.id) && !p.is_active).length;
      const crawledInactive = isAdmin ? crawledListings.filter((l: any) => selectedPropertyIds.has(`ext-${l.id}`) && !l.is_active).length : 0;
      return internalInactive + crawledInactive;
    }
    return realtorProperties.filter(p => !p.is_active).length;
  })();
  return <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-100 pt-16">
      <div className="max-w-6xl mx-auto p-4 md:p-6">
        {/* Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6 mb-8">
          <Card className="p-6 bg-white/90 backdrop-blur-sm border-slate-200 shadow-lg">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-600">Listed Properties</p>
                <p className="text-2xl font-bold text-slate-900">{realtorProperties.length}</p>
              </div>
              <div className="w-12 h-12 bg-gradient-to-r from-green-400 to-emerald-500 rounded-xl flex items-center justify-center shadow-lg">
                <Upload className="w-6 h-6 text-white" />
              </div>
            </div>
          </Card>
          
          <Card className="p-6 bg-white/90 backdrop-blur-sm border-slate-200 shadow-lg">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-600">Total Matches</p>
                <p className="text-2xl font-bold text-slate-900">{realtorMatches.length}</p>
              </div>
              <div className="w-12 h-12 bg-gradient-to-r from-orange-400 to-red-500 rounded-xl flex items-center justify-center shadow-lg">
                <User className="w-6 h-6 text-white" />
              </div>
            </div>
          </Card>
          
          <Card className="p-6 bg-white/90 backdrop-blur-sm border-slate-200 shadow-lg">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-600">New Today</p>
                <p className="text-2xl font-bold text-slate-900">{unreadMatches.length}</p>
              </div>
              <div className="w-12 h-12 bg-gradient-to-r from-purple-400 to-pink-500 rounded-xl flex items-center justify-center shadow-lg">
                <MessageSquare className="w-6 h-6 text-white" />
              </div>
            </div>
          </Card>
        </div>

        {/* My Properties */}
        <Card className="bg-white/90 backdrop-blur-sm border-slate-200 shadow-lg mb-8">
          <div className="p-4 md:p-6 border-b border-slate-200">
            <div className="flex flex-col space-y-4">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                <div>
                  <h2 className="text-lg md:text-xl font-semibold text-slate-900">My Properties</h2>
                  <p className="text-slate-600 text-sm">
                    Manage your listed properties • 
                    {realtorProperties.filter(p => !p.property_source_provider_name).length} Direct • 
                    {realtorProperties.filter(p => p.property_source_provider_name).length} Partner
                  </p>
                </div>
                
                {/* Primary Actions */}
                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => setIsUploadModalOpen(true)} className="bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700" size={isMobile ? "sm" : "default"}>
                    <Upload className="w-4 h-4 mr-2" />
                    {isMobile ? "Add" : "Add Property"}
                  </Button>
                  <Button onClick={() => setIsBulkUploadModalOpen(true)} variant="outline" className="border-green-200 text-green-700 hover:bg-green-50" size={isMobile ? "sm" : "default"}>
                    <FileSpreadsheet className="w-4 h-4 mr-2" />
                    {isMobile ? "Bulk" : "Bulk Upload"}
                  </Button>
                </div>
              </div>

              {/* Selection Toolbar */}
              {realtorProperties.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100">
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    onClick={selectedPropertyIds.size === allSelectableIds.length ? clearSelection : selectAllProperties}
                    className="text-xs"
                  >
                    {selectedPropertyIds.size === allSelectableIds.length ? (
                      <>
                        <CheckSquare className="w-4 h-4 mr-1" />
                        Clear All
                      </>
                    ) : (
                      <>
                        <Square className="w-4 h-4 mr-1" />
                        Select All ({allSelectableIds.length})
                      </>
                    )}
                  </Button>
                  
                  {selectedPropertyIds.size > 0 && (
                    <span className="text-xs text-muted-foreground px-2 border-l border-slate-200">
                      {selectedPropertyIds.size} selected
                    </span>
                  )}
                  
                  <div className="flex-1" />
                  
                  {/* Batch Actions */}
                  <Button 
                    onClick={handleReactivateAll}
                    disabled={isReactivating || inactiveCount === 0}
                    variant="outline" 
                    className="border-blue-200 text-blue-700 hover:bg-blue-50" 
                    size="sm"
                  >
                    <Power className={`w-4 h-4 mr-1.5 ${isReactivating ? 'animate-pulse' : ''}`} />
                    {selectedPropertyIds.size > 0 
                      ? `Reactivate (${inactiveCount})`
                      : isMobile ? "Reactivate" : `Reactivate All (${inactiveCount})`}
                  </Button>
                  
                  <Button 
                    onClick={handleBatchReanalyze}
                    disabled={isReanalyzing || !realtorProperties.length}
                    variant="outline" 
                    className="border-primary/20 hover:bg-primary/5" 
                    size="sm"
                  >
                    <RefreshCw className={`w-4 h-4 mr-1.5 ${isReanalyzing ? 'animate-spin' : ''}`} />
                    {selectedPropertyIds.size > 0 
                      ? `Re-analyze (${selectedPropertyIds.size})`
                      : isMobile ? "Re-analyze" : "Re-analyze All"}
                  </Button>
                </div>
              )}
            </div>
          </div>
          <div className="p-4 md:p-6">
            {isLoading ? <div className="text-center py-8">
                <p className="text-slate-600">Loading properties...</p>
              </div> : realtorProperties.length === 0 ? <div className="text-center py-8">
                <Upload className="w-12 h-12 text-slate-400 mx-auto mb-4" />
                <h3 className="text-base md:text-lg font-medium text-slate-900 mb-2">No properties yet</h3>
                <p className="text-slate-600 text-sm">Upload your first property to start getting matches!</p>
              </div> : <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {realtorProperties.map(property => <Card key={property.id} className={`overflow-hidden border transition-shadow ${selectedPropertyIds.has(property.id) ? 'border-primary ring-2 ring-primary/20' : 'border-slate-200 hover:shadow-lg'}`}>
                    {property.images && property.images.length > 0 && <div className="relative">
                        <img src={property.images[0]} alt={property.title} className="w-full h-32 md:h-48 object-cover" />
                        <div className="absolute top-2 left-2">
                          <Button
                            size="icon"
                            variant={selectedPropertyIds.has(property.id) ? "default" : "secondary"}
                            className="h-8 w-8 rounded-md shadow-lg"
                            onClick={(e) => {
                              e.stopPropagation();
                              togglePropertySelection(property.id);
                            }}
                          >
                            {selectedPropertyIds.has(property.id) ? (
                              <CheckSquare className="w-4 h-4" />
                            ) : (
                              <Square className="w-4 h-4" />
                            )}
                          </Button>
                        </div>
                        <div className="absolute top-2 right-2">
                          <Badge className="bg-white/90 text-slate-800 font-semibold text-xs">
                            {formatPrice(property.price)}/mo
                          </Badge>
                        </div>
                      </div>}
                     <div className="p-3 md:p-4">
                      <div className="flex items-start justify-between mb-2">
                        <h3 className="font-semibold text-slate-900 line-clamp-2 text-sm md:text-base flex-1">{property.title}</h3>
                        {property.property_source_provider_name && <Badge variant="outline" className="ml-2 text-xs flex-shrink-0">
                            Partner
                          </Badge>}
                      </div>
                      <div className="flex items-center text-xs md:text-sm text-slate-600 mb-2">
                        <MapPin className="w-3 h-3 mr-1" />
                        <span className="line-clamp-1">{property.location}</span>
                      </div>
                      {property.property_source_provider_name && <div className="text-xs text-muted-foreground mb-2">
                          Provider: {property.property_source_provider_name}
                          {property.property_source_provider_phone && <span className="ml-1">• {property.property_source_provider_phone}</span>}
                        </div>}
                      {property.vibe && <div className="mb-2">
                          <Badge variant="secondary" className="bg-orange-100 text-orange-800 text-xs">
                            {property.vibe}
                          </Badge>
                        </div>}
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <Label htmlFor={`active-${property.id}`} className="text-xs text-slate-600 cursor-pointer">
                            {property.is_active ? 'Active' : 'Inactive'}
                          </Label>
                          <Switch id={`active-${property.id}`} checked={property.is_active} onCheckedChange={() => handleToggleActive(property)} disabled={isToggling} />
                        </div>
                        {property.is_active && <div className={`text-xs ${getTimeRemaining(property.last_activated_at).expired ? 'text-red-500' : getTimeRemaining(property.last_activated_at).value <= 1 && getTimeRemaining(property.last_activated_at).unit !== 'days' ? 'text-orange-500' : 'text-slate-500'}`}>
                            {formatTimeRemaining(property.last_activated_at)}
                          </div>}
                      </div>
                      <div className="flex flex-wrap gap-1">
                        <Button size="sm" variant="outline" onClick={() => handlePreview(property)} className="text-xs px-2 py-1 flex-1 min-w-0">
                          <Eye className="w-3 h-3 mr-1 flex-shrink-0" />
                          <span className="truncate">{isMobile ? "View" : "Preview"}</span>
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => handleEdit(property)} className="text-xs px-2 py-1 flex-1 min-w-0">
                          <Edit className="w-3 h-3 mr-1 flex-shrink-0" />
                          <span className="truncate">Edit</span>
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => handleDelete(property)} disabled={isDeleting} className="text-red-600 hover:text-red-700 hover:bg-red-50 text-xs px-2 py-1 flex-1 min-w-0">
                          <Trash2 className="w-3 h-3 mr-1 flex-shrink-0" />
                          <span className="truncate">{isMobile ? "Del" : "Delete"}</span>
                        </Button>
                      </div>
                    </div>
                  </Card>)}
              </div>}
          </div>
        </Card>

        {/* Interested Renters */}
        
        {/* Crawled External Listings (Admin Only) */}
        {isAdmin && (
          <Card className="bg-white/90 backdrop-blur-sm border-slate-200 shadow-lg mb-8">
            <div className="p-4 md:p-6 border-b border-slate-200">
              <div className="flex flex-col gap-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <h2 className="text-lg md:text-xl font-semibold text-slate-900 flex items-center gap-2">
                      <Globe className="w-5 h-5" />
                      Crawled External Listings
                    </h2>
                    <p className="text-slate-600 text-sm">
                      {crawledListings.filter((l: any) => l.is_active).length} active / {crawledListings.length} total crawled listings
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      onClick={handleReactivateAll}
                      disabled={isReactivating || crawledListings.filter((l: any) => selectedPropertyIds.has(`ext-${l.id}`) && !l.is_active).length === 0}
                      variant="outline"
                      className="border-blue-200 text-blue-700 hover:bg-blue-50"
                      size="sm"
                    >
                      <Power className={`w-4 h-4 mr-1.5 ${isReactivating ? 'animate-pulse' : ''}`} />
                      {isMobile ? 'Reactivate' : `Reactivate (${crawledListings.filter((l: any) => selectedPropertyIds.has(`ext-${l.id}`) && !l.is_active).length})`}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => queryClient.invalidateQueries({ queryKey: ['crawled-listings'] })}
                    >
                      <RefreshCw className="w-4 h-4 mr-1" />
                      Refresh
                    </Button>
                  </div>
                </div>
                {/* Selection toolbar for crawled */}
                {crawledListings.length > 0 && (
                  <div className="flex items-center gap-2 pt-2 border-t border-slate-100">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        const crawledIds = crawledListings.map((l: any) => `ext-${l.id}`);
                        const allSelected = crawledIds.every((id: string) => selectedPropertyIds.has(id));
                        setSelectedPropertyIds(prev => {
                          const newSet = new Set(prev);
                          if (allSelected) {
                            crawledIds.forEach((id: string) => newSet.delete(id));
                          } else {
                            crawledIds.forEach((id: string) => newSet.add(id));
                          }
                          return newSet;
                        });
                      }}
                      className="text-xs"
                    >
                      {crawledListings.every((l: any) => selectedPropertyIds.has(`ext-${l.id}`)) ? (
                        <>
                          <CheckSquare className="w-4 h-4 mr-1" />
                          Clear All Crawled
                        </>
                      ) : (
                        <>
                          <Square className="w-4 h-4 mr-1" />
                          Select All Crawled ({crawledListings.length})
                        </>
                      )}
                    </Button>
                    {crawledListings.some((l: any) => selectedPropertyIds.has(`ext-${l.id}`)) && (
                      <span className="text-xs text-muted-foreground px-2 border-l border-slate-200">
                        {crawledListings.filter((l: any) => selectedPropertyIds.has(`ext-${l.id}`)).length} selected
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
            <div className="p-4 md:p-6">
              {isLoadingCrawled ? (
                <p className="text-center py-8 text-slate-600">Loading crawled listings...</p>
              ) : crawledListings.length === 0 ? (
                <div className="text-center py-8">
                  <Globe className="w-12 h-12 text-slate-400 mx-auto mb-4" />
                  <p className="text-slate-600">No crawled listings yet. Run a crawl from Admin Tools.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {crawledListings.map((listing: any) => (
                    <Card key={listing.id} className={`overflow-hidden border transition-shadow ${selectedPropertyIds.has(`ext-${listing.id}`) ? 'border-primary ring-2 ring-primary/20' : listing.is_active ? 'border-slate-200 hover:shadow-lg' : 'border-slate-200 opacity-60'}`}>
                      {listing.images && listing.images.length > 0 && (
                        <div className="relative">
                          <img src={listing.images[0]} alt={listing.title} className="w-full h-32 md:h-48 object-cover" />
                          <div className="absolute top-2 left-2">
                            <Button
                              size="icon"
                              variant={selectedPropertyIds.has(`ext-${listing.id}`) ? "default" : "secondary"}
                              className="h-8 w-8 rounded-md shadow-lg"
                              onClick={(e) => {
                                e.stopPropagation();
                                togglePropertySelection(`ext-${listing.id}`);
                              }}
                            >
                              {selectedPropertyIds.has(`ext-${listing.id}`) ? (
                                <CheckSquare className="w-4 h-4" />
                              ) : (
                                <Square className="w-4 h-4" />
                              )}
                            </Button>
                          </div>
                          <div className="absolute top-2 right-2">
                            <Badge className="bg-white/90 text-slate-800 font-semibold text-xs">
                              {listing.price ? formatPrice(listing.price) : 'Price N/A'}/mo
                            </Badge>
                          </div>
                          <div className="absolute top-10 left-2">
                            <Badge variant="secondary" className="text-xs">
                              {listing.source}
                            </Badge>
                          </div>
                        </div>
                      )}
                      <div className="p-3 md:p-4">
                        <h3 className="font-semibold text-slate-900 line-clamp-2 text-sm md:text-base mb-1">{listing.title}</h3>
                        <div className="flex items-center text-xs md:text-sm text-slate-600 mb-2">
                          <MapPin className="w-3 h-3 mr-1" />
                          <span className="line-clamp-1">{listing.location}</span>
                        </div>
                        <div className="flex flex-wrap gap-1 mb-2">
                          {listing.rooms && (
                            <Badge variant="outline" className="text-xs">{listing.rooms}</Badge>
                          )}
                          {listing.vibe && (
                            <Badge variant="secondary" className="text-xs">{listing.vibe}</Badge>
                          )}
                          {listing.city && (
                            <Badge variant="outline" className="text-xs">{listing.city}</Badge>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground mb-3">
                          Crawled: {new Date(listing.crawled_at).toLocaleDateString()}
                          {listing.contact_name && <span> • {listing.contact_name}</span>}
                          {listing.contact_phone && (
                            <span className="ml-1">
                              • <a href={`tel:${listing.contact_phone}`} className="text-primary hover:underline font-medium">{listing.contact_phone}</a>
                            </span>
                          )}
                        </div>
                        {/* Active toggle */}
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-2">
                            <Label htmlFor={`crawled-active-${listing.id}`} className="text-xs text-slate-600 cursor-pointer">
                              {listing.is_active ? 'Active' : 'Inactive'}
                            </Label>
                            <Switch 
                              id={`crawled-active-${listing.id}`} 
                              checked={listing.is_active} 
                              onCheckedChange={() => handleToggleCrawledListing(listing.id, listing.is_active)} 
                            />
                          </div>
                          {listing.is_active && (
                            <div className={`text-xs ${getCrawledTimeRemaining(listing.expires_at).expired ? 'text-red-500' : getCrawledTimeRemaining(listing.expires_at).value <= 1 && getCrawledTimeRemaining(listing.expires_at).unit !== 'days' ? 'text-orange-500' : 'text-slate-500'}`}>
                              {formatCrawledTimeRemaining(listing.expires_at)}
                            </div>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-1">
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-xs flex-1 min-w-0 px-2 py-1"
                            onClick={() => handlePreviewCrawled(listing)}
                          >
                            <Eye className="w-3 h-3 mr-1 flex-shrink-0" />
                            <span className="truncate">{isMobile ? 'View' : 'Preview'}</span>
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-xs flex-1 min-w-0 px-2 py-1"
                            onClick={() => handleEditCrawled(listing)}
                          >
                            <Edit className="w-3 h-3 mr-1 flex-shrink-0" />
                            <span className="truncate">Edit</span>
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-xs flex-1 min-w-0 px-2 py-1"
                            onClick={() => window.open(listing.source_url, '_blank')}
                          >
                            <ExternalLink className="w-3 h-3 mr-1 flex-shrink-0" />
                            <span className="truncate">{isMobile ? 'Src' : 'Source'}</span>
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-xs text-red-600 hover:text-red-700 hover:bg-red-50 flex-1 min-w-0 px-2 py-1"
                            onClick={() => handleDeleteCrawledListing(listing.id)}
                          >
                            <Trash2 className="w-3 h-3 mr-1 flex-shrink-0" />
                            <span className="truncate">{isMobile ? 'Del' : 'Delete'}</span>
                          </Button>
                        </div>
                      </div>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          </Card>
        )}
      </div>

      <PropertyUploadModal isOpen={isUploadModalOpen} onClose={() => setIsUploadModalOpen(false)} />

      <BulkUploadModal isOpen={isBulkUploadModalOpen} onClose={() => setIsBulkUploadModalOpen(false)} onSuccess={() => {
      setIsBulkUploadModalOpen(false);
      // Refresh properties list
      window.location.reload();
    }} />

      <PropertyEditModal isOpen={isEditModalOpen} onClose={() => {
      setIsEditModalOpen(false);
      setSelectedProperty(null);
      setIsEditingExternal(false);
    }} property={selectedProperty} isExternal={isEditingExternal} />

      <PropertyPreviewModal isOpen={isPreviewModalOpen} onClose={() => {
      setIsPreviewModalOpen(false);
      setSelectedProperty(null);
    }} property={selectedProperty} />

      {/* Crawled listing preview modal */}
      {previewCrawledApartment && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <Card className="w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-white/95 backdrop-blur">
            <div className="flex items-center justify-between p-4 border-b">
              <div>
                <h2 className="text-lg font-bold text-gray-900">Crawled Listing Preview</h2>
                <p className="text-sm text-gray-600">How this external listing appears to renters</p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setPreviewCrawledApartment(null)} aria-label="Close preview">
                <X className="w-4 h-4" />
              </Button>
            </div>
            <div className="p-4">
              <PropertyCard
                apartment={previewCrawledApartment}
                showFullTitle={true}
                showFullDescription={true}
                showAllHighlights={true}
                showContactButton={false}
                className="max-w-md mx-auto"
              />
            </div>
          </Card>
        </div>
      )}

      <HaustoChat isOpen={isChatModalOpen} onClose={() => {
      setIsChatModalOpen(false);
      setSelectedMatch(null);
    }} userType="realtor" />

      {selectedMatch && <RenterProfileModal userId={selectedMatch.renter_id} isOpen={isProfileModalOpen} onClose={() => {
      setIsProfileModalOpen(false);
      setSelectedMatch(null);
    }} />}

      <BatchReanalyzeProgressModal
        isOpen={isProgressModalOpen}
        onClose={() => setIsProgressModalOpen(false)}
        properties={propertyProgress}
        currentIndex={currentAnalyzingIndex}
        totalProperties={propertyProgress.length}
      />

      <AlertDialog open={isReanalyzeDialogOpen} onOpenChange={setIsReanalyzeDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <div className="flex items-center gap-3 mb-2">
              <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
                <Sparkles className="h-6 w-6 text-primary" />
              </div>
              <AlertDialogTitle className="text-xl">
                Refresh Property Vibes?
              </AlertDialogTitle>
            </div>
            <AlertDialogDescription className="text-base pt-2">
              {selectedPropertyIds.size > 0 
                ? `We'll analyze ${reanalyzeCount} selected ${reanalyzeCount === 1 ? 'property' : 'properties'} and update the style, colors, activities, and amenities based on the latest images.`
                : `We'll analyze all ${reanalyzeCount} ${reanalyzeCount === 1 ? 'property' : 'properties'} and update the style, colors, activities, and amenities based on the latest images.`
              }
              <br /><br />
              This usually takes just a few moments per property.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Not Now</AlertDialogCancel>
            <AlertDialogAction onClick={confirmBatchReanalyze}>
              Let's Go!
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={isReactivateDialogOpen} onOpenChange={setIsReactivateDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <div className="flex items-center gap-3 mb-2">
              <div className="h-12 w-12 rounded-full bg-blue-100 flex items-center justify-center">
                <Power className="h-6 w-6 text-blue-600" />
              </div>
              <AlertDialogTitle className="text-xl">
                Reactivate Properties?
              </AlertDialogTitle>
            </div>
            <AlertDialogDescription className="text-base pt-2">
              {selectedPropertyIds.size > 0 
                ? `This will reactivate ${inactiveCount} selected inactive ${inactiveCount === 1 ? 'property' : 'properties'} and reset their 10-day active period.`
                : `This will reactivate all ${inactiveCount} inactive ${inactiveCount === 1 ? 'property' : 'properties'} and reset their 10-day active period.`
              }
              <br /><br />
              Reactivated properties will become visible to renters again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmReactivateAll} className="bg-blue-600 hover:bg-blue-700">
              Reactivate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>;
};