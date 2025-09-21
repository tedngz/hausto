import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Home, Heart, Users, Sparkles, ArrowRight, Building2, Search, MessageSquare, LogOut } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { LandingChatBox } from "@/components/LandingChatBox";
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
  return <div className="min-h-screen bg-gradient-to-br from-background via-secondary/20 to-background">
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
            <LandingChatBox />
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="container mx-auto px-4 py-20">
        <div className="text-center mb-16">
          <h2 className="text-4xl font-bold text-foreground mb-4">
            {user ? "Your AI-Powered Search Experience" : "Why Choose Hausto?"}
          </h2>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            {user ? "Use our advanced AI to find properties that perfectly match your preferences and lifestyle." : "Experience the future of rental searching with our innovative platform"}
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-8">
          <Card className="bg-card border-border hover:shadow-xl transition-all duration-300 group">
            <CardContent className="p-8 text-center">
              <div className="bg-primary/10 p-4 rounded-full w-fit mx-auto mb-6 group-hover:bg-primary/20 transition-colors">
                <Heart className="h-8 w-8 text-primary" />
              </div>
              <h3 className="text-2xl font-semibold text-foreground mb-4">Vibe Matching</h3>
              <p className="text-muted-foreground leading-relaxed">Our algorithm learns your preferences and finds properties that truly match your lifestyle and needs.</p>
            </CardContent>
          </Card>

          <Card className="bg-card border-border hover:shadow-xl transition-all duration-300 group">
            <CardContent className="p-8 text-center">
              <div className="bg-primary/10 p-4 rounded-full w-fit mx-auto mb-6 group-hover:bg-primary/20 transition-colors">
                <Search className="h-8 w-8 text-primary" />
              </div>
              <h3 className="text-2xl font-semibold text-foreground mb-4">Smart Search</h3>
              <p className="text-muted-foreground leading-relaxed">
                Swipe through curated properties with detailed insights and vibe scores to find your perfect match.
              </p>
            </CardContent>
          </Card>

          <Card className="bg-card border-border hover:shadow-xl transition-all duration-300 group">
            <CardContent className="p-8 text-center">
              <div className="bg-primary/10 p-4 rounded-full w-fit mx-auto mb-6 group-hover:bg-primary/20 transition-colors">
                <MessageSquare className="h-8 w-8 text-primary" />
              </div>
              <h3 className="text-2xl font-semibold text-foreground mb-4">Direct Connect</h3>
              <p className="text-muted-foreground leading-relaxed">
                Connect instantly with property owners and realtors when you find a match you love.
              </p>
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
            <h2 className="text-4xl font-bold text-foreground mb-6">
              Ready to Find Your Dream Home?
            </h2>
            <p className="text-xl text-muted-foreground mb-8 max-w-2xl mx-auto">
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
          <p className="text-center text-muted-foreground mt-2">
            © 2024 Hausto. All rights reserved.
          </p>
        </div>
      </footer>
    </div>;
};