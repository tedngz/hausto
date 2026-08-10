import { useEffect, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { Loader2, CheckCircle2, Clock, XCircle, ArrowLeft } from 'lucide-react';
import AnimatedBackground from '@/components/AnimatedBackground';

const schema = z.object({
  full_name: z.string().trim().min(2, 'Enter your full name').max(120),
  company: z.string().trim().max(120).optional().or(z.literal('')),
  phone: z.string().trim().min(8, 'Enter a valid phone').max(20),
  email: z.string().trim().email('Invalid email').max(255),
  role_type: z.enum(['agent', 'owner', 'agency']),
  city: z.string().trim().min(2, 'Select a city').max(80),
  districts: z.string().trim().max(400),
  years_experience: z.coerce.number().int().min(0).max(80),
  properties_count: z.coerce.number().int().min(0).max(10000),
  website_or_listing_url: z.string().trim().max(400).optional().or(z.literal('')),
  bio: z.string().trim().min(30, 'Please tell us a bit more (min 30 chars)').max(2000),
});

type Application = {
  id: string;
  status: 'pending' | 'approved' | 'rejected';
  admin_notes: string | null;
  created_at: string;
  reviewed_at: string | null;
};

const RealtorApply = () => {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [existing, setExisting] = useState<Application | null>(null);

  const [form, setForm] = useState({
    full_name: '',
    company: '',
    phone: '',
    email: '',
    role_type: 'agent' as 'agent' | 'owner' | 'agency',
    city: 'Ho Chi Minh City',
    districts: '',
    years_experience: '' as string | number,
    properties_count: '' as string | number,
    website_or_listing_url: '',
    bio: '',
  });

  useEffect(() => {
    if (!authLoading && !user) {
      navigate('/auth', { state: { returnTo: '/realtor/apply' } });
    }
  }, [user, authLoading, navigate]);

  useEffect(() => {
    const load = async () => {
      if (!user?.id) return;
      setLoading(true);
      const { data } = await supabase
        .from('realtor_applications')
        .select('id, status, admin_notes, created_at, reviewed_at')
        .eq('user_id', user.id)
        .maybeSingle();
      setExisting((data as Application) ?? null);
      if (!data) {
        setForm((f) => ({
          ...f,
          email: user.email ?? '',
          full_name: (user.user_metadata?.name as string) ?? '',
          phone: (user.user_metadata?.phone as string) ?? '',
        }));
      }
      setLoading(false);
    };
    load();
  }, [user?.id]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user?.id) return;
    const parsed = schema.safeParse(form);
    if (!parsed.success) {
      toast.error(parsed.error.errors[0]?.message ?? 'Please check the form');
      return;
    }
    setSubmitting(true);
    const districts = parsed.data.districts
      .split(',')
      .map((d) => d.trim())
      .filter(Boolean);

    const { error } = await supabase.from('realtor_applications').insert({
      user_id: user.id,
      full_name: parsed.data.full_name,
      company: parsed.data.company || null,
      phone: parsed.data.phone,
      email: parsed.data.email,
      role_type: parsed.data.role_type,
      city: parsed.data.city,
      districts,
      years_experience: parsed.data.years_experience,
      properties_count: parsed.data.properties_count,
      website_or_listing_url: parsed.data.website_or_listing_url || null,
      bio: parsed.data.bio,
    });

    setSubmitting(false);
    if (error) {
      toast.error('Could not submit application', { description: error.message });
      return;
    }
    toast.success('Application submitted', {
      description: 'Our team will review it and get back to you shortly.',
    });
    const { data } = await supabase
      .from('realtor_applications')
      .select('id, status, admin_notes, created_at, reviewed_at')
      .eq('user_id', user.id)
      .maybeSingle();
    setExisting((data as Application) ?? null);
  };

  if (authLoading || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen relative">
      <AnimatedBackground />
      <Helmet>
        <title>Apply as a Realtor — Hausto</title>
        <meta
          name="description"
          content="Apply to list your properties on Hausto. Vetted brokers and owners only."
        />
      </Helmet>

      <div className="container mx-auto px-4 py-8 max-w-3xl">
        <Button
          variant="ghost"
          size="sm"
          className="mb-4"
          onClick={() => navigate('/')}
        >
          <ArrowLeft className="mr-2 h-4 w-4" /> Back to home
        </Button>

        <h1 className="text-2xl md:text-3xl font-bold mb-6">Apply to List Your Properties</h1>


        {existing ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                {existing.status === 'approved' && (
                  <>
                    <CheckCircle2 className="h-5 w-5 text-green-600" /> Approved
                  </>
                )}
                {existing.status === 'pending' && (
                  <>
                    <Clock className="h-5 w-5 text-amber-600" /> Application under review
                  </>
                )}
                {existing.status === 'rejected' && (
                  <>
                    <XCircle className="h-5 w-5 text-destructive" /> Not approved
                  </>
                )}
              </CardTitle>
              <CardDescription>
                Submitted on {new Date(existing.created_at).toLocaleDateString()}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {existing.status === 'pending' && (
                <p className="text-sm text-muted-foreground">
                  Thanks for applying. Our team reviews new realtor applications within 1–2 business
                  days. You'll get access to the realtor dashboard once approved.
                </p>
              )}
              {existing.status === 'approved' && (
                <>
                  <p className="text-sm text-muted-foreground">
                    You now have access to the realtor dashboard. Switch to realtor mode to start
                    listing your properties.
                  </p>
                  <Button onClick={() => navigate('/discover')}>Go to dashboard</Button>
                </>
              )}
              {existing.status === 'rejected' && (
                <>
                  <p className="text-sm text-muted-foreground">
                    Unfortunately we cannot approve your application at this time.
                  </p>
                  {existing.admin_notes && (
                    <div className="rounded-md border bg-muted/40 p-3 text-sm">
                      <p className="font-medium mb-1">Reviewer notes</p>
                      <p className="whitespace-pre-wrap text-muted-foreground">
                        {existing.admin_notes}
                      </p>
                    </div>
                  )}
                  <p className="text-sm text-muted-foreground">
                    Reach out to hello@hausto.com if you believe this was a mistake.
                  </p>
                </>
              )}
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>List your properties on Hausto</CardTitle>
              <CardDescription>
                Tell us about your business. Vetted brokers and owners only — applications are
                reviewed by our team before access is granted.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="full_name">Full name *</Label>
                    <Input
                      id="full_name"
                      value={form.full_name}
                      onChange={(e) => setForm({ ...form, full_name: e.target.value })}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="company">Company / agency</Label>
                    <Input
                      id="company"
                      value={form.company}
                      onChange={(e) => setForm({ ...form, company: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="email">Email *</Label>
                    <Input
                      id="email"
                      type="email"
                      value={form.email}
                      onChange={(e) => setForm({ ...form, email: e.target.value })}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="phone">Phone *</Label>
                    <Input
                      id="phone"
                      value={form.phone}
                      onChange={(e) => setForm({ ...form, phone: e.target.value })}
                      placeholder="+84..."
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="role_type">I am a *</Label>
                    <select
                      id="role_type"
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      value={form.role_type}
                      onChange={(e) =>
                        setForm({ ...form, role_type: e.target.value as typeof form.role_type })
                      }
                    >
                      <option value="agent">Independent agent</option>
                      <option value="agency">Agency representative</option>
                      <option value="owner">Property owner</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="city">City *</Label>
                    <select
                      id="city"
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      value={form.city}
                      onChange={(e) => setForm({ ...form, city: e.target.value })}
                    >
                      <option>Ho Chi Minh City</option>
                      <option>Hanoi</option>
                      <option>Da Nang</option>
                    </select>
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <Label htmlFor="districts">Districts you cover (comma separated)</Label>
                    <Input
                      id="districts"
                      value={form.districts}
                      onChange={(e) => setForm({ ...form, districts: e.target.value })}
                      placeholder="District 2, Thao Dien, Thu Thiem"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="years_experience">Years of experience *</Label>
                    <Input
                      id="years_experience"
                      type="number"
                      min={0}
                      value={form.years_experience}
                      onChange={(e) =>
                        setForm({ ...form, years_experience: e.target.value })
                      }
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="properties_count">Active listings you manage *</Label>
                    <Input
                      id="properties_count"
                      type="number"
                      min={0}
                      value={form.properties_count}
                      onChange={(e) =>
                        setForm({ ...form, properties_count: e.target.value })
                      }
                      required
                    />
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <Label htmlFor="website_or_listing_url">Website or listing URL</Label>
                    <Input
                      id="website_or_listing_url"
                      value={form.website_or_listing_url}
                      onChange={(e) =>
                        setForm({ ...form, website_or_listing_url: e.target.value })
                      }
                      placeholder="https://..."
                    />
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <Label htmlFor="bio">About you / your inventory *</Label>
                    <Textarea
                      id="bio"
                      rows={5}
                      value={form.bio}
                      onChange={(e) => setForm({ ...form, bio: e.target.value })}
                      placeholder="Tell us about the buildings you cover, your typical clients, and why you'd like to join Hausto."
                      required
                    />
                  </div>
                </div>
                <Button type="submit" disabled={submitting} className="w-full md:w-auto">
                  {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Submit application
                </Button>
              </form>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
};

export default RealtorApply;
