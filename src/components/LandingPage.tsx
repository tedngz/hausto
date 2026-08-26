import { Button } from "@/components/ui/button";
import { HaustoLogo } from "@/components/HaustoLogo";
import { Card, CardContent } from "@/components/ui/card";
import { Home, Heart, Users, Sparkles, ArrowRight, Building2, Search, MessageSquare, LogOut } from "lucide-react";
import { useNavigate, Link } from "react-router-dom";
import { HomeAI } from "@/components/HomeAI";
import { useAuth } from "@/hooks/useAuth";
import AnimatedBackground from "@/components/AnimatedBackground";
import { useComplexes } from "@/hooks/useComplexes";
import { ComplexCard } from "@/components/ComplexCard";
import { LiveListingsPreview } from "@/components/LiveListingsPreview";

export const LandingPage = () => {
  const navigate = useNavigate();
  const {
    user,
    signOut
  } = useAuth();
  const { data: complexes } = useComplexes();
  const notableComplexes = (complexes ?? []).slice(0, 6);
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
      navigate('/hub');
    } else {
      navigate('/auth', {
        state: {
          returnTo: '/hub'
        }
      });
    }
  };
  return <div className="min-h-screen relative">
      <AnimatedBackground />
      {/* Header */}
      <header className="container mx-auto px-4 py-4 md:py-6">
        <nav className="flex items-center justify-between">
          <HaustoLogo />
          <div className="flex items-center gap-2 md:gap-4">
            {user ? <>
                <span className="hidden sm:block text-xs md:text-sm text-muted-foreground truncate max-w-32 md:max-w-none">
                  Welcome back, {user.user_metadata?.name || user.email?.split('@')[0]}!
                </span>
                <Button onClick={handleDiscover} variant="outline" size="sm" className="border-primary text-primary hover:bg-primary hover:text-primary-foreground text-xs md:text-sm px-3 md:px-4">
                  Discover
                </Button>
                <Button onClick={handleSignOut} variant="ghost" size="sm" aria-label="Sign out" className="text-muted-foreground hover:text-foreground p-2 md:px-3">
                  <LogOut className="h-4 w-4 md:mr-2" aria-hidden="true" />
                  <span className="hidden md:inline">Sign Out</span>
                </Button>
              </> : <Button onClick={() => navigate('/auth')} variant="outline" size="sm" className="border-primary text-primary hover:bg-primary hover:text-primary-foreground text-xs md:text-sm px-3 md:px-4">
                Sign In
              </Button>}
          </div>
        </nav>
      </header>

      {/* Hero Section */}
      <main>
      <section className="container mx-auto px-4 py-8 md:py-12">
        <div className="text-center max-w-4xl mx-auto w-full">
          <h1 className="font-serif text-4xl md:text-6xl leading-[1.05] tracking-tight text-foreground mb-4 md:mb-6">
            <span className="text-primary">Vibe check</span>
            <span className="block">your next home</span>
          </h1>
          
          <p className="text-muted-foreground mb-6 md:mb-8 max-w-2xl mx-auto leading-relaxed text-base md:text-lg">
            {user ? "Find your perfect rental with AI-powered matching." : "Discover your dream rental with AI-powered matching and personalized recommendations."}
          </p>
          
          <div className="mb-4">
            {/* The hero chat takes the question and hands it to the hub, which
                answers it - results need the width and the tabs beside them. */}
            <HomeAI handoffToHub />
          </div>

          {/* The verified-listings table is the center of the platform: it gets
              the first content slot, rendered as a live preview of /browse. */}
          <LiveListingsPreview />

          {/* Secondary discovery: complexes keep their cards but not a
              hero-level CTA - the section header link is enough. */}
          {notableComplexes.length > 0 && (
            <div className="mt-12 text-left">
              <div className="mb-6 text-center">
                <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground mb-2">Featured Complexes</p>
                <h2 className="font-serif text-3xl md:text-4xl tracking-tight">Vetted homes renters love</h2>
                <Link
                  to="/hub"
                  className="inline-block mt-2 text-sm text-muted-foreground hover:text-primary underline-offset-4 hover:underline transition-colors"
                >
                  Explore all vetted complexes →
                </Link>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                {notableComplexes.map((c) => <ComplexCard key={c.id} complex={c} />)}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Features Section */}
      <section className="container mx-auto px-4 py-20">
        <div className="text-center mb-16">
          <h2 className="text-foreground mb-4 font-serif text-4xl font-normal">Elevate your home hunting experience</h2>
          
        </div>

        <div className="grid md:grid-cols-3 gap-8">
          <Card className="bg-card border-border hover:shadow-xl transition-all duration-300 group">
            <CardContent className="p-8 text-center">
              <div className="bg-primary/10 p-4 rounded-full w-fit mx-auto mb-6 group-hover:bg-primary/20 transition-colors">
                <Heart className="h-8 w-8 text-primary animate-heartbeat" />
              </div>
              <h3 className="text-2xl text-foreground mb-4 font-serif font-normal">Vibe Match</h3>
              <p className="text-muted-foreground leading-relaxed">Our algorithm learns your preferences and finds properties that truly match your lifestyle and needs.</p>
            </CardContent>
          </Card>

          <Card className="bg-card border-border hover:shadow-xl transition-all duration-300 group">
            <CardContent className="p-8 text-center">
              <div className="bg-primary/10 p-4 rounded-full w-fit mx-auto mb-6 group-hover:bg-primary/20 transition-colors">
                <Search className="h-8 w-8 text-primary animate-gentle-bob" />
              </div>
              <h3 className="text-2xl text-foreground mb-4 font-normal font-serif">Smart Search</h3>
              <p className="text-muted-foreground leading-relaxed">Ask the AI in plain English and get curated properties back, each with detailed insights and a vibe score to find your perfect match.</p>
            </CardContent>
          </Card>

          <Card className="bg-card border-border hover:shadow-xl transition-all duration-300 group">
            <CardContent className="p-8 text-center">
              <div className="bg-primary/10 p-4 rounded-full w-fit mx-auto mb-6 group-hover:bg-primary/20 transition-colors pulse-ring-wrapper">
                <MessageSquare className="h-8 w-8 text-primary" />
              </div>
              <h3 className="text-2xl text-foreground mb-4 font-serif font-normal">Unified Listings</h3>
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
              <div className="text-4xl font-bold text-primary mb-2">10x</div>
              <div className="text-muted-foreground">Matching Speed</div>
            </div>
          </div>
        </div>
      </section>

      {/* Realtor CTA Section */}
      <section className="container mx-auto px-4 py-20">
        <div className="max-w-4xl mx-auto text-center">
          <div className="bg-card border border-border rounded-2xl p-12">
            <Building2 className="h-16 w-16 text-primary mx-auto mb-6" />
            <h2 className="text-foreground mb-6 text-3xl font-normal font-serif">
              List your properties on Hausto
            </h2>
            <p className="text-muted-foreground mb-8 max-w-2xl mx-auto text-base">
              Vetted brokers and owners only. Apply to access our renter network, AI-matched leads, and the realtor dashboard.
            </p>
            <div className="flex justify-center">
              <Button onClick={() => navigate('/realtor/apply')} size="lg" className="bg-primary hover:bg-primary/90 text-primary-foreground px-12 py-6 text-lg font-semibold w-full sm:w-auto">
                Apply as a realtor
                <ArrowRight className="ml-2 h-6 w-6" />
              </Button>
            </div>
          </div>
        </div>
      </section>
      </main>

      {/* Footer */}
      <footer className="bg-card border-t border-border py-8">
        <div className="container mx-auto px-4">
          <HaustoLogo size="sm" className="justify-center" />
          <p className="text-center text-muted-foreground mt-2">© 2025 Hausto. All rights reserved.</p>
          <p className="text-center text-muted-foreground mt-1">
            <a href="mailto:hello@hausto.com" className="hover:text-foreground transition-colors">hello@hausto.com</a>
          </p>
        </div>
      </footer>
    </div>;
};