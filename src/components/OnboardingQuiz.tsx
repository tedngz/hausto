
import { useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { UserPreferences } from '@/types';
import { BudgetRangeSelector } from '@/components/BudgetRangeSelector';
import { CityDistrictSelector } from '@/components/CityDistrictSelector';
import { useUsageTracking } from '@/hooks/useUsageTracking';
import { Sparkles, Home, MapPin, Calendar, DollarSign, Ruler, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { useUserPreferences } from '@/hooks/useUserPreferences';
import { MUST_HAVE_OPTIONS } from '@/lib/propertyFeatures';

interface OnboardingQuizProps {
  onComplete: (preferences: UserPreferences) => void;
  onSkip?: () => void;
}

export const OnboardingQuiz = ({ onComplete, onSkip }: OnboardingQuizProps) => {
  // All hooks must be called before any conditional logic or early returns
  const { canPerformAction, updateUsage, getRemainingActions, subscriptionStatus } = useUsageTracking();
  const { user } = useAuth();
  const { savePreferences } = useUserPreferences();
  const [currentStep, setCurrentStep] = useState(0);
  const [isAnimating, setIsAnimating] = useState(false);
  const [showContent, setShowContent] = useState(true);
  const [preferences, setPreferences] = useState<Partial<UserPreferences>>({
    styles: [],
    activities: [],
    mustHaves: [],
    priceRange: [8000000, 15000000],
    size: '',
    location: [],
    moveInDate: ''
  });


  // Must match the exit transition duration on the step-content wrappers below.
  const STEP_EXIT_MS = 200;

  useEffect(() => {
    // Double rAF guarantees the browser paints the hidden (opacity-0) state of
    // the new step before we flip to visible — otherwise React batches the
    // class change into the same paint and the fade-in randomly doesn't run.
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        setShowContent(true);
        setIsAnimating(false);
      });
    });
    // Scroll to top when step changes (window + any scrollable ancestor)
    window.scrollTo({ top: 0, behavior: 'smooth' });
    document.querySelectorAll('.overflow-y-auto').forEach((el) => {
      (el as HTMLElement).scrollTo({ top: 0, behavior: 'smooth' });
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [currentStep]);


  const goToStep = (step: number) => {
    if (isAnimating) return; // ignore clicks while a transition is in flight
    setIsAnimating(true);
    setShowContent(false);
    setTimeout(() => {
      setCurrentStep(step);
    }, STEP_EXIT_MS);
  };

  const handleNext = () => goToStep(currentStep + 1);

  const handleBack = () => goToStep(currentStep - 1);

  const handleMultiSelect = (optionId: string, key: keyof UserPreferences) => {
    const currentValues = (preferences[key] as string[]) || [];
    const isSelected = currentValues.includes(optionId);

    if (isSelected) {
      setPreferences(prev => ({
        ...prev,
        [key]: currentValues.filter(id => id !== optionId)
      }));
    } else {
      setPreferences(prev => ({
        ...prev,
        [key]: [...currentValues, optionId]
      }));
    }
  };

  const handleSingleSelect = (optionId: string, key: keyof UserPreferences) => {
    setPreferences(prev => ({
      ...prev,
      [key]: optionId
    }));
  };

  const handleBudgetChange = (value: [number, number]) => {
    setPreferences(prev => ({
      ...prev,
      priceRange: value
    }));
  };

  const handleLocationChange = (value: string[]) => {
    setPreferences(prev => ({
      ...prev,
      location: value
    }));
  };

  const handleSubmit = async () => {
    const finalPreferences: UserPreferences = {
      styles: preferences.styles as string[],
      activities: preferences.activities as string[],
      mustHaves: (preferences.mustHaves as string[]) || [],
      priceRange: preferences.priceRange as [number, number],
      size: preferences.size as string,
      location: preferences.location as string[],
      moveInDate: preferences.moveInDate as string
    };

    // Persist through the shared hook so the DB row, the device cache and every
    // mounted consumer (Discover, the table's vibe scores) land together.
    if (user) {
      try {
        await savePreferences(finalPreferences);
      } catch (err) {
        console.error('Failed to save preferences:', err);
      }
    }

    // Track quiz completion
    await updateUsage('quiz');
    onComplete(finalPreferences);
  };

  const steps = [
    {
      title: "Hey there! 👋 Let's find your dream home together!",
      subtitle: "I'm here to help you discover spaces that truly feel like *you*. What style makes your heart skip a beat?",
      type: "multi-select" as const,
      key: "styles" as keyof UserPreferences,
      icon: Sparkles,
      options: [
        { 
          id: 'Modern', 
          label: 'Modern', 
          description: 'Clean lines, sleek vibes',
          image: '/lovable-uploads/56eaf19c-2080-4831-8b77-4d00dc7570c0.png'
        },
        { 
          id: 'Cozy', 
          label: 'Cozy', 
          description: 'Warm hugs everywhere',
          image: '/lovable-uploads/dd1fb7df-2deb-4b9a-8627-316bf4fa3a0a.png'
        },
        { 
          id: 'Industrial', 
          label: 'Industrial', 
          description: 'Raw, urban edge',
          image: '/lovable-uploads/bc78b489-f8ff-4c97-85ef-65446bfb59dd.png'
        },
        {
          id: 'Scandinavian',
          label: 'Scandinavian',
          description: 'Light, airy perfection',
          image: '/lovable-uploads/f1a210c9-bdfa-4180-a680-983793a494d8.png'
        },
        {
          id: 'Minimalist',
          label: 'Minimalist',
          description: 'Less is more magic',
          image: '/lovable-uploads/de3ec921-af90-424b-9f8e-01c4368a5ae4.png'
        },
        {
          id: 'Luxury',
          label: 'Luxury',
          description: 'Premium elegance',
          image: '/lovable-uploads/luxury-style.png'
        }
      ]
    },
    {
      title: "What can't you live without? 🎯",
      subtitle: "Pick your deal-breakers — we'll make sure your top matches have them (you can still explore other options anytime).",
      type: "multi-select" as const,
      key: "mustHaves" as keyof UserPreferences,
      icon: CheckCircle2,
      options: MUST_HAVE_OPTIONS.map(o => ({
        id: o.id,
        label: o.label,
        emoji: o.emoji,
        description: o.description,
      })),
    },
    {
      title: "Perfect! 🏠 How do you spend time at home?",
      subtitle: "This helps us find spaces that fit your day-to-day. Pick whatever sounds like you.",
      type: "multi-select" as const,
      key: "activities" as keyof UserPreferences,
      icon: Home,
      options: [
        { id: 'Working', label: 'Working', emoji: '💻', description: 'Home office productivity' },
        { id: 'Reading', label: 'Reading', emoji: '📚', description: 'Quiet reading nooks' },
        { id: 'Relaxing', label: 'Relaxing', emoji: '🛋️', description: 'Pure relaxation mode' },
        { id: 'Entertaining', label: 'Entertaining', emoji: '🎉', description: 'Friends & gatherings' },
        { id: 'Cooking', label: 'Cooking', emoji: '👨‍🍳', description: 'Culinary adventures' },
        { id: 'Exercising', label: 'Exercising', emoji: '🏋️', description: 'Fitness at home' }
      ]
    },
    {
      title: "Let's talk numbers! What's your comfort zone?",
      subtitle: "No judgment here - everyone has a budget! Let's find something amazing within yours. What range feels right?",
      type: "budget" as const,
      key: "priceRange" as keyof UserPreferences,
      icon: DollarSign
    },
    {
      title: "Space to breathe! How much room do you need?",
      subtitle: "Some love cozy spaces, others need room to spread out. What feels like 'just right' for your lifestyle?",
      type: "single-select" as const,
      key: "size" as keyof UserPreferences,
      icon: Ruler,
      options: [
        { id: 'studio', label: 'Cozy Studio', emoji: '🏠', description: 'Efficient & intimate' },
        { id: '1br', label: '1 Bedroom', emoji: '🛏️', description: 'Perfect for one or two' },
        { id: '2br', label: '2 Bedroom', emoji: '🏡', description: 'Room to grow' },
        { id: '3br+', label: '3+ Bedrooms', emoji: '🏘️', description: 'Space for everyone' }
      ]
    },
    {
      title: "Where do you want to call home?",
      subtitle: "Vietnam has so many amazing neighborhoods! Which areas are calling your name? Pick as many as you'd like to explore.",
      type: "location" as const,
      key: "location" as keyof UserPreferences,
      icon: MapPin
    },
    {
      title: "Almost done! When are you ready to make the move?",
      subtitle: "This helps me prioritize the perfect matches for you. Don't stress - we can always adjust as things change!",
      type: "single-select" as const,
      key: "moveInDate" as keyof UserPreferences,
      icon: Calendar,
      options: [
        { id: 'asap', label: 'Right Now!', emoji: '⚡', description: "I'm ready to go!" },
        { id: '1month', label: 'Within a Month', emoji: '📅', description: 'Soon but not rushing' },
        { id: '3months', label: 'Next 3 Months', emoji: '🗓️', description: 'Planning ahead' },
        { id: '6months', label: '6+ Months', emoji: '⏰', description: 'Just exploring for now' }
      ]
    }
  ];

  const totalSteps = steps.length;
  const currentStepData = steps[currentStep];

  return (
    <div className="min-h-screen bg-background flex items-center justify-center py-4 px-4">
      <div className="w-full max-w-4xl">
        <Card className="bg-card shadow-xl rounded-3xl border-0 overflow-hidden">
          {/* Clean Header */}
          <div className="p-8 text-center">
            <div className={`transition-all ${showContent ? 'duration-300 opacity-100 translate-y-0' : 'duration-200 opacity-0 translate-y-4'}`}>
              <div className="w-16 h-16 bg-gradient-to-r from-orange-500 to-red-500 rounded-full flex items-center justify-center mx-auto mb-6 shadow-lg">
                {currentStepData.icon && (
                  <currentStepData.icon className="w-8 h-8 text-white" />
                )}
              </div>
              <h2 className="text-2xl font-bold mb-3 text-gray-800">{currentStepData.title}</h2>
              <p className="text-gray-600 max-w-2xl mx-auto leading-relaxed">{currentStepData.subtitle}</p>
            </div>
            
            {/* Elegant progress indicator */}
            <div className="mt-8 flex justify-center space-x-2">
              {Array.from({ length: totalSteps }).map((_, index) => (
                <div 
                  key={index}
                  className={`w-2 h-2 rounded-full transition-all duration-500 ${
                    index <= currentStep ? 'bg-orange-500 scale-110' : 'bg-gray-300'
                  }`}
                />
              ))}
            </div>
          </div>

          {/* Clean Content area */}
          <div className="p-8">
            <div className={`min-h-[400px] flex items-center justify-center transition-all ${showContent ? 'duration-300 opacity-100 translate-y-0' : 'duration-200 opacity-0 translate-y-8'}`}>
              {currentStepData.type === "multi-select" && (
                <div className="w-full">
                  {currentStep === 0 ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
                      {currentStepData.options?.map((option, index) => {
                        const isSelected = ((preferences[currentStepData.key] as string[]) || []).includes(option.id);
                        return (
                          <div
                            key={option.id}
                            onClick={() => handleMultiSelect(option.id, currentStepData.key)}
                            className={`relative group cursor-pointer rounded-2xl overflow-hidden transition-all duration-300 hover:scale-105 hover:shadow-xl ${
                              isSelected ? 'ring-4 ring-orange-500 ring-offset-2' : ''
                            }`}
                          >
                            <div className="aspect-[3/2] sm:aspect-[4/3] relative">
                              <img 
                                src={option.image} 
                                alt={option.label}
                                className="w-full h-full object-cover object-center"
                              />
                              <div className={`absolute inset-0 transition-all duration-300 ${
                                isSelected ? 'bg-orange-500/20' : 'bg-black/20 group-hover:bg-black/10'
                              }`}></div>
                              {isSelected && (
                                <div className="absolute top-2 right-2 sm:top-3 sm:right-3">
                                  <div className="w-6 h-6 sm:w-8 sm:h-8 bg-orange-500 rounded-full flex items-center justify-center shadow-lg">
                                    <span className="text-white text-xs sm:text-sm font-bold">✓</span>
                                  </div>
                                </div>
                              )}
                            </div>
                            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-3 sm:p-4">
                              <h3 className="text-white font-bold text-base sm:text-lg">{option.label}</h3>
                              <p className="text-white/90 text-xs sm:text-sm">{option.description}</p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 max-w-4xl mx-auto">
                      {currentStepData.options?.map((option, index) => {
                        const isSelected = ((preferences[currentStepData.key] as string[]) || []).includes(option.id);
                        return (
                          <div
                            key={option.id}
                            onClick={() => handleMultiSelect(option.id, currentStepData.key)}
                            className={`group cursor-pointer rounded-2xl p-4 sm:p-6 text-center transition-all duration-300 hover:scale-105 border-2 ${
                              isSelected 
                                ? 'bg-orange-50 border-orange-500 shadow-lg' 
                                : 'bg-white border-gray-200 hover:border-orange-300 hover:shadow-md'
                            }`}
                            style={{ animationDelay: `${index * 100}ms` }}
                          >
                            <div className="text-4xl mb-4 transition-transform duration-300 group-hover:scale-110">
                              {option.emoji}
                            </div>
                            <h3 className={`font-bold text-lg mb-2 transition-colors ${
                              isSelected ? 'text-orange-600' : 'text-gray-800'
                            }`}>
                              {option.label}
                            </h3>
                            <p className={`text-sm transition-colors ${
                              isSelected ? 'text-orange-500' : 'text-gray-600'
                            }`}>
                              {option.description}
                            </p>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {currentStepData.type === "single-select" && (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 max-w-4xl mx-auto">
                  {currentStepData.options?.map((option, index) => {
                    const isSelected = preferences[currentStepData.key] === option.id;
                    return (
                      <div
                        key={option.id}
                        onClick={() => handleSingleSelect(option.id, currentStepData.key)}
                        className={`group cursor-pointer rounded-2xl p-4 sm:p-6 text-center transition-all duration-300 hover:scale-105 border-2 ${
                          isSelected 
                            ? 'bg-orange-50 border-orange-500 shadow-lg' 
                            : 'bg-white border-gray-200 hover:border-orange-300 hover:shadow-md'
                        }`}
                        style={{ animationDelay: `${index * 100}ms` }}
                      >
                        <div className="text-4xl mb-4 transition-transform duration-300 group-hover:scale-110">
                          {option.emoji}
                        </div>
                        <h3 className={`font-bold text-lg mb-2 transition-colors ${
                          isSelected ? 'text-orange-600' : 'text-gray-800'
                        }`}>
                          {option.label}
                        </h3>
                        <p className={`text-sm transition-colors ${
                          isSelected ? 'text-orange-500' : 'text-gray-600'
                        }`}>
                          {option.description}
                        </p>
                        {isSelected && (
                          <div className="absolute top-3 right-3">
                            <div className="w-6 h-6 bg-orange-500 rounded-full flex items-center justify-center shadow-lg">
                              <span className="text-white text-xs font-bold">✓</span>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {currentStepData.type === "budget" && (
                <div className="w-full max-w-lg mx-auto space-y-8">
                  <BudgetRangeSelector
                    value={preferences.priceRange as [number, number]}
                    onChange={handleBudgetChange}
                  />
                </div>
              )}

              {currentStepData.type === "location" && (
                <div className="w-full max-w-4xl mx-auto space-y-8">
                  <CityDistrictSelector
                    value={preferences.location as string[]}
                    onChange={handleLocationChange}
                  />
                </div>
              )}
            </div>

            {/* Clean Navigation */}
            <div className="flex justify-between items-center mt-12 pt-8">
              <Button 
                variant="outline" 
                onClick={handleBack}
                disabled={currentStep === 0}
                className="px-6 py-3 rounded-full border-2 hover:bg-gray-50 transition-all duration-200 disabled:opacity-50"
              >
                ← Back
              </Button>

              {currentStep < totalSteps - 1 ? (
                <Button 
                  onClick={handleNext} 
                  className="px-8 py-3 rounded-full bg-gradient-to-r from-orange-500 to-red-500 hover:shadow-lg transition-all duration-200 text-white font-medium"
                >
                  Continue
                </Button>
              ) : (
                <Button 
                  onClick={handleSubmit}
                  className="px-8 py-3 rounded-full bg-gradient-to-r from-orange-500 to-red-500 hover:shadow-lg transition-all duration-200 text-white font-medium"
                >
                  Get Started
                </Button>
              )}
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
};
