import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';

export interface Property {
  id: string;
  realtor_id: string;
  title: string;
  description: string | null;
  location: string;
  price: number;
  size: string | null;
  rooms: string | null;
  vibe: string | null;
  highlights: string[] | null;
  images: string[] | null;
  vibe_analysis: any | null;
  property_source_link: string | null;
  property_source_provider_name: string | null;
  property_source_provider_phone: string | null;
  amenities: string[] | null;
  created_at: string;
  updated_at: string;
  is_active: boolean;
  last_activated_at: string;
  latitude: number | null;
  longitude: number | null;
  realtor?: {
    id: string;
    name: string;
    email: string;
    phone: string;
    avatar: string;
  };
}

export const useProperties = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch all properties with realtor profile data
  const { data: properties = [], isLoading } = useQuery({
    queryKey: ['properties'],
    queryFn: async () => {
      const cacheKey = 'properties:all';

      // Try to get from cache first
      try {
        const { data: cachedData, error: cacheError } = await supabase.functions.invoke(
          'property-discovery-cache',
          {
            body: {
              action: 'get',
              cacheKey,
            },
          }
        );

        if (!cacheError && cachedData?.properties) {
          console.log('[Properties] Cache hit - returning cached properties');
          return cachedData.properties;
        }
      } catch (cacheError) {
        console.log('[Properties] Cache error, fetching from DB:', cacheError);
      }

      // Cache miss - fetch from database
      console.log('[Properties] Cache miss - fetching from database');
      
      // Fetch internal and external properties in parallel
      const [internalResult, externalResult] = await Promise.all([
        supabase
          .from('properties')
          .select('*')
          .eq('is_active', true)
          .gte('last_activated_at', new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString())
          .order('created_at', { ascending: false }),
        supabase
          .from('external_properties')
          .select('*')
          .eq('is_active', true)
          .gt('expires_at', new Date().toISOString())
          .order('created_at', { ascending: false }),
      ]);

      if (internalResult.error) throw internalResult.error;
      
      const propertiesData = internalResult.data || [];
      const externalData = externalResult.data || [];

      if (!propertiesData.length && !externalData.length) return [];

      // Get all unique realtor IDs from internal properties
      const realtorIds = [...new Set(propertiesData.map(p => p.realtor_id))];
      
      // Get realtor profiles
      let profilesMap = new Map<string, any>();
      if (realtorIds.length > 0) {
        // Use SECURITY DEFINER RPC: realtor email/phone is gated by allow_contact_sharing
        const { data: profilesData, error: profilesError } = await supabase
          .rpc('get_realtor_public_profiles', { user_ids: realtorIds });

        if (profilesError) throw profilesError;
        profilesMap = new Map((profilesData as any[])?.map((p: any) => [p.id, p]) || []);
      }
      
      // Transform internal properties
      const transformedInternal = propertiesData.map(property => {
        const profile = profilesMap.get(property.realtor_id);
        return {
          ...property,
          realtor: {
            id: property.realtor_id,
            name: profile?.name || 'Realtor',
            email: profile?.email || '',
            phone: profile?.phone || '',
            avatar: profile?.avatar_url || ''
          }
        };
      });

      // Transform external properties to match the same interface
      const transformedExternal = externalData.map(ext => ({
        id: ext.id,
        realtor_id: `ext-${ext.source}`,
        title: ext.title,
        description: ext.description,
        location: ext.location,
        price: Number(ext.price) || 0,
        size: ext.size,
        rooms: ext.rooms,
        vibe: ext.vibe,
        highlights: ext.highlights || [],
        images: ext.images || [],
        vibe_analysis: ext.vibe_analysis,
        property_source_link: ext.source_url,
        property_source_provider_name: ext.contact_name,
        property_source_provider_phone: ext.contact_phone,
        amenities: ext.amenities || [],
        created_at: ext.created_at || ext.crawled_at || new Date().toISOString(),
        updated_at: ext.updated_at || new Date().toISOString(),
        is_active: ext.is_active ?? true,
        last_activated_at: ext.crawled_at || ext.created_at || new Date().toISOString(),
        latitude: ext.latitude,
        longitude: ext.longitude,
        _isExternal: true,
        _source: ext.source,
        _sourceUrl: ext.source_url,
        realtor: {
          id: `ext-${ext.source}`,
          name: ext.contact_name || ext.source || 'External Listing',
          email: '',
          phone: ext.contact_phone || '',
          avatar: ''
        }
      }));

      const transformedProperties = [...transformedInternal, ...transformedExternal];

      // Cache the result (fire and forget)
      supabase.functions
        .invoke('property-discovery-cache', {
          body: {
            action: 'set',
            cacheKey,
            properties: transformedProperties,
          },
        })
        .then(({ error }) => {
          if (error) {
            console.error('[Properties] Error caching properties:', error);
          } else {
            console.log('[Properties] Cached properties successfully');
          }
        });

      return transformedProperties;
    },
  });

  // Realtime: refresh properties when backend updates happen (e.g., re-analyze)
  useEffect(() => {
    const channel = supabase
      .channel('properties-updates')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'properties' }, () => {
        queryClient.invalidateQueries({ queryKey: ['properties'] });
        queryClient.invalidateQueries({ queryKey: ['realtor-properties', user?.id] });
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient, user?.id]);

  // Helper function to check if property is expired (past 10-day period)
  const isPropertyExpired = (lastActivatedAt: string): boolean => {
    const activatedDate = new Date(lastActivatedAt);
    const now = new Date();
    const diffMs = now.getTime() - activatedDate.getTime();
    const tenDaysMs = 10 * 24 * 60 * 60 * 1000;
    return diffMs >= tenDaysMs;
  };

  // Lazy deactivation: automatically deactivate expired properties
  const deactivateExpiredProperties = async (properties: Property[]) => {
    const expiredActiveProperties = properties.filter(
      p => p.is_active && isPropertyExpired(p.last_activated_at)
    );
    
    if (expiredActiveProperties.length > 0) {
      console.log(`[Properties] Lazy deactivation: ${expiredActiveProperties.length} expired properties`);
      
      // Deactivate each expired property (fire and forget)
      for (const property of expiredActiveProperties) {
        supabase
          .from('properties')
          .update({ is_active: false, updated_at: new Date().toISOString() })
          .eq('id', property.id)
          .then(({ error }) => {
            if (error) {
              console.error(`[Properties] Failed to deactivate property ${property.id}:`, error);
            } else {
              console.log(`[Properties] Deactivated expired property: ${property.id}`);
            }
          });
      }
      
      // Return properties with corrected is_active status
      return properties.map(p => 
        expiredActiveProperties.some(exp => exp.id === p.id)
          ? { ...p, is_active: false }
          : p
      );
    }
    
    return properties;
  };

  // Fetch realtor's own properties with profile data
  const { data: realtorProperties = [] } = useQuery({
    queryKey: ['realtor-properties', user?.id],
    queryFn: async () => {
      if (!user?.id) return [];
      
      // Get properties for this realtor
      const { data: propertiesData, error: propertiesError } = await supabase
        .from('properties')
        .select('*')
        .eq('realtor_id', user.id)
        .order('created_at', { ascending: false });

      if (propertiesError) throw propertiesError;
      
      if (!propertiesData?.length) return [];

      // Get the realtor's profile
      const { data: profileData, error: profileError } = await supabase
        .from('profiles')
        .select('id, name, email, phone, avatar_url')
        .eq('id', user.id)
        .single();

      if (profileError) throw profileError;
      
      // Transform data to match Apartment interface
      const transformedProperties = propertiesData.map(property => ({
        ...property,
        realtor: {
          id: property.realtor_id,
          name: profileData?.name || 'Realtor',
          email: profileData?.email || '',
          phone: profileData?.phone || '',
          avatar: profileData?.avatar_url || ''
        }
      }));

      // Lazy deactivation: auto-deactivate expired properties
      const correctedProperties = await deactivateExpiredProperties(transformedProperties);
      
      return correctedProperties;
    },
    enabled: !!user?.id,
  });

  // Upload image to storage
  const uploadImage = async (file: File): Promise<string> => {
    const fileExt = file.name.split('.').pop();
    const fileName = `${user?.id}/${Date.now()}.${fileExt}`;

    const { error: uploadError } = await supabase.storage
      .from('property-images')
      .upload(fileName, file);

    if (uploadError) throw uploadError;

    const { data } = supabase.storage
      .from('property-images')
      .getPublicUrl(fileName);

    return data.publicUrl;
  };

  // Analyze image vibes using AI
  const analyzeImageVibes = async (imageUrls: string[], generateContent = false): Promise<any> => {
    try {
      const { data, error } = await supabase.functions.invoke('analyze-vibe', {
        body: { imageUrls, generateContent }
      });

      if (error) throw error;
      return data.analysis || {};
    } catch (error) {
      console.error('Error analyzing image vibes:', error);
      return {};
    }
  };

  // Create property mutation with vibe analysis
  const createPropertyMutation = useMutation({
    mutationFn: async (propertyData: {
      title: string;
      description: string;
      location: string;
      price: number;
      size?: string;
      vibe?: string;
      highlights: string[];
      imageFiles: File[];
      vibeAnalysis?: any;
      propertySourceLink?: string;
      propertySourceProviderName?: string;
      propertySourceProviderPhone?: string;
      latitude?: number | null;
      longitude?: number | null;
      rooms?: string;
    }) => {
      if (!user?.id) throw new Error('User not authenticated');

      // Upload images with error handling and retry logic
      const imageUrls: string[] = [];
      
      for (let i = 0; i < propertyData.imageFiles.length; i++) {
        const file = propertyData.imageFiles[i];
        let retries = 3;
        let uploaded = false;
        
        while (retries > 0 && !uploaded) {
          try {
            const url = await uploadImage(file);
            imageUrls.push(url);
            uploaded = true;
            console.log(`Successfully uploaded image ${i + 1}/${propertyData.imageFiles.length}`);
          } catch (error) {
            retries--;
            console.error(`Failed to upload image ${i + 1}, retries left: ${retries}`, error);
            
            if (retries === 0) {
              throw new Error(`Failed to upload image ${i + 1} after 3 attempts`);
            }
            
            // Wait before retry
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        }
      }

      // Use provided vibe analysis or analyze vibes from uploaded images
      const vibeAnalysis = propertyData.vibeAnalysis || await analyzeImageVibes(imageUrls, true);

      // Use AI-generated content if available and fields are empty/generic
      const finalTitle = propertyData.title && propertyData.title.trim() && propertyData.title !== 'New Property' ? 
        propertyData.title : 
        (vibeAnalysis?.generated_content?.title || 'Beautiful Rental Property');
      
      const finalDescription = propertyData.description && propertyData.description.trim() && propertyData.description !== 'Property description' ? 
        propertyData.description : 
        (vibeAnalysis?.generated_content?.description || 'A wonderful space perfect for your next home.');
      
      const finalHighlights = propertyData.highlights?.length && propertyData.highlights.some(h => h.trim()) ? 
        propertyData.highlights : 
        (vibeAnalysis?.generated_content?.highlights || ['Great location', 'Modern amenities', 'Spacious rooms']);

      // Create property record
      const { data, error } = await supabase
        .from('properties')
        .insert({
          realtor_id: user.id,
          title: finalTitle,
          description: finalDescription,
          location: propertyData.location,
          price: propertyData.price,
          size: propertyData.size,
          vibe: propertyData.vibe,
          highlights: finalHighlights,
          images: imageUrls,
          vibe_analysis: vibeAnalysis,
          property_source_link: propertyData.propertySourceLink,
          property_source_provider_name: propertyData.propertySourceProviderName,
          property_source_provider_phone: propertyData.propertySourceProviderPhone,
          latitude: propertyData.latitude ?? null,
          longitude: propertyData.longitude ?? null,
          rooms: propertyData.rooms || null,
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: async (data) => {
      // Generate embedding for new property (fire and forget)
      supabase.functions.invoke('generate-property-embedding', {
        body: {
          propertyId: data.id,
          title: data.title,
          description: data.description,
          vibe_analysis: data.vibe_analysis,
          amenities: data.amenities || [],
          location: data.location,
          price: data.price,
        }
      }).catch(err => {
        console.error('[Property Create] Failed to generate embedding:', err);
      });

      // Invalidate cache
      supabase.functions.invoke('property-discovery-cache', {
        body: { action: 'invalidate' },
      });
      
      queryClient.invalidateQueries({ queryKey: ['properties'] });
      queryClient.invalidateQueries({ queryKey: ['realtor-properties'] });
      toast({
        title: "Property Listed!",
        description: "Your property has been successfully added with AI vibe analysis.",
      });
    },
    onError: (error) => {
      console.error('Error creating property:', error);
      toast({
        title: "Error",
        description: "Failed to list property. Please try again.",
        variant: "destructive",
      });
    },
  });

  // Update property mutation
  const updatePropertyMutation = useMutation({
    mutationFn: async (propertyData: {
      id: string;
      title: string;
      description: string;
      location: string;
      price: number;
      size?: string;
      vibe?: string;
      highlights: string[];
      vibeAnalysis?: any;
      newImageFiles?: File[];
      existingImages?: string[];
      amenities?: string[];
      propertySourceLink?: string;
      propertySourceProviderName?: string;
      propertySourceProviderPhone?: string;
      latitude?: number | null;
      longitude?: number | null;
      rooms?: string;
    }) => {
      if (!user?.id) throw new Error('User not authenticated');

      let imageUrls = propertyData.existingImages || [];

      // Upload new images if any with retry logic
      if (propertyData.newImageFiles && propertyData.newImageFiles.length > 0) {
        for (let i = 0; i < propertyData.newImageFiles.length; i++) {
          const file = propertyData.newImageFiles[i];
          let retries = 3;
          let uploaded = false;
          
          while (retries > 0 && !uploaded) {
            try {
              const url = await uploadImage(file);
              imageUrls.push(url);
              uploaded = true;
            } catch (error) {
              retries--;
              if (retries === 0) {
                throw new Error(`Failed to upload new image ${i + 1} after 3 attempts`);
              }
              await new Promise(resolve => setTimeout(resolve, 1000));
            }
          }
        }
      }

      // Update property record
      const updateData: any = {
        title: propertyData.title,
        description: propertyData.description,
        location: propertyData.location,
        price: propertyData.price,
        size: propertyData.size,
        vibe: propertyData.vibe,
        highlights: propertyData.highlights,
        images: imageUrls,
        amenities: propertyData.amenities || [],
        property_source_link: propertyData.propertySourceLink,
        property_source_provider_name: propertyData.propertySourceProviderName,
        property_source_provider_phone: propertyData.propertySourceProviderPhone,
        latitude: propertyData.latitude ?? null,
        longitude: propertyData.longitude ?? null,
        rooms: propertyData.rooms || null,
        updated_at: new Date().toISOString(),
      };

      // Include vibe_analysis if provided
      if (propertyData.vibeAnalysis) {
        updateData.vibe_analysis = propertyData.vibeAnalysis;
      }

      const { data, error } = await supabase
        .from('properties')
        .update(updateData)
        .eq('id', propertyData.id)
        .eq('realtor_id', user.id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: async (data) => {
      // Regenerate embedding for updated property (fire and forget)
      supabase.functions.invoke('generate-property-embedding', {
        body: {
          propertyId: data.id,
          title: data.title,
          description: data.description,
          vibe_analysis: data.vibe_analysis,
          amenities: data.amenities || [],
          location: data.location,
          price: data.price,
        }
      }).catch(err => {
        console.error('[Property Update] Failed to regenerate embedding:', err);
      });

      // Invalidate cache for this specific property
      supabase.functions.invoke('property-discovery-cache', {
        body: { action: 'invalidate', propertyId: data?.id },
      });
      
      queryClient.invalidateQueries({ queryKey: ['properties'] });
      queryClient.invalidateQueries({ queryKey: ['realtor-properties'] });
      toast({
        title: "Property Updated!",
        description: "Your property has been successfully updated.",
      });
    },
    onError: (error) => {
      console.error('Error updating property:', error);
      toast({
        title: "Error",
        description: "Failed to update property. Please try again.",
        variant: "destructive",
      });
    },
  });

  // Delete property mutation
  const deletePropertyMutation = useMutation({
    mutationFn: async (propertyId: string) => {
      if (!user?.id) throw new Error('User not authenticated');

      const { error } = await supabase
        .from('properties')
        .delete()
        .eq('id', propertyId)
        .eq('realtor_id', user.id);

      if (error) throw error;
    },
    onSuccess: () => {
      // Invalidate cache
      supabase.functions.invoke('property-discovery-cache', {
        body: { action: 'invalidate' },
      });
      
      queryClient.invalidateQueries({ queryKey: ['properties'] });
      queryClient.invalidateQueries({ queryKey: ['realtor-properties'] });
      toast({
        title: "Property Deleted!",
        description: "Your property has been successfully removed.",
      });
    },
    onError: (error) => {
      console.error('Error deleting property:', error);
      toast({
        title: "Error",
        description: "Failed to delete property. Please try again.",
        variant: "destructive",
      });
    },
  });

  // Toggle property active status
  const togglePropertyMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      if (!user?.id) throw new Error('User not authenticated');

      const updateData: any = { 
        is_active: isActive,
      };

      // Only update last_activated_at when turning ON
      if (isActive) {
        updateData.last_activated_at = new Date().toISOString();
      }

      const { error } = await supabase
        .from('properties')
        .update(updateData)
        .eq('id', id)
        .eq('realtor_id', user.id);

      if (error) throw error;
    },
    onSuccess: () => {
      // Invalidate cache when toggling property status
      supabase.functions.invoke('property-discovery-cache', {
        body: { action: 'invalidate' },
      });
      
      queryClient.invalidateQueries({ queryKey: ['properties'] });
      queryClient.invalidateQueries({ queryKey: ['realtor-properties'] });
      toast({
        title: "Success",
        description: "Property status updated successfully",
      });
    },
    onError: (error: Error) => {
      console.error('Error toggling property:', error);
      toast({
        title: "Error",
        description: "Failed to update property status. Please try again.",
        variant: "destructive",
      });
    },
  });

  return {
    properties,
    realtorProperties,
    isLoading,
    createProperty: createPropertyMutation.mutate,
    isCreating: createPropertyMutation.isPending,
    updateProperty: updatePropertyMutation.mutate,
    isUpdating: updatePropertyMutation.isPending,
    deleteProperty: deletePropertyMutation.mutate,
    isDeleting: deletePropertyMutation.isPending,
    toggleProperty: togglePropertyMutation.mutate,
    isToggling: togglePropertyMutation.isPending,
  };
};