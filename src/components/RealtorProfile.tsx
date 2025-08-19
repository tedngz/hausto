import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { 
  User, 
  Mail, 
  Phone, 
  MapPin, 
  Edit3, 
  Save, 
  X,
  Building,
  Heart,
  MessageCircle,
  TrendingUp,
  Upload,
  Calendar,
  Star,
  Camera
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useCurrency } from '@/contexts/CurrencyContext';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

interface RealtorProfileProps {
  userId?: string;
}

interface UserProfile {
  id: string;
  name: string;
  email: string;
  phone?: string;
  bio?: string;
  location?: string;
  avatar_url?: string;
}

export const RealtorProfile = ({ userId }: RealtorProfileProps) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { formatPrice } = useCurrency();
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState({
    name: '',
    phone: '',
    bio: '',
    location: ''
  });
  const [uploading, setUploading] = useState(false);

  const profileId = userId || user?.id;
  const isOwnProfile = profileId === user?.id;

  // Fetch user profile - only for own profile due to RLS policies
  const { data: profile, isLoading } = useQuery({
    queryKey: ['profile', profileId, isOwnProfile],
    queryFn: async () => {
      if (!profileId) return null;
      
      if (isOwnProfile) {
        // Can fetch full profile data for own profile
        const { data, error } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', profileId)
          .maybeSingle();

        if (error) {
          console.error('Error fetching own profile:', error);
          throw error;
        }
        
        return data as UserProfile;
      } else {
        // For other users, only return basic public info
        // Use the secure function to get limited public data
        const { data, error } = await supabase
          .rpc('get_matched_public_profiles', { user_ids: [profileId] });

        if (error) {
          console.error('Error fetching public profile:', error);
          return null; // Don't throw, just return null for other users
        }

        // Return limited profile structure
        return data?.[0] ? {
          id: data[0].id,
          name: data[0].name,
          email: '', // Hidden for privacy
          phone: '', // Hidden for privacy
          bio: '', // Hidden for privacy
          location: '' // Hidden for privacy
        } as UserProfile : null;
      }
    },
    enabled: !!profileId,
  });

  // Fetch realtor stats
  const { data: stats } = useQuery({
    queryKey: ['realtor-stats', profileId],
    queryFn: async () => {
      if (!profileId) return null;
      
      const [propertiesRes, matchesRes, recentMatchesRes] = await Promise.all([
        supabase
          .from('properties')
          .select('id, title, price, location, vibe, created_at')
          .eq('realtor_id', profileId)
          .order('created_at', { ascending: false }),
        supabase
          .from('property_matches')
          .select('id, created_at')
          .eq('realtor_id', profileId),
        supabase
          .from('property_matches')
          .select('id, created_at')
          .eq('realtor_id', profileId)
          .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
      ]);

      const properties = propertiesRes.data || [];
      const matches = matchesRes.data || [];
      const recentMatches = recentMatchesRes.data || [];

      // Calculate average property price
      const avgPrice = properties.length > 0 
        ? properties.reduce((sum, p) => sum + (p.price || 0), 0) / properties.length 
        : 0;

      return {
        properties,
        totalProperties: properties.length,
        totalMatches: matches.length,
        recentMatches: recentMatches.length,
        avgPrice,
        joinedDate: properties[0]?.created_at || null
      };
    },
    enabled: !!profileId,
  });

  // Update profile mutation
  const updateProfileMutation = useMutation({
    mutationFn: async (updates: Partial<UserProfile>) => {
      if (!user?.id) throw new Error('User not authenticated');

      const { data, error } = await supabase
        .from('profiles')
        .upsert({
          id: user.id,
          email: updates.email || user?.email || '',
          name: updates.name || '',
          phone: updates.phone || null,
          bio: updates.bio || null,
          location: updates.location || null,
          avatar_url: updates.avatar_url || null,
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['profile', profileId] });
      setIsEditing(false);
      toast({
        title: "Profile Updated",
        description: "Your profile has been successfully updated.",
      });
    },
    onError: (error) => {
      console.error('Error updating profile:', error);
      toast({
        title: "Error",
        description: "Failed to update profile. Please try again.",
        variant: "destructive",
      });
    },
  });

  useEffect(() => {
    if (profile) {
      setEditForm({
        name: profile.name || '',
        phone: profile.phone || '',
        bio: profile.bio || '',
        location: profile.location || ''
      });
    }
  }, [profile]);

  const handleAvatarUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    try {
      setUploading(true);
      
      if (!event.target.files || event.target.files.length === 0) {
        throw new Error('You must select an image to upload.');
      }

      const file = event.target.files[0];
      const fileExt = file.name.split('.').pop();
      const fileName = `${user?.id}/avatar.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(fileName, file, { upsert: true });

      if (uploadError) {
        throw uploadError;
      }

      const { data } = supabase.storage.from('avatars').getPublicUrl(fileName);
      
      await updateProfileMutation.mutateAsync({ 
        ...profile, 
        avatar_url: data.publicUrl 
      });

      toast({
        title: "Avatar Updated",
        description: "Your profile picture has been updated successfully.",
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setUploading(false);
    }
  };

  const handleSave = () => {
    updateProfileMutation.mutate({
      ...editForm,
      email: profile?.email || user?.email || '',
    });
  };

  const handleCancel = () => {
    if (profile) {
      setEditForm({
        name: profile.name || '',
        phone: profile.phone || '',
        bio: profile.bio || '',
        location: profile.location || ''
      });
    }
    setIsEditing(false);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full"></div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 max-w-4xl pt-20">
      <div className="grid gap-6">
        {/* Header */}
        <Card>
          <CardHeader className="pb-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-4">
                <div className="relative group">
                  <Avatar className="w-16 h-16">
                    <AvatarImage src={profile?.avatar_url} />
                    <AvatarFallback className="bg-blue-100">
                      <User className="w-8 h-8 text-blue-600" />
                    </AvatarFallback>
                  </Avatar>
                  {isOwnProfile && (
                    <>
                      <label 
                        htmlFor="avatar-upload-realtor" 
                        className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-50 rounded-full opacity-0 group-hover:opacity-100 cursor-pointer transition-opacity"
                      >
                        <Camera className="w-5 h-5 text-white" />
                        <input
                          id="avatar-upload-realtor"
                          type="file"
                          accept="image/*"
                          onChange={handleAvatarUpload}
                          disabled={uploading}
                          className="hidden"
                        />
                      </label>
                      {uploading && (
                        <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-50 rounded-full">
                          <div className="animate-spin w-5 h-5 border-2 border-white border-t-transparent rounded-full"></div>
                        </div>
                      )}
                    </>
                  )}
                </div>
                <div>
                  <CardTitle className="text-2xl">
                    {profile?.name || profile?.email || 'Realtor Profile'}
                  </CardTitle>
                  <Badge variant="secondary" className="mt-1 bg-blue-100 text-blue-700">
                    Property Owner
                  </Badge>
                  {stats?.joinedDate && (
                    <div className="flex items-center text-sm text-gray-500 mt-1">
                      <Calendar className="w-3 h-3 mr-1" />
                      Member since {new Date(stats.joinedDate).toLocaleDateString()}
                    </div>
                  )}
                </div>
              </div>
              {isOwnProfile && (
                <Button
                  onClick={() => setIsEditing(!isEditing)}
                  variant={isEditing ? "ghost" : "outline"}
                  className={isEditing ? "text-red-600 hover:text-red-700" : ""}
                >
                  {isEditing ? <X className="w-4 h-4 mr-2" /> : <Edit3 className="w-4 h-4 mr-2" />}
                  {isEditing ? 'Cancel' : 'Edit Profile'}
                </Button>
              )}
            </div>
          </CardHeader>
        </Card>

        <div className="grid lg:grid-cols-3 gap-6">
          {/* Profile Information */}
          <div className="lg:col-span-2">
            <Card>
              <CardHeader>
                <CardTitle>Profile Information</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {isEditing && isOwnProfile ? (
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label htmlFor="name">Full Name</Label>
                        <Input
                          id="name"
                          value={editForm.name}
                          onChange={(e) => setEditForm(prev => ({ ...prev, name: e.target.value }))}
                          placeholder="Enter your full name"
                        />
                      </div>
                      <div>
                        <Label htmlFor="phone">Phone Number</Label>
                        <Input
                          id="phone"
                          value={editForm.phone}
                          onChange={(e) => setEditForm(prev => ({ ...prev, phone: e.target.value }))}
                          placeholder="Enter your phone number"
                        />
                      </div>
                    </div>
                    
                    <div>
                      <Label htmlFor="location">Location</Label>
                      <Input
                        id="location"
                        value={editForm.location}
                        onChange={(e) => setEditForm(prev => ({ ...prev, location: e.target.value }))}
                        placeholder="Enter your location"
                      />
                    </div>
                    
                    <div>
                      <Label htmlFor="bio">About Me</Label>
                      <Textarea
                        id="bio"
                        value={editForm.bio}
                        onChange={(e) => setEditForm(prev => ({ ...prev, bio: e.target.value }))}
                        placeholder="Tell renters about yourself and your properties..."
                        rows={4}
                      />
                    </div>
                    
                    <div className="flex space-x-2 pt-4">
                      <Button 
                        onClick={handleSave}
                        disabled={updateProfileMutation.isPending}
                        className="flex-1"
                      >
                        <Save className="w-4 h-4 mr-2" />
                        {updateProfileMutation.isPending ? 'Saving...' : 'Save Changes'}
                      </Button>
                      <Button 
                        variant="outline" 
                        onClick={handleCancel}
                        className="flex-1"
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {isOwnProfile ? (
                      // Show full details for own profile
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="flex items-center space-x-3">
                          <Mail className="w-4 h-4 text-gray-500" />
                          <div>
                            <p className="text-sm text-gray-500">Email</p>
                            <p className="font-medium">{profile?.email || 'Not provided'}</p>
                          </div>
                        </div>
                        
                        <div className="flex items-center space-x-3">
                          <Phone className="w-4 h-4 text-gray-500" />
                          <div>
                            <p className="text-sm text-gray-500">Phone</p>
                            <p className="font-medium">{profile?.phone || 'Not provided'}</p>
                          </div>
                        </div>
                      </div>
                    ) : (
                      // Show privacy message for other users' profiles
                      <div className="text-center py-8">
                        <div className="w-16 h-16 rounded-full bg-blue-100 flex items-center justify-center mx-auto mb-4">
                          <User className="w-8 h-8 text-blue-600" />
                        </div>
                        <h3 className="text-lg font-semibold mb-2">{profile?.name || 'Anonymous User'}</h3>
                        <p className="text-sm text-muted-foreground">
                          For privacy protection, contact details are only shared during direct communication.
                        </p>
                      </div>
                    )}
                    
                    {isOwnProfile && profile?.location && (
                      <div className="flex items-center space-x-3">
                        <MapPin className="w-4 h-4 text-gray-500" />
                        <div>
                          <p className="text-sm text-gray-500">Location</p>
                          <p className="font-medium">{profile.location}</p>
                        </div>
                      </div>
                    )}
                    
                    {isOwnProfile && profile?.bio && (
                      <div>
                        <p className="text-sm text-gray-500 mb-2">About Me</p>
                        <p className="text-gray-700 leading-relaxed">{profile.bio}</p>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Stats & Activity */}
          <div className="space-y-6">
            {/* Activity Stats */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <TrendingUp className="w-5 h-5 text-blue-500" />
                  Activity Stats
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <Building className="w-4 h-4 text-blue-500" />
                    <span className="text-sm text-gray-600">Properties Listed</span>
                  </div>
                  <Badge variant="secondary" className="bg-blue-50 text-blue-700">
                    {stats?.totalProperties || 0}
                  </Badge>
                </div>
                
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <Heart className="w-4 h-4 text-red-500" />
                    <span className="text-sm text-gray-600">Total Matches</span>
                  </div>
                  <Badge variant="secondary" className="bg-red-50 text-red-700">
                    {stats?.totalMatches || 0}
                  </Badge>
                </div>
                
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <MessageCircle className="w-4 h-4 text-green-500" />
                    <span className="text-sm text-gray-600">Recent Interest</span>
                  </div>
                  <Badge variant="secondary" className="bg-green-50 text-green-700">
                    {stats?.recentMatches || 0}
                  </Badge>
                </div>

                {stats?.avgPrice && stats.avgPrice > 0 && (
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <Star className="w-4 h-4 text-orange-500" />
                      <span className="text-sm text-gray-600">Avg. Price</span>
                    </div>
                    <Badge variant="secondary" className="bg-orange-50 text-orange-700">
                      {formatPrice(stats.avgPrice)}
                    </Badge>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Recent Properties */}
            {stats?.properties && stats.properties.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Upload className="w-5 h-5 text-purple-500" />
                    Recent Properties
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {stats.properties.slice(0, 3).map((property) => (
                      <div key={property.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                        <div className="flex-1">
                          <h4 className="font-medium text-sm">{property.title}</h4>
                          <div className="flex items-center text-xs text-gray-500 mt-1">
                            <MapPin className="w-3 h-3 mr-1" />
                            {property.location}
                          </div>
                          {property.vibe && (
                            <Badge variant="secondary" className="mt-1 text-xs">
                              {property.vibe}
                            </Badge>
                          )}
                        </div>
                        <div className="text-right">
                          <p className="font-semibold text-sm">{formatPrice(property.price)}</p>
                          <p className="text-xs text-gray-500">per month</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};