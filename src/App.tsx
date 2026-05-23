
import { HelmetProvider } from 'react-helmet-async';
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/hooks/useAuth";
import Index from "./pages/Index";
import Discover from "./pages/Discover";
import Auth from "./pages/Auth";
import PropertyDetail from "./pages/PropertyDetail";
import NotFound from "./pages/NotFound";
import AdminTools from "./pages/AdminTools";
import AdminComplexes from "./pages/AdminComplexes";
import SubscriptionSuccess from "./pages/SubscriptionSuccess";
import SubscriptionCancel from "./pages/SubscriptionCancel";
import Complexes from "./pages/Complexes";
import ComplexDetail from "./pages/ComplexDetail";

const queryClient = new QueryClient();

const App = () => (
  <HelmetProvider>
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <AuthProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/discover" element={<Discover />} />
            <Route path="/auth" element={<Auth />} />
            <Route path="/property/:id" element={<PropertyDetail />} />
            <Route path="/complexes" element={<Complexes />} />
            <Route path="/complexes/:slug" element={<ComplexDetail />} />
            <Route path="/admin-tools" element={<AdminTools />} />
            <Route path="/subscription-success" element={<SubscriptionSuccess />} />
            <Route path="/subscription-cancel" element={<SubscriptionCancel />} />
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </TooltipProvider>
  </QueryClientProvider>
  </HelmetProvider>
);

export default App;
