
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { MapPin, ChevronRight } from 'lucide-react';

interface CityDistrictSelectorProps {
  value: string[];
  onChange: (value: string[]) => void;
}

const CITIES_WITH_DISTRICTS = {
  'Ho Chi Minh City': [
    { name: 'District 1', vibe: 'Business hub with luxury shopping, fine dining, and vibrant nightlife' },
    { name: 'District 2', vibe: 'Modern expat area with international schools and riverside living' },
    { name: 'District 3', vibe: 'Local culture mix with cafes, street food, and affordable living' },
    { name: 'District 4', vibe: 'Authentic local life with traditional markets and riverside views' },
    { name: 'District 5', vibe: 'Chinatown with traditional markets, street food, and cultural heritage' },
    { name: 'District 6', vibe: 'Industrial area with affordable housing and local markets' },
    { name: 'District 7', vibe: 'Family-friendly with malls, parks, and modern apartments' },
    { name: 'District 8', vibe: 'Riverside district with traditional architecture and local charm' },
    { name: 'District 9', vibe: 'Suburban feel with villas, gardens, and quiet neighborhoods' },
    { name: 'District 10', vibe: 'Central location with universities, hospitals, and transportation hubs' },
    { name: 'District 11', vibe: 'Traditional Vietnamese culture with temples and local markets' },
    { name: 'District 12', vibe: 'Developing area with new residential projects and green spaces' },
    { name: 'Binh Thanh', vibe: 'Emerging trendy area with young professionals and creative spaces' },
    { name: 'Tan Binh', vibe: 'Airport district with business hotels and conference centers' },
    { name: 'Tan Phu', vibe: 'Residential area with local markets and affordable living' },
    { name: 'Phu Nhuan', vibe: 'Compact central district with cafes and urban conveniences' },
    { name: 'Go Vap', vibe: 'Suburban district with parks, universities, and family housing' },
    { name: 'Thu Duc', vibe: 'Tech hub with universities, startups, and modern developments' },
    { name: 'Binh Tan', vibe: 'Industrial zone with worker housing and local amenities' },
    { name: 'Cu Chi', vibe: 'Historical tunnels area with rural charm and tourist attractions' }
  ],
  'Hanoi': [
    { name: 'Hoan Kiem', vibe: 'Historic charm with lakes, temples, and cultural attractions' },
    { name: 'Ba Dinh', vibe: 'Political center with museums, wide boulevards, and green spaces' },
    { name: 'Cau Giay', vibe: 'Modern business district with shopping centers and office buildings' },
    { name: 'Tay Ho', vibe: 'Expat favorite with lakeside living and international atmosphere' },
    { name: 'Dong Da', vibe: 'Student area near universities with affordable housing and cafes' },
    { name: 'Hai Ba Trung', vibe: 'Central district with hospitals, schools, and residential areas' },
    { name: 'Hoang Mai', vibe: 'Developing suburb with new apartments and green spaces' },
    { name: 'Long Bien', vibe: 'Historic bridge area with traditional villages and river views' },
    { name: 'Thanh Xuan', vibe: 'Modern residential area with shopping malls and parks' },
    { name: 'Nam Tu Liem', vibe: 'New urban area with modern infrastructure and facilities' },
    { name: 'Bac Tu Liem', vibe: 'Suburban district with universities and residential complexes' },
    { name: 'Ha Dong', vibe: 'Traditional craft village area with local culture and markets' },
    { name: 'Son Tay', vibe: 'Ancient citadel town with historical sites and rural atmosphere' },
    { name: 'Ba Vi', vibe: 'Mountain district with nature reserves and eco-tourism' },
    { name: 'Phuc Tho', vibe: 'Agricultural area with traditional farming and rural lifestyle' },
    { name: 'Dan Phuong', vibe: 'Suburban area with flower villages and agricultural tourism' },
    { name: 'Hoai Duc', vibe: 'Developing suburban area with new residential projects' },
    { name: 'Quoc Oai', vibe: 'Rural district with traditional villages and farming communities' },
    { name: 'Thach That', vibe: 'Mountainous area with scenic landscapes and rural charm' },
    { name: 'Chuong My', vibe: 'Agricultural district with traditional farming and local markets' }
  ],
  'Da Nang': [
    { name: 'Hai Chau', vibe: 'City center with beaches, business district, and urban convenience' },
    { name: 'Son Tra', vibe: 'Peninsula living with beaches, nature, and luxury resorts' },
    { name: 'Ngu Hanh Son', vibe: 'Tourist area with marble mountains and beachfront properties' },
    { name: 'Thanh Khe', vibe: 'Dense urban area with local markets and traditional neighborhoods' },
    { name: 'Cam Le', vibe: 'Airport district with industrial zones and residential areas' },
    { name: 'Lien Chieu', vibe: 'Port area with shipping facilities and worker housing' },
    { name: 'Hoa Vang', vibe: 'Rural outskirts with farming communities and nature' },
    { name: 'Hoang Sa', vibe: 'Island district with fishing communities and marine tourism' }
  ]
};

