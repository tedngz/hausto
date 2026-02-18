import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Home, Heart, Users, Sparkles, ArrowRight, Building2, Search, MessageSquare, LogOut } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { HomeAI } from "@/components/HomeAI";
import { useAuth } from "@/hooks/useAuth";
import AnimatedBackground from "@/components/AnimatedBackground";
import { LanguageSelector } from "@/components/LanguageSelector";
import { useLanguage } from "@/contexts/LanguageContext";

export const LandingPage = () => {
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const { t } = useLanguage();

  const handleSignOut = async () => {
    await signOut();
    window.location.reload();
  };
  const handleGetStarted = () => {
    navigate('/auth');
  };
  const handleDiscover = () => {
    if (user) {
      navigate('/discover');
    } else {
      navigate('/auth', { state: { returnTo: '/discover' } });
    }
  };

  return <div className="min-h-screen relative">
      <AnimatedBackground />
      {/* Header */}
      <header className="container mx-auto px-4 py-4 md:py-6">
        <nav className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <img src="/lovable-uploads/15e7e5a0-a35d-46c1-b0ba-9e273a963e39.png" alt="Hausto Logo" className="h-6 w-6 md:h-8 md:w-8" />
            <span className="text-lg md:text-2xl font-bold text-foreground">Hausto</span>
          </div>
          <div className="flex items-center gap-2 md:gap-4">
            <LanguageSelector />
            {user ? <>
                <span className="hidden sm:block text-xs md:text-sm text-muted-foreground truncate max-w-32 md:max-w-none">
                  {t('landing.welcomeBack')}, {user.user_metadata?.name || user.email?.split('@')[0]}!
                </span>
                <Button onClick={handleDiscover} variant="outline" size="sm" className="border-primary text-primary hover:bg-primary hover:text-primary-foreground text-xs md:text-sm px-3 md:px-4">
                  {t('landing.discover')}
                </Button>
                <Button onClick={handleSignOut} variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground p-2 md:px-3">
                  <LogOut className="h-4 w-4 md:mr-2" />
                  <span className="hidden md:inline">{t('nav.signOut')}</span>
                </Button>
              </> : <Button onClick={() => navigate('/auth')} variant="outline" size="sm" className="border-primary text-primary hover:bg-primary hover:text-primary-foreground text-xs md:text-sm px-3 md:px-4">
                {t('landing.signIn')}
              </Button>}
          </div>
        </nav>
      </header>

      {/* Hero Section */}
      <section className="container mx-auto px-4 py-8 md:py-12 min-h-[calc(100vh-8rem)] flex items-center">
        <div className="text-center max-w-4xl mx-auto w-full">
          <h1 className="text-3xl md:text-4xl lg:text-5xl font-bold text-foreground mb-4 md:mb-6 leading-tight">
            <span className="text-primary">{t('landing.vibeCheck')}</span>
            <span className="block">{t('landing.yourNextHome')}</span>
          </h1>
          
          <p className="text-muted-foreground mb-6 md:mb-8 max-w-2xl mx-auto leading-relaxed text-base md:text-lg">
            {user ? t('landing.descriptionLoggedIn') : t('landing.descriptionLoggedOut')}
          </p>
          
          <div className="mb-4">
            <HomeAI />
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="container mx-auto px-4 py-20">
        <div className="text-center mb-16">
          <h2 className="text-foreground mb-4 font-bold text-3xl">{t('landing.elevateExperience')}</h2>
        </div>

        <div className="grid md:grid-cols-3 gap-8">
          <Card className="bg-card border-border hover:shadow-xl transition-all duration-300 group">
            <CardContent className="p-8 text-center">
              <div className="bg-primary/10 p-4 rounded-full w-fit mx-auto mb-6 group-hover:bg-primary/20 transition-colors">
                <Heart className="h-8 w-8 text-primary" />
              </div>
              <h3 className="text-2xl font-semibold text-foreground mb-4">{t('landing.vibeMatch')}</h3>
              <p className="text-muted-foreground leading-relaxed">{t('landing.vibeMatchDesc')}</p>
            </CardContent>
          </Card>

          <Card className="bg-card border-border hover:shadow-xl transition-all duration-300 group">
            <CardContent className="p-8 text-center">
              <div className="bg-primary/10 p-4 rounded-full w-fit mx-auto mb-6 group-hover:bg-primary/20 transition-colors">
                <Search className="h-8 w-8 text-primary" />
              </div>
              <h3 className="text-2xl font-semibold text-foreground mb-4">{t('landing.smartSearch')}</h3>
              <p className="text-muted-foreground leading-relaxed">{t('landing.smartSearchDesc')}</p>
            </CardContent>
          </Card>

          <Card className="bg-card border-border hover:shadow-xl transition-all duration-300 group">
            <CardContent className="p-8 text-center">
              <div className="bg-primary/10 p-4 rounded-full w-fit mx-auto mb-6 group-hover:bg-primary/20 transition-colors">
                <MessageSquare className="h-8 w-8 text-primary" />
              </div>
              <h3 className="text-2xl font-semibold text-foreground mb-4">{t('landing.unifiedListings')}</h3>
              <p className="text-muted-foreground leading-relaxed">{t('landing.unifiedListingsDesc')}</p>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Stats Section */}
      <section className="bg-secondary/30 py-20">
        <div className="container mx-auto px-4">
          <div className="grid md:grid-cols-3 gap-8 text-center">
            <div>
              <div className="text-4xl font-bold text-primary mb-2">1K+</div>
              <div className="text-muted-foreground">{t('landing.propertiesListed')}</div>
            </div>
            <div>
              <div className="text-4xl font-bold text-primary mb-2">5K+</div>
              <div className="text-muted-foreground">{t('landing.happyMatches')}</div>
            </div>
            <div>
              <div className="text-4xl font-bold text-primary mb-2">98%</div>
              <div className="text-muted-foreground">{t('landing.satisfactionRate')}</div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="container mx-auto px-4 py-20">
        <div className="max-w-4xl mx-auto text-center">
          <div className="bg-card border border-border rounded-2xl p-12">
            <Building2 className="h-16 w-16 text-primary mx-auto mb-6" />
            <h2 className="font-bold text-foreground mb-6 text-3xl">{t('landing.readyToFind')}</h2>
            <p className="text-muted-foreground mb-8 max-w-2xl mx-auto text-base">{t('landing.readyToFindDesc')}</p>
            <div className="flex justify-center">
              <Button onClick={user ? handleDiscover : handleGetStarted} size="lg" className="bg-primary hover:bg-primary/90 text-primary-foreground px-12 py-6 text-lg font-semibold w-full sm:w-auto">
                {user ? t('landing.startBrowsing') : t('landing.startMatchingNow')}
                <ArrowRight className="ml-2 h-6 w-6" />
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-card border-t border-border py-8">
        <div className="container mx-auto px-4">
          <div className="flex items-center justify-center space-x-2">
            <img src="/lovable-uploads/15e7e5a0-a35d-46c1-b0ba-9e273a963e39.png" alt="Hausto Logo" className="h-6 w-6" />
            <span className="text-lg font-semibold text-foreground">Hausto</span>
          </div>
          <p className="text-center text-muted-foreground mt-2">{t('landing.allRightsReserved')}</p>
        </div>
      </footer>
    </div>;
};
