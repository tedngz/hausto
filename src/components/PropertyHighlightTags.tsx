import { Badge } from '@/components/ui/badge';
import { Building, Paintbrush, Wrench } from 'lucide-react';

interface PropertyHighlightTagsProps {
  apartment: any;
  maxTagsPerCategory?: number;
  showIcons?: boolean;
}

// Helper function to categorize highlights based on architectural and design features
const categorizeHighlight = (highlight: string): 'architectural' | 'design' | 'amenity' => {
  const lowerHighlight = highlight.toLowerCase();
  
  // Architectural features - structure, windows, floors, ceilings
  const architecturalKeywords = [
    'windows', 'ceiling', 'ceilings', 'floors', 'flooring', 'walls', 'doors', 'beams', 'exposed', 
    'brick', 'concrete', 'hardwood', 'marble', 'granite', 'stone', 'tile', 'parquet',
    'floor-to-ceiling', 'vaulted', 'high', 'panoramic', 'bay', 'french', 'sliding',
    'built-in', 'custom', 'millwork', 'molding', 'wainscoting'
  ];
  
  // Design & materials - finishes, lighting, style elements
  const designKeywords = [
    'lighting', 'pendant', 'chandelier', 'sconces', 'natural light', 'designer', 
    'stainless steel', 'brass', 'copper', 'wood grain', 'painted', 'lacquered',
    'modern', 'contemporary', 'industrial', 'minimalist', 'luxury', 'elegant',
    'neutral', 'warm', 'bright', 'colorful', 'stylish', 'chic', 'sophisticated'
  ];
  
  // Amenities & functional features - appliances, fixtures, storage
  const amenityKeywords = [
    'appliances', 'kitchen island', 'dishwasher', 'refrigerator', 'oven', 'microwave',
    'shower', 'bathtub', 'vanity', 'storage', 'closet', 'wardrobes', 'cabinets',
    'balcony', 'terrace', 'patio', 'air conditioning', 'heating', 'laundry',
    'walk-in', 'en-suite', 'master', 'guest', 'private', 'shared'
  ];
  
  for (const keyword of architecturalKeywords) {
    if (lowerHighlight.includes(keyword)) return 'architectural';
  }
  
  for (const keyword of designKeywords) {
    if (lowerHighlight.includes(keyword)) return 'design';
  }
  
  for (const keyword of amenityKeywords) {
    if (lowerHighlight.includes(keyword)) return 'amenity';
  }
  
  // Default based on common patterns
  if (lowerHighlight.includes('view') || lowerHighlight.includes('space') || lowerHighlight.includes('room')) {
    return 'architectural';
  }
  
  return 'design'; // Default to design
};

const getCategorizedHighlights = (apartment: any) => {
  // Prioritize AI-generated highlights from vibe_analysis
  const aiHighlights = apartment?.vibe_analysis?.generated_content?.highlights;
  const highlights = aiHighlights || apartment?.highlights || [];
  
  if (!Array.isArray(highlights) || highlights.length === 0) {
    return {
      architectural: ['Modern layout', 'Natural light'],
      design: ['Contemporary style', 'Neutral palette'],
      amenity: ['Updated fixtures', 'Built-in storage']
    };
  }

  const categorized = {
    architectural: [] as string[],
    design: [] as string[],
    amenity: [] as string[]
  };

  highlights.forEach((highlight: string) => {
    const category = categorizeHighlight(highlight);
    categorized[category].push(highlight);
  });

  // Ensure each category has at least one highlight for better display
  if (categorized.architectural.length === 0) {
    const vibeAnalysis = apartment?.vibe_analysis;
    if (vibeAnalysis) {
      if (vibeAnalysis.natural_light >= 7) categorized.architectural.push('Abundant windows');
      if (vibeAnalysis.spacious >= 7) categorized.architectural.push('Open layout');
      if (vibeAnalysis.modern >= 7) categorized.architectural.push('Modern architecture');
    }
    if (categorized.architectural.length === 0) categorized.architectural = ['Well-designed space'];
  }
  
  if (categorized.design.length === 0) {
    const vibeAnalysis = apartment?.vibe_analysis;
    if (vibeAnalysis) {
      if (vibeAnalysis.elegant >= 7) categorized.design.push('Elegant finishes');
      if (vibeAnalysis.minimalist >= 7) categorized.design.push('Clean lines');
      if (vibeAnalysis.luxurious >= 7) categorized.design.push('Premium materials');
    }
    if (categorized.design.length === 0) categorized.design = ['Thoughtful design'];
  }
  
  if (categorized.amenity.length === 0) {
    const vibeAnalysis = apartment?.vibe_analysis;
    if (vibeAnalysis) {
      if (vibeAnalysis.modern >= 7) categorized.amenity.push('Updated amenities');
    }
    if (categorized.amenity.length === 0) categorized.amenity = ['Essential features'];
  }

  return categorized;
};

export const PropertyHighlightTags = ({ 
  apartment, 
  maxTagsPerCategory = 2, 
  showIcons = true 
}: PropertyHighlightTagsProps) => {
  const categorizedHighlights = getCategorizedHighlights(apartment);

  return (
    <div className="space-y-3">
      {/* Architectural Features */}
      {categorizedHighlights.architectural.length > 0 && (
        <div>
          <div className="flex items-center mb-1">
            {showIcons && <Building className="w-3 h-3 text-blue-500 mr-1" />}
            <h5 className="text-xs font-medium text-gray-700">Architecture</h5>
          </div>
          <div className="flex flex-wrap gap-1">
            {categorizedHighlights.architectural.slice(0, maxTagsPerCategory).map((highlight, index) => (
              <Badge key={index} variant="secondary" className="text-xs px-2 py-1 bg-blue-50 text-blue-700 border-blue-200">
                {highlight}
              </Badge>
            ))}
          </div>
        </div>
      )}
      
      {/* Design & Finishes */}
      {categorizedHighlights.design.length > 0 && (
        <div>
          <div className="flex items-center mb-1">
            {showIcons && <Paintbrush className="w-3 h-3 text-purple-500 mr-1" />}
            <h5 className="text-xs font-medium text-gray-700">Design & Finishes</h5>
          </div>
          <div className="flex flex-wrap gap-1">
            {categorizedHighlights.design.slice(0, maxTagsPerCategory).map((highlight, index) => (
              <Badge key={index} variant="secondary" className="text-xs px-2 py-1 bg-purple-50 text-purple-700 border-purple-200">
                {highlight}
              </Badge>
            ))}
          </div>
        </div>
      )}
      
      {/* Amenities & Features */}
      {categorizedHighlights.amenity.length > 0 && (
        <div>
          <div className="flex items-center mb-1">
            {showIcons && <Wrench className="w-3 h-3 text-green-500 mr-1" />}
            <h5 className="text-xs font-medium text-gray-700">Amenities & Features</h5>
          </div>
          <div className="flex flex-wrap gap-1">
            {categorizedHighlights.amenity.slice(0, maxTagsPerCategory).map((highlight, index) => (
              <Badge key={index} variant="secondary" className="text-xs px-2 py-1 bg-green-50 text-green-700 border-green-200">
                {highlight}
              </Badge>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};