import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Home, Heart, Users, Sparkles, ArrowRight, Building2, Search, MessageSquare, LogOut } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { HomeAI } from "@/components/HomeAI";
import { useAuth } from "@/hooks/useAuth";
export const LandingPage = () => {
  const navigate = useNavigate();
  const {
    user,
    signOut
  } = useAuth();
  const handleSignOut = async () => {
    await signOut();
    // Force reload to reset any app state
    window.location.reload();
  };
  const handleGetStarted = () => {
    navigate('/auth');
  };
  const handleDiscover = () => {
    if (user) {
      navigate('/discover');
    } else {
      navigate('/auth', {
        state: {
          returnTo: '/discover'
        }
      });
    }
  };
  return <div className="min-h-screen bg-background relative overflow-hidden">
      {/* Glowing Orbs Background */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        {/* Primary orb - top right */}
        <div className="absolute -top-40 -right-40 w-[500px] h-[500px] rounded-full bg-primary/20 blur-[120px] animate-pulse" />
        {/* Secondary orb - bottom left */}
        <div className="absolute -bottom-40 -left-40 w-[600px] h-[600px] rounded-full bg-primary/15 blur-[150px]" style={{ animationDelay: '1s' }} />
        {/* Accent orb - center */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[400px] h-[400px] rounded-full bg-secondary/30 blur-[100px]" />
        {/* Small accent orb - top left */}
        <div className="absolute top-20 left-1/4 w-[200px] h-[200px] rounded-full bg-primary/10 blur-[80px] animate-pulse" style={{ animationDelay: '2s' }} />
        {/* Small accent orb - bottom right */}
        <div className="absolute bottom-40 right-1/4 w-[250px] h-[250px] rounded-full bg-accent/20 blur-[90px]" />
      </div>

      {/* Content wrapper with relative positioning */}
      <div className="relative z-10">
      {/* Header */}
      <header className="container mx-auto px-4 py-4 md:py-6">
        <nav className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <img src="/lovable-uploads/15e7e5a0-a35d-46c1-b0ba-9e273a963e39.png" alt="Hausto Logo" className="h-6 w-6 md:h-8 md:w-8" />
            <span className="text-lg md:text-2xl font-bold text-foreground">Hausto</span>
          </div>
          <div className="flex items-center gap-2 md:gap-4">
            {user ? <>
                <span className="hidden sm:block text-xs md:text-sm text-muted-foreground truncate max-w-32 md:max-w-none">
                  Welcome back, {user.user_metadata?.name || user.email?.split('@')[0]}!
                </span>
                <Button onClick={handleDiscover} variant="outline" size="sm" className="border-primary text-primary hover:bg-primary hover:text-primary-foreground text-xs md:text-sm px-3 md:px-4">
                  Discover
                </Button>
                <Button onClick={handleSignOut} variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground p-2 md:px-3">
                  <LogOut className="h-4 w-4 md:mr-2" />
                  <span className="hidden md:inline">Sign Out</span>
                </Button>
              </> : <Button onClick={() => navigate('/auth')} variant="outline" size="sm" className="border-primary text-primary hover:bg-primary hover:text-primary-foreground text-xs md:text-sm px-3 md:px-4">
                Sign In
              </Button>}
          </div>
        </nav>
      </header>

      {/* Hero Section */}
      <section className="container mx-auto px-4 py-8 md:py-12 min-h-[calc(100vh-8rem)] flex items-center">
        <div className="text-center max-w-4xl mx-auto w-full">
          <h1 className="text-3xl md:text-4xl lg:text-5xl font-bold text-foreground mb-4 md:mb-6 leading-tight">
            <span className="text-primary">Vibe Check</span>
            <span className="block">Your Next Home</span>
          </h1>
          
          <p className="text-muted-foreground mb-6 md:mb-8 max-w-2xl mx-auto leading-relaxed text-base md:text-lg">
            {user ? "Find your perfect rental with AI-powered matching." : "Discover your dream rental with AI-powered matching and personalized recommendations."}
          </p>
          
          <div className="mb-4">
            <HomeAI />
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="container mx-auto px-4 py-20">
        <div className="text-center mb-16">
          <h2 className="text-foreground mb-4 font-bold text-3xl">Elevate Your Home Hunting Experience</h2>
          
        </div>

        <div className="grid md:grid-cols-3 gap-8">
          <Card className="bg-card border-border hover:shadow-xl transition-all duration-300 group">
            <CardContent className="p-8 text-center">
              <div className="bg-primary/10 p-4 rounded-full w-fit mx-auto mb-6 group-hover:bg-primary/20 transition-colors">
                <Heart className="h-8 w-8 text-primary" />
              </div>
              <h3 className="text-2xl font-semibold text-foreground mb-4">Vibe Match</h3>
              <p className="text-muted-foreground leading-relaxed">Our algorithm learns your preferences and finds properties that truly match your lifestyle and needs.</p>
            </CardContent>
          </Card>

          <Card className="bg-card border-border hover:shadow-xl transition-all duration-300 group">
            <CardContent className="p-8 text-center">
              <div className="bg-primary/10 p-4 rounded-full w-fit mx-auto mb-6 group-hover:bg-primary/20 transition-colors">
                <Search className="h-8 w-8 text-primary" />
              </div>
              <h3 className="text-2xl font-semibold text-foreground mb-4">Smart Search</h3>
              <p className="text-muted-foreground leading-relaxed">Ask AI and swipe through curated properties with detailed insights and vibe scores to find your perfect match.</p>
            </CardContent>
          </Card>

          <Card className="bg-card border-border hover:shadow-xl transition-all duration-300 group">
            <CardContent className="p-8 text-center">
              <div className="bg-primary/10 p-4 rounded-full w-fit mx-auto mb-6 group-hover:bg-primary/20 transition-colors">
                <MessageSquare className="h-8 w-8 text-primary" />
              </div>
              <h3 className="text-2xl font-semibold text-foreground mb-4">Unified Listings</h3>
              <p className="text-muted-foreground leading-relaxed">Access curated property listings from multiple sources, all in one convenient place.</p>
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
              <div className="text-muted-foreground">Properties Listed</div>
            </div>
            <div>
              <div className="text-4xl font-bold text-primary mb-2">5K+</div>
              <div className="text-muted-foreground">Happy Matches</div>
            </div>
            <div>
              <div className="text-4xl font-bold text-primary mb-2">98%</div>
              <div className="text-muted-foreground">Satisfaction Rate</div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="container mx-auto px-4 py-20">
        <div className="max-w-4xl mx-auto text-center">
          <div className="bg-card border border-border rounded-2xl p-12">
            <Building2 className="h-16 w-16 text-primary mx-auto mb-6" />
            <h2 className="font-bold text-foreground mb-6 text-3xl">
              Ready to Find Your Dream Home?
            </h2>
            <p className="text-muted-foreground mb-8 max-w-2xl mx-auto text-base">
              Join thousands of renters who have found their perfect match. Start your journey today.
            </p>
            <div className="flex justify-center">
            <Button onClick={user ? handleDiscover : handleGetStarted} size="lg" className="bg-primary hover:bg-primary/90 text-primary-foreground px-12 py-6 text-lg font-semibold w-full sm:w-auto">
              {user ? "Start Browsing" : "Start Matching Now"}
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
          <p className="text-center text-muted-foreground mt-2">© 2025 Hausto. All rights reserved.</p>
        </div>
      </footer>
      </div>
    </div>;
};