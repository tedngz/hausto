export const getVibeRatingLabel = (percentage: number): string => {
  if (percentage >= 85) return 'perfect';
  if (percentage >= 70) return 'strong';
  if (percentage >= 55) return 'good';
  return 'casual';
};

export const getVibeRatingColor = (percentage: number): string => {
  if (percentage >= 85) return 'text-emerald-600';
  if (percentage >= 70) return 'text-blue-600';
  if (percentage >= 55) return 'text-orange-600';
  return 'text-gray-600';
};