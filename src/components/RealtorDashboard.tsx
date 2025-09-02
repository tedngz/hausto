
import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Plus, MessageSquare, User, MapPin, Upload, Edit, Trash2, Eye } from 'lucide-react';
import { PropertyCard } from '@/components/PropertyCard';
import { PropertyEditModal } from '@/components/PropertyEditModal';
import { PropertyUploadModal } from '@/components/PropertyUploadModal';

import { PropertyPreviewModal } from '@/components/PropertyPreviewModal';
import { AIChatAgent } from '@/components/AIChatAgent';
import { RenterProfileModal } from '@/components/RenterProfileModal';
import { useProperties, Property } from '@/hooks/useProperties';
import { useMatches, PropertyMatch } from '@/hooks/useMatches';
import { useCurrency } from '@/contexts/CurrencyContext';
import { useToast } from '@/hooks/use-toast';

interface RealtorDashboardProps {
  onSwitchUserType: () => void;
  onViewProfile?: () => void;
  onOpenUploadModal?: () => void;
}

export const RealtorDashboard = ({ onSwitchUserType, onViewProfile, onOpenUploadModal }: RealtorDashboardProps) => {
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isPreviewModalOpen, setIsPreviewModalOpen] = useState(false);
  const [isChatModalOpen, setIsChatModalOpen] = useState(false);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [selectedProperty, setSelectedProperty] = useState<Property | null>(null);
  const [selectedMatch, setSelectedMatch] = useState<PropertyMatch | null>(null);
  const { realtorProperties, isLoading, deleteProperty, isDeleting } = useProperties();
  const { realtorMatches, isLoadingMatches } = useMatches();
  const { formatPrice } = useCurrency();
  const { toast } = useToast();

  const unreadMatches = realtorMatches.filter(match => new Date(match.created_at).getTime() > Date.now() - 86400000);

  const handleEdit = (property: Property) => {
    setSelectedProperty(property);
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

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-100 pt-16">
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
          <div className="p-6 border-b border-slate-200">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold text-slate-900">My Properties</h2>
                <p className="text-slate-600 text-sm">Manage your listed properties</p>
              </div>
              <Button 
                onClick={() => setIsUploadModalOpen(true)}
                className="bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700"
              >
                <Upload className="w-4 h-4 mr-2" />
                Add Property
              </Button>
            </div>
          </div>
          
          <div className="p-6">
            {isLoading ? (
              <div className="text-center py-8">
                <p className="text-slate-600">Loading properties...</p>
              </div>
            ) : realtorProperties.length === 0 ? (
              <div className="text-center py-8">
                <Upload className="w-12 h-12 text-slate-400 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-slate-900 mb-2">No properties yet</h3>
                <p className="text-slate-600">Upload your first property to start getting matches!</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
                {realtorProperties.map((property) => (
                  <Card key={property.id} className="overflow-hidden border border-slate-200 hover:shadow-lg transition-shadow">
                    {property.images && property.images.length > 0 && (
                      <div className="relative">
                        <img 
                          src={property.images[0]}
                          alt={property.title}
                          className="w-full h-48 object-cover"
                        />
                        <div className="absolute top-2 right-2">
                          <Badge className="bg-white/90 text-slate-800 font-semibold">
                            {formatPrice(property.price)}/mo
                          </Badge>
                        </div>
                      </div>
                    )}
                    <div className="p-4">
                      <h3 className="font-semibold text-slate-900 mb-2 line-clamp-2">{property.title}</h3>
                      <div className="flex items-center text-sm text-slate-600 mb-2">
                        <MapPin className="w-3 h-3 mr-1" />
                        {property.location}
                      </div>
                      {property.vibe && (
                        <Badge variant="secondary" className="bg-orange-100 text-orange-800 mb-3">
                          {property.vibe}
                        </Badge>
                      )}
                      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center space-y-2 sm:space-y-0">
                        <div className="flex flex-wrap gap-1">
                          <Button 
                            size="sm" 
                            variant="outline"
                            onClick={() => handlePreview(property)}
                            className="text-xs px-2 py-1"
                          >
                            <Eye className="w-3 h-3 mr-1" />
                            <span className="hidden sm:inline">Preview</span>
                          </Button>
                          <Button 
                            size="sm" 
                            variant="outline"
                            onClick={() => handleEdit(property)}
                            className="text-xs px-2 py-1"
                          >
                            <Edit className="w-3 h-3 mr-1" />
                            <span className="hidden sm:inline">Edit</span>
                          </Button>
                          <Button 
                            size="sm" 
                            variant="outline"
                            onClick={() => handleDelete(property)}
                            disabled={isDeleting}
                            className="text-red-600 hover:text-red-700 hover:bg-red-50 text-xs px-2 py-1"
                          >
                            <Trash2 className="w-3 h-3 mr-1" />
                            <span className="hidden sm:inline">Delete</span>
                          </Button>
                        </div>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </Card>

        {/* Interested Renters */}
        <Card className="bg-white/90 backdrop-blur-sm border-slate-200 shadow-lg">
          <div className="p-6 border-b border-slate-200">
            <h2 className="text-xl font-semibold text-slate-900">Interested Renters</h2>
            <p className="text-slate-600 text-sm">Connect with potential tenants</p>
          </div>
          
          <div className="p-6">
            {isLoadingMatches ? (
              <div className="text-center py-8">
                <p className="text-slate-600">Loading matches...</p>
              </div>
            ) : realtorMatches.length === 0 ? (
              <div className="text-center py-8">
                <User className="w-12 h-12 text-slate-400 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-slate-900 mb-2">No interested renters yet</h3>
                <p className="text-slate-600">Your properties will start getting interest once renters discover them!</p>
              </div>
            ) : (
              <div className="space-y-4">
                {realtorMatches.map((match) => (
                  <div key={match.id} className="flex flex-col lg:flex-row lg:items-center justify-between p-4 border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors space-y-3 lg:space-y-0">
                    <div className="flex items-center space-x-4">
                      <div className="w-10 h-10 lg:w-12 lg:h-12 bg-gradient-to-r from-primary to-secondary rounded-full flex items-center justify-center text-white font-semibold text-sm lg:text-base">
                        R
                      </div>
                       <div className="flex-1">
                         <button 
                           className="font-medium text-slate-900 text-sm lg:text-base hover:text-primary transition-colors text-left"
                           onClick={() => handleViewProfile(match)}
                         >
                           {match.renter_name || 'Anonymous Renter'}
                         </button>
                         <p className="text-xs lg:text-sm text-slate-600">{match.properties?.title}</p>
                        <div className="flex items-center text-xs lg:text-sm text-slate-600 mt-1">
                          <MapPin className="w-3 h-3 mr-1" />
                          {match.properties?.location}
                        </div>
                        <div className="flex items-center space-x-2 mt-2">
                          <Badge variant="secondary" className="bg-slate-100 text-slate-700 text-xs">
                            {formatPrice(match.properties?.price || 0)}/mo
                          </Badge>
                          <Badge className="bg-primary/10 text-primary text-xs">
                            {match.properties?.vibe}
                          </Badge>
                        </div>
                      </div>
                    </div>
                    
                    <div className="flex flex-col sm:flex-row items-start sm:items-center space-y-2 sm:space-y-0 sm:space-x-3">
                      <div className="text-left sm:text-right">
                        <p className="text-xs text-slate-500">
                          {new Date(match.created_at).toLocaleDateString()}
                        </p>
                        <p className="text-xs text-slate-500">
                          {new Date(match.created_at).toLocaleTimeString()}
                        </p>
                      </div>
                      <div className="flex flex-col sm:flex-row space-y-1 sm:space-y-0 sm:space-x-2">
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-blue-200 text-blue-600 hover:bg-blue-50 text-xs px-2 py-1"
                          onClick={() => handleViewProfile(match)}
                        >
                          <User className="w-3 h-3 mr-1" />
                          View Profile
                        </Button>
                        <Button
                          size="sm"
                          className="bg-gradient-to-r from-primary to-secondary hover:shadow-lg text-white text-xs px-2 py-1"
                          onClick={() => handleChat(match)}
                        >
                          <MessageSquare className="w-3 h-3 mr-1" />
                          Chat
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Card>
      </div>

      <PropertyUploadModal 
        isOpen={isUploadModalOpen}
        onClose={() => setIsUploadModalOpen(false)}
      />

      <PropertyEditModal 
        isOpen={isEditModalOpen}
        onClose={() => {
          setIsEditModalOpen(false);
          setSelectedProperty(null);
        }}
        property={selectedProperty}
      />

      <PropertyPreviewModal 
        isOpen={isPreviewModalOpen}
        onClose={() => {
          setIsPreviewModalOpen(false);
          setSelectedProperty(null);
        }}
        property={selectedProperty}
      />

      <AIChatAgent
        isOpen={isChatModalOpen}
        onClose={() => {
          setIsChatModalOpen(false);
          setSelectedMatch(null);
        }}
        userType="realtor"
      />

      {selectedMatch && (
        <RenterProfileModal
          userId={selectedMatch.renter_id}
          isOpen={isProfileModalOpen}
          onClose={() => {
            setIsProfileModalOpen(false);
            setSelectedMatch(null);
          }}
        />
      )}
    </div>
  );
};
