import { VibeScore } from '@/utils/vibeScoring';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Home, Activity, DollarSign, MapPin } from 'lucide-react';

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
  const categorizeHighlight = (highlight: string): 'style' | 'activity' => {
    const lowerHighlight = highlight.toLowerCase();

    // Activity keywords
    const activityKeywords = ['working', 'entertaining', 'relaxing', 'cooking', 'exercising', 'reading', 'creating', 'dining', 'sleeping', 'studying', 'socializing'];

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
        activity: ['Relaxing', 'Reading']
      };
    }

    const categorized = {
      style: [] as string[],
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
    if (categorized.activity.length === 0) categorized.activity = ['Relaxing', 'Comfortable'];

    return categorized;
  };

  const vibeLevel = getVibeLevel(score.overall);
  const vibeAnalysis = apartment?.vibe_analysis;
  const categorizedHighlights = getCategorizedHighlights(apartment);

  if (!showBreakdown) {
    return (
      <Popover>
        <PopoverTrigger asChild>
          <button className={`flex items-center space-x-2 ${className}`}>
            <Badge className={`text-xs font-medium ${vibeLevel.color} cursor-pointer hover:opacity-80 transition-opacity`}>
              {vibeLevel.emoji} {vibeLevel.level}
            </Badge>
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-72 sm:w-80" align="start">
          <div className="space-y-3">
            <div className="pb-3 border-b">
              <h4 className="font-semibold text-sm mb-1">Overall Match</h4>
              <div className="text-2xl font-bold text-primary">{Math.round(score.overall)}%</div>
            </div>
            
            <div className="space-y-3">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <Home className="w-3 h-3 text-blue-500" />
                    <span className="text-xs text-gray-600">Style</span>
                  </div>
                  <span className="text-xs font-semibold text-gray-700">{Math.round(score.breakdown.style)}%</span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {categorizedHighlights.style.map((tag, index) => (
                    <Badge key={index} variant="outline" className="text-[10px] px-1.5 py-0.5 bg-blue-50 text-blue-700 border-blue-200">
                      {tag}
                    </Badge>
                  ))}
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <Activity className="w-3 h-3 text-green-500" />
                    <span className="text-xs text-gray-600">Features</span>
                  </div>
                  <span className="text-xs font-semibold text-gray-700">{Math.round(score.breakdown.features)}%</span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {categorizedHighlights.activity.map((activity, index) => (
                    <Badge key={index} variant="outline" className="text-[10px] px-1.5 py-0.5 bg-green-50 text-green-700 border-green-200">
                      {activity}
                    </Badge>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <MapPin className="w-3 h-3 text-orange-500" />
                  <span className="text-xs text-gray-600">Location</span>
                </div>
                <span className="text-xs font-semibold text-gray-700">{Math.round(score.breakdown.location)}%</span>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <DollarSign className="w-3 h-3 text-emerald-500" />
                  <span className="text-xs text-gray-600">Price</span>
                </div>
                <span className="text-xs font-semibold text-gray-700">{Math.round(score.breakdown.price)}%</span>
              </div>
            </div>
          </div>
        </PopoverContent>
      </Popover>
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

        <div className="flex items-center space-x-2">
          <MapPin className="w-3 h-3 text-orange-500" />
          <span className="text-xs text-gray-600 flex-1">Location</span>
          <div className="flex flex-wrap gap-1">
            <Badge variant="outline" className="text-[10px] px-1.5 py-0.5 bg-orange-50 text-orange-700 border-orange-200">
              {apartment?.location || 'Not specified'}
            </Badge>
          </div>
        </div>
      </div>
    </div>
  );
};