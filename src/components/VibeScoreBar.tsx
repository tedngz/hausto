import { VibeScore } from '@/utils/vibeScoring';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Home, Palette, Activity, DollarSign } from 'lucide-react';

interface VibeScoreBarProps {
  score: VibeScore;
  showBreakdown?: boolean;
  className?: string;
  apartment?: any;
}

export const VibeScoreBar = ({ score, showBreakdown = false, className = "", apartment }: VibeScoreBarProps) => {
  const getVibeLevel = (scoreValue: number) => {
    if (scoreValue >= 80) return { level: 'Perfect Vibe', color: 'text-emerald-600 bg-emerald-100', emoji: '🔥' };
    if (scoreValue >= 65) return { level: 'Strong Vibe', color: 'text-blue-600 bg-blue-100', emoji: '✨' };
    if (scoreValue >= 50) return { level: 'Good Vibe', color: 'text-orange-600 bg-orange-100', emoji: '⭐' };
    return { level: 'Casual Vibe', color: 'text-gray-600 bg-gray-100', emoji: '💭' };
  };

  // Helper function to categorize highlights
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

  const getCategorizedHighlights = (apartment?: any) => {
    if (!apartment?.highlights || !Array.isArray(apartment.highlights)) {
      return {
        style: ['Stylish', 'Modern'],
        color: ['Neutral', 'Warm'],
        activity: ['Relaxing', 'Reading']
      };
    }

    const categorized = {
      style: [] as string[],
      color: [] as string[],
      activity: [] as string[]
    };

    apartment.highlights.forEach((highlight: string) => {
      const category = categorizeHighlight(highlight);
      if (categorized[category].length < 2) {
        categorized[category].push(highlight);
      }
    });

    // Fill with fallbacks if categories are empty
    if (categorized.style.length === 0) categorized.style = ['Stylish', 'Modern'];
    if (categorized.color.length === 0) categorized.color = ['Neutral', 'Warm'];
    if (categorized.activity.length === 0) categorized.activity = ['Relaxing', 'Comfortable'];

    return categorized;
  };

  const vibeLevel = getVibeLevel(score.overall);
  const vibeAnalysis = apartment?.vibe_analysis;
  const categorizedHighlights = getCategorizedHighlights(apartment);

  if (!showBreakdown) {
    return (
      <div className={`flex items-center space-x-2 ${className}`}>
        <Badge className={`text-xs font-medium ${vibeLevel.color}`}>
          {vibeLevel.emoji} {vibeLevel.level}
        </Badge>
      </div>
    );
  }

  return (
    <div className={`space-y-3 ${className}`}>
      {/* Breakdown */}
      <div className="space-y-2">
        <div className="flex items-center space-x-2">
          <Home className="w-3 h-3 text-blue-500" />
          <span className="text-xs text-gray-600 flex-1">Style</span>
          <div className="flex flex-wrap gap-1">
            {categorizedHighlights.style.map((tag, index) => (
              <Badge key={index} variant="outline" className="text-[10px] px-1.5 py-0.5 bg-blue-50 text-blue-700 border-blue-200">
                {tag}
              </Badge>
            ))}
          </div>
        </div>

        <div className="flex items-center space-x-2">
          <Palette className="w-3 h-3 text-purple-500" />
          <span className="text-xs text-gray-600 flex-1">Color</span>
          <div className="flex flex-wrap gap-1">
            {categorizedHighlights.color.map((color, index) => (
              <Badge key={index} variant="outline" className="text-[10px] px-1.5 py-0.5 bg-purple-50 text-purple-700 border-purple-200">
                {color}
              </Badge>
            ))}
          </div>
        </div>

        <div className="flex items-center space-x-2">
          <Activity className="w-3 h-3 text-green-500" />
          <span className="text-xs text-gray-600 flex-1">Activities</span>
          <div className="flex flex-wrap gap-1">
            {categorizedHighlights.activity.map((activity, index) => (
              <Badge key={index} variant="outline" className="text-[10px] px-1.5 py-0.5 bg-green-50 text-green-700 border-green-200">
                {activity}
              </Badge>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};