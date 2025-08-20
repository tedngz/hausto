import { Badge } from '@/components/ui/badge';
import { Home, Palette, Activity } from 'lucide-react';

interface PropertyHighlightTagsProps {
  apartment: any;
  maxTagsPerCategory?: number;
  showIcons?: boolean;
}

// Helper function to categorize highlights (consistent across all components)
const categorizeHighlight = (highlight: string): 'style' | 'color' | 'activity' => {
  const lowerHighlight = highlight.toLowerCase();
  
  // Style keywords
  const styleKeywords = ['modern', 'traditional', 'minimalist', 'bohemian', 'industrial', 'scandinavian', 'contemporary', 'rustic', 'vintage', 'luxury', 'urban', 'cozy', 'sleek', 'elegant', 'chic'];
  
  // Color keywords  
  const colorKeywords = ['warm', 'cool', 'neutral', 'bold', 'bright', 'dark', 'colorful', 'white', 'black', 'grey', 'beige', 'wood', 'natural', 'light'];
  
  // Activity keywords
  const activityKeywords = ['working', 'entertaining', 'relaxing', 'cooking', 'exercising', 'reading', 'creating', 'dining', 'sleeping', 'studying', 'socializing'];
  
  for (const keyword of styleKeywords) {
    if (lowerHighlight.includes(keyword)) return 'style';
  }
  
  for (const keyword of colorKeywords) {
    if (lowerHighlight.includes(keyword)) return 'color';
  }
  
  for (const keyword of activityKeywords) {
    if (lowerHighlight.includes(keyword)) return 'activity';
  }
  
  // Default to style if no match
  return 'style';
};

const getCategorizedHighlights = (apartment: any) => {
  // Prioritize AI-generated highlights from vibe_analysis
  const aiHighlights = apartment?.vibe_analysis?.generated_content?.highlights;
  const highlights = aiHighlights || apartment?.highlights || [];
  
  if (!Array.isArray(highlights) || highlights.length === 0) {
    return {
      style: ['Modern', 'Stylish'],
      color: ['Neutral', 'Warm'],
      activity: ['Relaxing', 'Reading']
    };
  }

  const categorized = {
    style: [] as string[],
    color: [] as string[],
    activity: [] as string[]
  };

  highlights.forEach((highlight: string) => {
    const category = categorizeHighlight(highlight);
    categorized[category].push(highlight);
  });

  // Fill with AI-detected or fallback highlights
  if (categorized.style.length === 0) {
    // Try to derive from AI analysis
    const vibeAnalysis = apartment?.vibe_analysis;
    if (vibeAnalysis) {
      if (vibeAnalysis.modern >= 7) categorized.style.push('Modern');
      if (vibeAnalysis.minimalist >= 7) categorized.style.push('Minimalist');
      if (vibeAnalysis.elegant >= 7) categorized.style.push('Elegant');
      if (vibeAnalysis.cozy >= 7) categorized.style.push('Cozy');
    }
    if (categorized.style.length === 0) categorized.style = ['Stylish', 'Contemporary'];
  }
  
  if (categorized.color.length === 0) {
    const vibeAnalysis = apartment?.vibe_analysis;
    if (vibeAnalysis) {
      if (vibeAnalysis.natural_light >= 7) categorized.color.push('Bright');
      if (vibeAnalysis.colorful >= 7) categorized.color.push('Colorful');
    }
    if (categorized.color.length === 0) categorized.color = ['Neutral', 'Warm'];
  }
  
  if (categorized.activity.length === 0) {
    const vibeAnalysis = apartment?.vibe_analysis;
    if (vibeAnalysis) {
      if (vibeAnalysis.spacious >= 7) categorized.activity.push('Entertaining');
    }
    if (categorized.activity.length === 0) categorized.activity = ['Relaxing', 'Comfortable'];
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
      {/* Style Tags */}
      {categorizedHighlights.style.length > 0 && (
        <div>
          <div className="flex items-center mb-1">
            {showIcons && <Home className="w-3 h-3 text-blue-500 mr-1" />}
            <h5 className="text-xs font-medium text-gray-700">Style</h5>
          </div>
          <div className="flex flex-wrap gap-1">
            {categorizedHighlights.style.slice(0, maxTagsPerCategory).map((highlight, index) => (
              <Badge key={index} variant="secondary" className="text-xs px-2 py-1 bg-blue-50 text-blue-700 border-blue-200">
                {highlight}
              </Badge>
            ))}
          </div>
        </div>
      )}
      
      {/* Color Tags */}
      {categorizedHighlights.color.length > 0 && (
        <div>
          <div className="flex items-center mb-1">
            {showIcons && <Palette className="w-3 h-3 text-purple-500 mr-1" />}
            <h5 className="text-xs font-medium text-gray-700">Colors & Ambiance</h5>
          </div>
          <div className="flex flex-wrap gap-1">
            {categorizedHighlights.color.slice(0, maxTagsPerCategory).map((highlight, index) => (
              <Badge key={index} variant="secondary" className="text-xs px-2 py-1 bg-purple-50 text-purple-700 border-purple-200">
                {highlight}
              </Badge>
            ))}
          </div>
        </div>
      )}
      
      {/* Activity Tags */}
      {categorizedHighlights.activity.length > 0 && (
        <div>
          <div className="flex items-center mb-1">
            {showIcons && <Activity className="w-3 h-3 text-green-500 mr-1" />}
            <h5 className="text-xs font-medium text-gray-700">Activities</h5>
          </div>
          <div className="flex flex-wrap gap-1">
            {categorizedHighlights.activity.slice(0, maxTagsPerCategory).map((highlight, index) => (
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