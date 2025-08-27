
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

  const getInteriorDesignTags = (designScore: number, apartment: any) => {
    // Get interior design tags based on apartment vibe and AI analysis
    const vibeAnalysis = apartment?.vibe_analysis;
    
    if (vibeAnalysis && vibeAnalysis.interior_design) {
      const score = vibeAnalysis.interior_design;
      if (score >= 4.5) return ['Exceptional Design', 'Premium Quality', 'Architectural Excellence'];
      if (score >= 3.5) return ['Quality Design', 'Stylish Elements', 'Well-appointed'];  
      if (score >= 2.5) return ['Good Design', 'Comfortable', 'Functional'];
      return ['Basic Design', 'Simple Layout', 'Functional Space'];
    }
    
    // Fallback based on vibe
    const designMap: { [key: string]: string[] } = {
      'Modern': ['Contemporary', 'Sleek', 'Clean Lines'],
      'Cozy': ['Warm Design', 'Comfortable', 'Inviting'],
      'Industrial': ['Urban Style', 'Raw Materials', 'Loft Design'],
      'Bohemian': ['Eclectic', 'Artistic', 'Creative'],
      'Luxury': ['Premium Finishes', 'High-end', 'Sophisticated']
    };
    
    const vibeKey = apartment?.vibe || 'Modern';
    return designMap[vibeKey] || ['Quality Design', 'Well-appointed', 'Comfortable'];
  };

  const getColorPaletteTags = (colorScore: number, apartment: any) => {
    // Get color palette tags based on apartment vibe and AI analysis
    const vibeAnalysis = apartment?.vibe_analysis;
    
    if (vibeAnalysis && vibeAnalysis.color_palette) {
      const score = vibeAnalysis.color_palette;
      if (score >= 4.5) return ['Harmonious', 'Inspiring Colors', 'Perfect Balance'];
      if (score >= 3.5) return ['Well-coordinated', 'Pleasant Tones', 'Good Harmony'];
      if (score >= 2.5) return ['Balanced Colors', 'Comfortable Palette', 'Suitable'];
      return ['Simple Palette', 'Basic Colors', 'Functional'];
    }
    
    // Fallback based on vibe  
    const colorMap: { [key: string]: string[] } = {
      'Modern': ['Neutral Tones', 'Cool Palette', 'Clean Colors'],
      'Cozy': ['Warm Earth Tones', 'Rich Colors', 'Inviting Hues'],
      'Industrial': ['Urban Grays', 'Raw Tones', 'Industrial Palette'],
      'Bohemian': ['Vibrant Colors', 'Rich Palette', 'Artistic Tones'],
      'Luxury': ['Elegant Colors', 'Rich Tones', 'Sophisticated Palette']
    };
    
    const vibeKey = apartment?.vibe || 'Modern';
    return colorMap[vibeKey] || ['Harmonious', 'Balanced', 'Pleasant'];
  };

  const getFunctionalityTags = (functionalityScore: number, apartment: any) => {
    // Get functionality tags based on apartment vibe and AI analysis
    const vibeAnalysis = apartment?.vibe_analysis;
    
    if (vibeAnalysis && vibeAnalysis.functionality) {
      const score = vibeAnalysis.functionality;
      if (score >= 4.5) return ['Excellent Layout', 'Highly Functional', 'Optimal Flow'];
      if (score >= 3.5) return ['Well-designed', 'Good Flow', 'Practical'];
      if (score >= 2.5) return ['Functional Layout', 'Usable Space', 'Adequate'];
      return ['Basic Layout', 'Simple Function', 'Standard'];
    }
    
    // Fallback based on vibe
    const functionalityMap: { [key: string]: string[] } = {
      'Modern': ['Efficient Layout', 'Smart Design', 'Functional'],
      'Cozy': ['Comfortable Layout', 'Livable Space', 'Homey'],
      'Industrial': ['Open Layout', 'Flexible Space', 'Adaptable'],
      'Bohemian': ['Creative Space', 'Flexible Layout', 'Artistic Flow'],
      'Luxury': ['Premium Layout', 'Spacious Design', 'Elegant Flow']
    };
    
    const vibeKey = apartment?.vibe || 'Modern';
    return functionalityMap[vibeKey] || ['Well-designed', 'Functional', 'Practical'];
  };

  const sizeClasses = {
    sm: 'text-xs px-2 py-1',
    md: 'text-sm px-3 py-2',
    lg: 'text-base px-4 py-2.5'
  };

  const roundedScore = {
    overall: Math.round(score.overall),
    breakdown: {
      interior_design: Math.round(score.breakdown.interior_design),
      color_palette: Math.round(score.breakdown.color_palette),
      functionality: Math.round(score.breakdown.functionality),
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
                <span className="text-gray-600 font-medium">Interior Design</span>
              </div>
              <div className="flex flex-wrap gap-1">
                {getInteriorDesignTags(roundedScore.breakdown.interior_design, score).map((tag, index) => (
                  <Badge key={index} variant="outline" className="text-xs px-2 py-0.5 bg-blue-50 text-blue-700 border-blue-200">
                    {tag}
                  </Badge>
                ))}
              </div>
            </div>
            
            <div>
              <div className="flex items-center mb-2">
                <span className="text-gray-600 font-medium">Color Palette</span>
              </div>
              <div className="flex flex-wrap gap-1">
                {getColorPaletteTags(roundedScore.breakdown.color_palette, score).map((color, index) => (
                  <Badge key={index} variant="outline" className="text-xs px-2 py-0.5 bg-purple-50 text-purple-700 border-purple-200">
                    {color}
                  </Badge>
                ))}
              </div>
            </div>
            
            <div>
              <div className="flex items-center mb-2">
                <span className="text-gray-600 font-medium">Functionality</span>
              </div>
              <div className="flex flex-wrap gap-1">
                {getFunctionalityTags(roundedScore.breakdown.functionality, score).map((functionality, index) => (
                  <Badge key={index} variant="outline" className="text-xs px-2 py-0.5 bg-green-50 text-green-700 border-green-200">
                    {functionality}
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
