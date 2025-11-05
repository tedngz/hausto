import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Plus, MessageSquare, User, MapPin, Upload, Edit, Trash2, Eye, FileSpreadsheet } from 'lucide-react';
import { PropertyCard } from '@/components/PropertyCard';
import { PropertyEditModal } from '@/components/PropertyEditModal';
import { PropertyUploadModal } from '@/components/PropertyUploadModal';
import { BulkUploadModal } from '@/components/BulkUploadModal';
import { PropertyPreviewModal } from '@/components/PropertyPreviewModal';
import { HaustoChat } from '@/components/HaustoChat';
import { RenterProfileModal } from '@/components/RenterProfileModal';
import { useProperties, Property } from '@/hooks/useProperties';
import { useMatches, PropertyMatch } from '@/hooks/useMatches';
import { useCurrency } from '@/contexts/CurrencyContext';
import { useToast } from '@/hooks/use-toast';
import { useIsMobile } from '@/hooks/use-mobile';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
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
  const [isPreviewModalOpen, setIsPreviewModalOpen] = useState(false);
  const [isChatModalOpen, setIsChatModalOpen] = useState(false);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [selectedProperty, setSelectedProperty] = useState<Property | null>(null);
  const [selectedMatch, setSelectedMatch] = useState<PropertyMatch | null>(null);
  const {
    realtorProperties,
    isLoading,
    deleteProperty,
    isDeleting,
    toggleProperty,
    isToggling
  } = useProperties();
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
  const handleToggleActive = (property: Property) => {
    toggleProperty({
      id: property.id,
      isActive: !property.is_active
    });
  };
  const getDaysRemaining = (lastActivated?: string) => {
    if (!lastActivated) return 0;
    const activatedDate = new Date(lastActivated);
    const now = new Date();
    const diffTime = 10 * 24 * 60 * 60 * 1000 - (now.getTime() - activatedDate.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return Math.max(0, diffDays);
  };
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
            <div className="flex flex-col space-y-4 md:flex-row md:items-center md:justify-between md:space-y-0">
              <div>
                <h2 className="text-lg md:text-xl font-semibold text-slate-900">My Properties</h2>
                <p className="text-slate-600 text-sm">
                  Manage your listed properties • 
                  {realtorProperties.filter(p => !p.property_source_provider_name).length} Direct • 
                  {realtorProperties.filter(p => p.property_source_provider_name).length} Partner
                </p>
              </div>
              <div className="flex flex-col sm:flex-row gap-2">
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
          </div>
          <div className="p-4 md:p-6">
            {isLoading ? <div className="text-center py-8">
                <p className="text-slate-600">Loading properties...</p>
              </div> : realtorProperties.length === 0 ? <div className="text-center py-8">
                <Upload className="w-12 h-12 text-slate-400 mx-auto mb-4" />
                <h3 className="text-base md:text-lg font-medium text-slate-900 mb-2">No properties yet</h3>
                <p className="text-slate-600 text-sm">Upload your first property to start getting matches!</p>
              </div> : <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {realtorProperties.map(property => <Card key={property.id} className="overflow-hidden border border-slate-200 hover:shadow-lg transition-shadow">
                    {property.images && property.images.length > 0 && <div className="relative">
                        <img src={property.images[0]} alt={property.title} className="w-full h-32 md:h-48 object-cover" />
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
                        {property.is_active && <div className="text-xs text-slate-500">
                            {getDaysRemaining(property.last_activated_at)} days remaining
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
    }} property={selectedProperty} />

      <PropertyPreviewModal isOpen={isPreviewModalOpen} onClose={() => {
      setIsPreviewModalOpen(false);
      setSelectedProperty(null);
    }} property={selectedProperty} />

      <HaustoChat isOpen={isChatModalOpen} onClose={() => {
      setIsChatModalOpen(false);
      setSelectedMatch(null);
    }} userType="realtor" />

      {selectedMatch && <RenterProfileModal userId={selectedMatch.renter_id} isOpen={isProfileModalOpen} onClose={() => {
      setIsProfileModalOpen(false);
      setSelectedMatch(null);
    }} />}
    </div>;
};