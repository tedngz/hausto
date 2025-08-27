
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { VibeScore as VibeScoreType } from '@/utils/vibeScoring';
import { Sparkles } from 'lucide-react';

interface VibeScoreProps {
  score: VibeScoreType;
  showBreakdown?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

export const VibeScore = ({ score, showBreakdown = false, size = 'md' }: VibeScoreProps) => {
  const getVibeLevel = (scoreValue: number) => {
    if (scoreValue >= 80) return { level: 'Perfect Vibe', color: 'bg-emerald-500 text-white border-emerald-400', emoji: '🔥' };
    if (scoreValue >= 65) return { level: 'Strong Vibe', color: 'bg-blue-500 text-white border-blue-400', emoji: '✨' };
    if (scoreValue >= 50) return { level: 'Good Vibe', color: 'bg-orange-500 text-white border-orange-400', emoji: '⭐' };
    return { level: 'Casual Vibe', color: 'bg-gray-500 text-white border-gray-400', emoji: '💭' };
  };

  const getStyleTags = (styleScore: number, apartment: any) => {
    // Get style tags based on apartment vibe
    const styleMap: { [key: string]: string[] } = {
      'Modern': ['Contemporary', 'Sleek', 'Minimalist', 'Clean Lines'],
      'Cozy': ['Warm', 'Comfortable', 'Traditional', 'Homey'],
      'Industrial': ['Edgy', 'Urban', 'Loft-style', 'Raw Materials'],
      'Bohemian': ['Eclectic', 'Artistic', 'Colorful', 'Creative'],
      'Scandinavian': ['Light', 'Natural', 'Functional', 'Simple'],
      'Minimalist': ['Clean', 'Uncluttered', 'Simple', 'Functional'],
      'Contemporary': ['Current', 'Stylish', 'Updated', 'Fresh'],
      'Traditional': ['Classic', 'Timeless', 'Elegant', 'Refined'],
      'Rustic': ['Natural', 'Countryside', 'Wood Elements', 'Earthy'],
      'Luxury': ['Upscale', 'Premium', 'High-end', 'Sophisticated']
    };
    
    // Default tags if vibe not found
    const defaultTags = ['Modern', 'Clean', 'Bright', 'Spacious'];
    const vibeKey = apartment?.vibe || 'Modern';
    return styleMap[vibeKey] || defaultTags;
  };

  const getColorPalette = (colorScore: number, apartment: any) => {
    // Get color palette based on apartment vibe
    const colorMap: { [key: string]: string[] } = {
      'Modern': ['Neutral Tones', 'Cool Grays', 'Clean Whites'],
      'Cozy': ['Warm Earth', 'Rich Browns', 'Soft Beiges'],
      'Industrial': ['Raw Metals', 'Cool Grays', 'Urban Blacks'],
      'Bohemian': ['Vibrant Colors', 'Warm Oranges', 'Deep Reds'],
      'Scandinavian': ['Pure Whites', 'Light Woods', 'Soft Blues'],
      'Minimalist': ['Monochrome', 'Pure Whites', 'Simple Grays'],
      'Contemporary': ['Modern Neutrals', 'Accent Colors', 'Fresh Tones'],
      'Traditional': ['Classic Colors', 'Rich Tones', 'Timeless Hues'],
      'Rustic': ['Natural Woods', 'Earth Tones', 'Organic Colors'],
      'Luxury': ['Rich Golds', 'Deep Colors', 'Elegant Tones']
    };
    
    const defaultColors = ['Neutral Tones', 'Warm Whites', 'Soft Grays'];
    const vibeKey = apartment?.vibe || 'Modern';
    return colorMap[vibeKey] || defaultColors;
  };

  const getActivities = (activityScore: number, apartment: any) => {
    // Get activities based on apartment vibe
    const activityMap: { [key: string]: string[] } = {
      'Modern': ['Working', 'Entertaining', 'Reading'],
      'Cozy': ['Relaxing', 'Cooking', 'Family Time'],
      'Industrial': ['Creating', 'Exercising', 'Socializing'],
      'Bohemian': ['Artistic Work', 'Entertaining', 'Creative Time'],
      'Scandinavian': ['Meditating', 'Reading', 'Quiet Time'],
      'Minimalist': ['Focus Work', 'Meditation', 'Simple Living'],
      'Contemporary': ['Socializing', 'Entertainment', 'Modern Living'],
      'Traditional': ['Family Gathering', 'Cooking', 'Formal Dining'],
      'Rustic': ['Outdoor Activities', 'Cooking', 'Relaxing'],
      'Luxury': ['Entertaining', 'Formal Events', 'Leisure']
    };
    
    const defaultActivities = ['Reading', 'Relaxing', 'Working'];
    const vibeKey = apartment?.vibe || 'Modern';
    return activityMap[vibeKey] || defaultActivities;
  };

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
      price: Math.round(score.breakdown.price)
    }
  };

  const vibeLevel = getVibeLevel(roundedScore.overall);

  return (
    <div className="space-y-2">
      <Badge className={`${vibeLevel.color} ${sizeClasses[size]} font-semibold flex items-center gap-1 shadow-lg border`}>
        <Sparkles className={size === 'sm' ? 'w-2.5 h-2.5' : 'w-3 h-3'} />
        {vibeLevel.emoji} {vibeLevel.level}
      </Badge>

      {showBreakdown && (
        <div className="space-y-3 text-xs">
          <div className="space-y-3">
            <div>
              <div className="flex items-center mb-2">
                <span className="text-gray-600 font-medium">Style</span>
              </div>
              <div className="flex flex-wrap gap-1">
                {getStyleTags(roundedScore.breakdown.style, score).map((tag, index) => (
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
                {getColorPalette(roundedScore.breakdown.color, score).map((color, index) => (
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
                {getActivities(roundedScore.breakdown.activities, score).map((activity, index) => (
                  <Badge key={index} variant="outline" className="text-xs px-2 py-0.5 bg-green-50 text-green-700 border-green-200">
                    {activity}
                  </Badge>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
