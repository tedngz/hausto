import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { VibeScore as VibeScoreType } from '@/utils/vibeScoring';
import { getVibeRatingLabel, getVibeRatingColor } from '@/utils/vibeRating';
import { Sparkles, MapPin, Home, Palette, Activity } from 'lucide-react';
import { Apartment } from '@/types';

interface VibeScoreProps {
  score: VibeScoreType;
  apartment?: Apartment;
  showBreakdown?: boolean;
  size?: 'sm' | 'md' | 'lg';
  isAnonymous?: boolean;
  isAISearch?: boolean;
}

export const VibeScore = ({ score, apartment, showBreakdown = false, size = 'md', isAnonymous = false, isAISearch = false }: VibeScoreProps) => {
  const getVibeLevel = (scoreValue: number, isAnonymousUser: boolean, fromAISearch: boolean) => {
    // For anonymous users in AI search, show at least "Good vibe" or higher based on score
    if (isAnonymousUser && fromAISearch) {
      // Boost score to ensure it's at least "Good vibe" (55+)
      const boostedScore = Math.max(scoreValue, 55);
      if (boostedScore >= 85) return { level: 'Perfect vibe', color: 'bg-emerald-500 text-white border-emerald-400', emoji: '🔥' };
      if (boostedScore >= 70) return { level: 'Strong vibe', color: 'bg-blue-500 text-white border-blue-400', emoji: '✨' };
      return { level: 'Good vibe', color: 'bg-orange-500 text-white border-orange-400', emoji: '⭐' };
    }
    
    // For anonymous users not in AI search, always show "Good vibe"
    if (isAnonymousUser) {
      return { level: 'Good vibe', color: 'bg-orange-500 text-white border-orange-400', emoji: '⭐' };
    }
    
    // For logged-in users, use preference-based scoring
    if (scoreValue >= 85) return { level: 'Perfect vibe', color: 'bg-emerald-500 text-white border-emerald-400', emoji: '🔥' };
    if (scoreValue >= 70) return { level: 'Strong vibe', color: 'bg-blue-500 text-white border-blue-400', emoji: '✨' };
    if (scoreValue >= 55) return { level: 'Good vibe', color: 'bg-orange-500 text-white border-orange-400', emoji: '⭐' };
    return { level: 'Casual vibe', color: 'bg-gray-500 text-white border-gray-400', emoji: '💭' };
  };

  const toSafeArray = (value: unknown): string[] => {
    if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string');
    if (typeof value === 'string' && value.trim()) return value.split(',').map(s => s.trim()).filter(Boolean);
    return [];
  };

  const getStyleTags = (): string[] => toSafeArray(apartment?.vibe_analysis?.styles);
  const getColorPalette = (): string[] => toSafeArray(apartment?.vibe_analysis?.colors);
  const getActivities = (): string[] => toSafeArray(apartment?.vibe_analysis?.activities);

  const sizeClasses = {
    sm: 'text-xs px-2 py-1',
    md: 'text-sm px-3 py-2',
    lg: 'text-base px-4 py-2.5'
  };

  const roundedScore = {
    overall: Math.round(score.overall),
    breakdown: {
      style: Math.round(score.breakdown.style),
      color: Math.round(score.breakdown.color),
      activities: Math.round(score.breakdown.activities),
      price: Math.round(score.breakdown.price),
      location: Math.round(score.breakdown.location)
    }
  };

  const vibeLevel = getVibeLevel(roundedScore.overall, isAnonymous, isAISearch);

  return (
    <div className="space-y-2">
      <Popover>
        <PopoverTrigger asChild>
          <button>
            <Badge className={`${vibeLevel.color} ${sizeClasses[size]} font-semibold flex items-center gap-1 shadow-lg border cursor-pointer hover:opacity-80 transition-opacity`}>
              {vibeLevel.emoji} {vibeLevel.level}
            </Badge>
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-72 sm:w-80" align="start">
          <div className="space-y-3">
            <div className="pb-3 border-b">
              <h4 className="font-semibold text-sm mb-1">Overall Match</h4>
              <div className="text-2xl font-bold text-primary">{roundedScore.overall}%</div>
            </div>
            
            <div className="space-y-3">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <Home className="w-4 h-4 text-blue-500" />
                    <span className="text-xs text-gray-600">Style</span>
                  </div>
                  <span className="text-xs font-semibold text-gray-700">{roundedScore.breakdown.style}%</span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {getStyleTags().slice(0, 3).map((tag, index) => (
                    <Badge key={index} variant="outline" className="text-[10px] px-1.5 py-0.5 bg-blue-50 text-blue-700 border-blue-200">
                      {tag}
                    </Badge>
                  ))}
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <Palette className="w-4 h-4 text-purple-500" />
                    <span className="text-xs text-gray-600">Color</span>
                  </div>
                  <span className="text-xs font-semibold text-gray-700">{roundedScore.breakdown.color}%</span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {getColorPalette().slice(0, 3).map((color, index) => (
                    <Badge key={index} variant="outline" className="text-[10px] px-1.5 py-0.5 bg-purple-50 text-purple-700 border-purple-200">
                      {color}
                    </Badge>
                  ))}
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <Activity className="w-4 h-4 text-green-500" />
                    <span className="text-xs text-gray-600">Activities</span>
                  </div>
                  <span className="text-xs font-semibold text-gray-700">{roundedScore.breakdown.activities}%</span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {getActivities().slice(0, 3).map((activity, index) => (
                    <Badge key={index} variant="outline" className="text-[10px] px-1.5 py-0.5 bg-green-50 text-green-700 border-green-200">
                      {activity}
                    </Badge>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <MapPin className="w-4 h-4 text-orange-500" />
                  <span className="text-xs text-gray-600">Location</span>
                </div>
                <span className="text-xs font-semibold text-gray-700">{roundedScore.breakdown.location}%</span>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-emerald-500" />
                  <span className="text-xs text-gray-600">Price</span>
                </div>
                <span className="text-xs font-semibold text-gray-700">{roundedScore.breakdown.price}%</span>
              </div>
            </div>
          </div>
        </PopoverContent>
      </Popover>

      {showBreakdown && (
        <div className="space-y-3 text-xs">
          <div className="space-y-3">
            <div>
              <div className="flex items-center mb-2">
                <span className="text-gray-600 font-medium">Style</span>
              </div>
                  <div className="flex flex-wrap gap-1">
                    {getStyleTags().map((tag, index) => (
                      <Badge key={index} variant="outline" className="text-xs px-2 py-0.5 bg-blue-50 text-blue-700 border-blue-200">
                        {tag}
                      </Badge>
                    ))}
                  </div>
            </div>
            
            <div>
              <div className="flex items-center mb-2">
                <span className="text-gray-600 font-medium">Color</span>
              </div>
                  <div className="flex flex-wrap gap-1">
                    {getColorPalette().map((color, index) => (
                      <Badge key={index} variant="outline" className="text-xs px-2 py-0.5 bg-purple-50 text-purple-700 border-purple-200">
                        {color}
                      </Badge>
                    ))}
                  </div>
            </div>
            
            <div>
              <div className="flex items-center mb-2">
                <span className="text-gray-600 font-medium">Lifestyle Activities</span>
              </div>
                  <div className="flex flex-wrap gap-1">
                    {getActivities().map((activity, index) => (
                      <Badge key={index} variant="outline" className="text-xs px-2 py-0.5 bg-green-50 text-green-700 border-green-200">
                        {activity}
                      </Badge>
                    ))}
                  </div>
            </div>
            
            <div>
              <div className="flex items-center mb-2">
                <MapPin className="w-4 h-4 text-orange-600 inline mr-1" />
                <span className="text-gray-600 font-medium">Location Match</span>
              </div>
              <div className="flex items-center gap-2">
                <Progress value={roundedScore.breakdown.location} className="h-2 flex-1" />
                <span className="text-xs font-medium text-gray-700">{roundedScore.breakdown.location}%</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