const CITY_FLAGS = {
  'Ho Chi Minh City': '🏙️',
  'Hanoi': '🏛️',
  'Da Nang': '🏖️'
};

export const CityDistrictSelector = ({ value, onChange }: CityDistrictSelectorProps) => {
  const [selectedCity, setSelectedCity] = useState<string | null>(null);
  const [showDistricts, setShowDistricts] = useState(false);

  const handleCityClick = (city: string) => {
    setSelectedCity(city);
    setShowDistricts(true);
  };

  const handleDistrictToggle = (district: string) => {
    const districtWithCity = `${district}, ${selectedCity}`;
    const isSelected = value.includes(districtWithCity);
    
    if (isSelected) {
      onChange(value.filter(d => d !== districtWithCity));
    } else {
      onChange([...value, districtWithCity]);
    }
  };

  const handleBack = () => {
    setShowDistricts(false);
    setSelectedCity(null);
  };

  const getSelectedCount = () => {
    return value.filter(v => v.includes(selectedCity || '')).length;
  };

  if (showDistricts && selectedCity) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleBack}
              className="p-2"
            >
              <ChevronRight className="w-4 h-4 rotate-180" />
            </Button>
            <div>
              <h4 className="font-medium text-slate-900">Select Districts in {selectedCity}</h4>
              <p className="text-sm text-slate-600">Choose multiple preferred areas</p>
            </div>
          </div>
          {getSelectedCount() > 0 && (
            <Badge variant="secondary" className="bg-orange-100 text-orange-800 text-[10px] sm:text-xs px-1.5 py-0.5 sm:px-2 sm:py-1 leading-tight">
              {getSelectedCount()}
            </Badge>
          )}
        </div>
        
        <div className="space-y-3 max-h-96 overflow-y-auto">
          {CITIES_WITH_DISTRICTS[selectedCity as keyof typeof CITIES_WITH_DISTRICTS].map(district => {
            const districtWithCity = `${district.name}, ${selectedCity}`;
            const isSelected = value.includes(districtWithCity);
            
            return (
              <div
                key={district.name}
                className={`p-4 rounded-lg border-2 transition-all duration-200 cursor-pointer ${
                  isSelected
                    ? 'border-orange-300 bg-orange-50'
                    : 'border-gray-200 hover:border-orange-200 hover:bg-orange-25'
                }`}
                onClick={() => handleDistrictToggle(district.name)}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center space-x-2 mb-2">
                      <span className="font-medium text-slate-900">{district.name}</span>
                      {isSelected && (
                        <Badge className="bg-orange-500 text-white text-xs">Selected</Badge>
                      )}
                    </div>
                    <p className="text-sm text-slate-600 leading-relaxed">{district.vibe}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h4 className="font-medium text-slate-900 mb-2">Select City</h4>
        <p className="text-sm text-slate-600 mb-4">Choose your preferred location</p>
        {value.length > 0 && (
          <div className="mb-3">
            <Badge variant="secondary" className="bg-orange-100 text-orange-800 text-[10px] sm:text-xs px-1.5 py-0.5 sm:px-2 sm:py-1 leading-tight">
              {value.length} area{value.length !== 1 ? 's' : ''}
            </Badge>
          </div>
        )}
      </div>
      
      <div className="grid grid-cols-1 gap-3">
        {Object.entries(CITY_FLAGS).map(([city, flag]) => (
          <Button
            key={city}
            variant="outline"
            className="justify-between p-4 hover:bg-orange-50 hover:border-orange-300 transition-all duration-200"
            onClick={() => handleCityClick(city)}
          >
            <div className="flex items-center space-x-3">
              <span className="text-lg">{flag}</span>
              <span className="font-medium">{city}</span>
            </div>
            <ChevronRight className="w-4 h-4" />
          </Button>
        ))}
      </div>
    </div>
  );
};
