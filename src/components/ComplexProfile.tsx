import { useState, useEffect } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { ArrowLeft, Building2, CalendarCheck, Home, MapPin, PawPrint, ThumbsDown, ThumbsUp } from 'lucide-react';
import { useComplexListings, CITY_LABEL, type Complex } from '@/hooks/useComplexes';
import { useAuth } from '@/hooks/useAuth';
import { useMatches } from '@/hooks/useMatches';
import type { Apartment } from '@/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ConciergeCaptureModal } from '@/components/ConciergeCaptureModal';
import { EditorialPropertyCard } from '@/components/EditorialPropertyCard';
import { ComplexMapCanvas } from '@/components/ComplexMapCanvas';
import { useComplexes } from '@/hooks/useComplexes';
import { ComplexPriceBands } from '@/components/ComplexPriceBands';
import { REPLY_WITHIN_HOURS, SEARCH_NAME, replyWithinText } from '../../supabase/functions/_shared/viewing/place.ts';

const ROOM_LABEL: Record<string, string> = {
  studio: 'Studio', '1br': '1 Bedroom', '2br': '2 Bedroom', '3br': '3 Bedroom', '4br': '4 Bedroom',
};

/**
 * The whole vetted-building profile: hero, insider view, price bands, live
 * listings, map, concierge CTA.
 *
 * Lifted out of the /complexes/:slug page so the hub can show the SAME profile
 * in a panel beside the chat - an abbreviated version there meant the hub was
 * quietly the worse place to read about a building, which is backwards.
 */
interface ComplexProfileProps {
  complex: Complex;
  /**
   * 'page' is the standalone route. 'panel' is the hub, where the profile sits
   * inside a scrolling dialog: no full-viewport hero, no back link (the panel
   * has a close button), and nothing fixed to the viewport - a fixed CTA there
   * floats over the whole app, including the chat. The CTA follows the page:
   * the concierge card beside the profile on wide screens, a bar pinned to the
   * bottom on narrow ones - the panel's bottom edge rather than the viewport's.
   */
  variant?: 'page' | 'panel';
}

export const ComplexProfile = ({ complex, variant = 'page' }: ComplexProfileProps) => {
  const isPanel = variant === 'panel';
  const { data: allComplexes } = useComplexes();
  const { data: listings, isLoading: listingsLoading } = useComplexListings(complex);
  const { user } = useAuth();
  const { createMatch, renterMatches } = useMatches();
  const navigate = useNavigate();
  const location = useLocation();
  const [modalOpen, setModalOpen] = useState(false);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [likedIds, setLikedIds] = useState<Set<string>>(new Set());

  // Reflect properties the renter has already matched (e.g. liked in AI search)
  // so their heart shows filled here too.
  useEffect(() => {
    if (renterMatches.length === 0) return;
    setLikedIds(prev => {
      const next = new Set(prev);
      renterMatches.forEach(m => next.add(m.property_id));
      return next;
    });
  }, [renterMatches]);

  // Like a live listing: creates a property_match (same flow as AI search).
  // External listings carry an "ext-" realtor id and use the renter as placeholder.
  const handleLike = async (apartment: Apartment) => {
    if (!user) {
      navigate('/auth', { state: { returnTo: location.pathname } });
      return;
    }
    const propertyId = apartment.id;
    const realtorId = apartment.realtor?.id;
    const isExternal = realtorId?.startsWith('ext-');
    setLikedIds(prev => new Set(prev).add(propertyId));
    try {
      if (isExternal) {
        await createMatch(propertyId, user.id, 'external');
      } else if (realtorId) {
        await createMatch(propertyId, realtorId, 'internal');
      }
    } catch (error: any) {
      // Keep the heart filled if it was already a match; otherwise revert.
      if (error?.message !== 'ALREADY_MATCHED') {
        setLikedIds(prev => {
          const next = new Set(prev);
          next.delete(propertyId);
          return next;
        });
      }
    }
  };

  const brackets = complex.average_rent_brackets ?? {};

  // Below lg the panel ends on its pinned CTA bar, so its bottom padding is
  // for the wide layout only - otherwise background shows under the bar.
  return (
      <div className={isPanel ? 'bg-background lg:pb-8' : 'min-h-screen bg-background pb-32 lg:pb-12'}>
        {/* Hero */}
        <div className={`relative w-full overflow-hidden ${isPanel ? 'h-56' : 'h-[55vh] min-h-[400px]'}`}>
          {complex.hero_image && (
            <img src={complex.hero_image} alt={complex.name} className="absolute inset-0 h-full w-full object-cover" />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-background via-background/40 to-transparent" />
          {/* The panel has its own close button; a "back" link there would
              suggest navigating away from a page you never left. */}
          {!isPanel && (
            <div className="absolute top-6 left-6">
              <Button asChild variant="secondary" size="sm" className="backdrop-blur-sm bg-background/70">
                <Link to="/hub"><ArrowLeft className="h-4 w-4 mr-1" aria-hidden="true" />All complexes</Link>
              </Button>
            </div>
          )}
        </div>

        <div className={`container mx-auto max-w-6xl relative z-10 ${isPanel ? 'px-5 -mt-10' : 'px-6 -mt-24'}`}>
          {/* The panel is at most 56rem wide, so a third of it squeezed the
              card into a tall column; a fixed rail keeps it compact. */}
          <div className={isPanel ? 'grid gap-8 lg:grid-cols-[minmax(0,1fr)_17rem]' : 'grid lg:grid-cols-3 gap-8'}>
            {/* Main */}
            <div className={isPanel ? 'min-w-0 space-y-10' : 'lg:col-span-2 space-y-10'}>
              {/* Title */}
              <div>
                <div className="flex flex-wrap gap-1.5 mb-3">
                  {complex.tags?.map((t) => <Badge key={t} variant="secondary">{t}</Badge>)}
                </div>
                <h1 className="font-serif text-4xl md:text-5xl leading-tight">{complex.name}</h1>
                <p className="mt-3 flex items-center gap-2 text-muted-foreground">
                  <MapPin className="h-4 w-4" aria-hidden="true" />
                  {complex.district}, {CITY_LABEL[complex.city]}
                </p>
                {complex.tagline && (
                  <p className="mt-4 text-xl text-foreground/80 font-serif italic">{complex.tagline}</p>
                )}
              </div>

              {/* Trust line */}
              <div className="flex flex-wrap gap-6 text-sm border-y border-border/60 py-4">
                {complex.management_company && (
                  <div>
                    <div className="text-xs uppercase tracking-wider text-muted-foreground">Managed by</div>
                    <div className="font-medium flex items-center gap-1.5 mt-1">
                      <Building2 className="h-4 w-4" aria-hidden="true" />{complex.management_company}
                    </div>
                  </div>
                )}
                {complex.developer && (
                  <div>
                    <div className="text-xs uppercase tracking-wider text-muted-foreground">Developer</div>
                    <div className="font-medium mt-1">{complex.developer}</div>
                  </div>
                )}
                {complex.year_completed && (
                  <div>
                    <div className="text-xs uppercase tracking-wider text-muted-foreground">Completed</div>
                    <div className="font-medium mt-1">{complex.year_completed}</div>
                  </div>
                )}
              </div>

              {/* Description / Environment & Vibe */}
              {complex.description && (
                <section>
                  <h2 className="font-serif text-2xl mb-3">Environment & vibe</h2>
                  <p className="text-foreground/80 leading-relaxed whitespace-pre-line">{complex.description}</p>
                </section>
              )}

              {/* Location map — full interactive canvas focused on this complex */}
              <section>
                <div className="flex items-end justify-between mb-4">
                  <h2 className="font-serif text-2xl">Location</h2>
                </div>
                <ComplexMapCanvas
                  complexes={allComplexes ?? [complex]}
                  focusComplexId={complex.id}
                  hideHeader
                />
              </section>




              {/* Gallery — real photos from current rental listings */}
              {complex.gallery && complex.gallery.length > 0 && (
                <section>
                  <div className="flex items-end justify-between mb-4">
                    <h2 className="font-serif text-2xl">Inside {complex.name}</h2>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                    {complex.gallery.slice(0, 6).map((src, i) => (
                      <button
                        key={src + i}
                        type="button"
                        onClick={() => setLightbox(src)}
                        className={`group relative overflow-hidden rounded-lg bg-muted ${i === 0 ? 'col-span-2 row-span-2 aspect-square' : 'aspect-square'}`}
                      >
                        <img
                          src={src}
                          alt={`${complex.name} interior ${i + 1}`}
                          loading="lazy"
                          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                        />
                      </button>
                    ))}
                  </div>
                </section>
              )}


              {/* Amenities */}
              {complex.amenities && complex.amenities.length > 0 && (
                <section>
                  <h2 className="font-serif text-2xl mb-4">Amenities</h2>
                  <div className="flex flex-wrap gap-2">
                    {complex.amenities.map((a) => <Badge key={a} variant="outline" className="text-sm py-1.5 px-3">{a}</Badge>)}
                  </div>
                </section>
              )}

              {/* Insider truths */}
              {((complex.insider_pros?.length ?? 0) + (complex.insider_cons?.length ?? 0)) > 0 && (
                <section>
                  <h2 className="font-serif text-2xl mb-4">Insider truths</h2>
                  <div className="grid sm:grid-cols-2 gap-4">
                    {complex.insider_pros && complex.insider_pros.length > 0 && (
                      <Card className="p-5">
                        <div className="flex items-center gap-2 mb-3 text-primary">
                          <ThumbsUp className="h-4 w-4" aria-hidden="true" />
                          <span className="font-medium">Strengths</span>
                        </div>
                        <ul className="space-y-2 text-sm text-foreground/80">
                          {complex.insider_pros.map((p, i) => <li key={i}>• {p}</li>)}
                        </ul>
                      </Card>
                    )}
                    {complex.insider_cons && complex.insider_cons.length > 0 && (
                      <Card className="p-5">
                        <div className="flex items-center gap-2 mb-3 text-muted-foreground">
                          <ThumbsDown className="h-4 w-4" aria-hidden="true" />
                          <span className="font-medium">Honest flaws</span>
                        </div>
                        <ul className="space-y-2 text-sm text-foreground/80">
                          {complex.insider_cons.map((p, i) => <li key={i}>• {p}</li>)}
                        </ul>
                      </Card>
                    )}
                  </div>
                </section>
              )}

              {/* Price index */}
              {Object.keys(brackets).length > 0 && (
                <section>
                  <h2 className="font-serif text-2xl mb-4">Realistic rent index (USD / month)</h2>
                  <Card className="overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50">
                        <tr>
                          <th className="text-left px-4 py-3 font-medium">Unit type</th>
                          <th className="text-right px-4 py-3 font-medium">Low</th>
                          <th className="text-right px-4 py-3 font-medium">High</th>
                        </tr>
                      </thead>
                      <tbody>
                        {Object.entries(brackets).map(([k, v]) => (
                          <tr key={k} className="border-t border-border/60">
                            <td className="px-4 py-3 font-medium">{ROOM_LABEL[k] ?? k.toUpperCase()}</td>
                            <td className="px-4 py-3 text-right">${v.min.toLocaleString()}</td>
                            <td className="px-4 py-3 text-right">${v.max.toLocaleString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </Card>
                </section>
              )}

              {/* Commute */}
              {complex.commute_times && Object.keys(complex.commute_times).length > 0 && (
                <section>
                  <h2 className="font-serif text-2xl mb-4">Commute</h2>
                  <Card className="divide-y divide-border/60">
                    {Object.entries(complex.commute_times).map(([k, v]) => (
                      <div key={k} className="flex justify-between px-4 py-3 text-sm">
                        <span className="text-foreground/80">{k}</span>
                        <span className="font-medium">{v}</span>
                      </div>
                    ))}
                  </Card>
                </section>
              )}

              {complex.pet_policy && (
                <section>
                  <Card className="p-5 bg-muted/30">
                    <div className="flex items-center gap-2 mb-2">
                      <PawPrint className="h-4 w-4" aria-hidden="true" />
                      <span className="font-medium">Pet policy</span>
                    </div>
                    <p className="text-sm text-foreground/80">{complex.pet_policy}</p>
                  </Card>
                </section>
              )}

              {/* Live listings at this complex */}
              <section>
                <div className="flex items-end justify-between mb-4">
                  <h2 className="font-serif text-2xl flex items-center gap-2">
                    <Home className="h-5 w-5" aria-hidden="true" />
                    Live listings at {complex.name}
                  </h2>
                  {!listingsLoading && listings && listings.length > 0 && (
                    <Badge variant="secondary">{listings.length} active</Badge>
                  )}
                </div>

                {!listingsLoading && (
                  <div className="mb-4">
                    <ComplexPriceBands listings={listings} complexName={complex.name} />
                  </div>
                )}

                {listingsLoading ? (
                  <div className="grid sm:grid-cols-2 gap-4">
                    <Skeleton className="h-64 w-full" />
                    <Skeleton className="h-64 w-full" />
                  </div>
                ) : listings && listings.length > 0 ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {listings.map((a) => (
                      <EditorialPropertyCard
                        key={a.id}
                        apartment={a}
                        propertyType={a.realtor?.id?.startsWith('ext-') ? 'external' : 'internal'}
                        liked={likedIds.has(a.id)}
                        onLike={() => handleLike(a)}
                      />
                    ))}
                  </div>
                ) : (
                  // No button: the concierge card, or the pinned bar below lg,
                  // already asks for this.
                  <Card className="p-6 bg-muted/30 text-center">
                    <p className="text-sm text-muted-foreground">
                      No listings advertised at {complex.name} right now - which does not mean nothing is free.
                      We can ask the agents who hold units here.
                    </p>
                  </Card>
                )}
              </section>
            </div>

            {/* Sticky CTA, wide screens only. In the panel it sticks below the
                floating ask/close buttons (12px inset + 36px tall), which it
                otherwise slid under; the panel hides the whole aside so an
                empty grid row does not leave a gap above the bar. */}
            <aside className={isPanel ? 'hidden lg:block' : 'lg:col-span-1'}>
              <div className={isPanel ? 'sticky top-16' : 'hidden lg:block sticky top-6'}>
                <Card className={isPanel ? 'p-5 border-primary/30 shadow-lg' : 'p-6 border-primary/30 shadow-xl'}>
                  <div className={`flex items-center gap-2 text-primary ${isPanel ? 'mb-2' : 'mb-3'}`}>
                    <CalendarCheck className={isPanel ? 'h-4 w-4' : 'h-5 w-5'} aria-hidden="true" />
                    <span className="text-xs uppercase tracking-wider font-medium">{SEARCH_NAME}</span>
                  </div>
                  <h3 className={`font-serif mb-2 ${isPanel ? 'text-xl leading-snug' : 'text-2xl leading-tight'}`}>
                    Check what is free for your move-in date
                  </h3>
                  <p className={`text-sm text-muted-foreground ${isPanel ? 'mb-4' : 'mb-5'}`}>
                    Tell us your dates and budget. A person on our team asks the agents who hold units at {complex.name} and replies on WhatsApp.
                  </p>
                  <Button className="w-full" size={isPanel ? 'default' : 'lg'} onClick={() => setModalOpen(true)}>
                    Request availability
                  </Button>
                  {/* Each promise stays whole when the line wraps - "On" and
                      "WhatsApp" used to land on different lines. */}
                  <p className="text-xs text-muted-foreground mt-3 flex flex-wrap justify-center gap-x-1.5">
                    <span>With the Pass</span>
                    <span aria-hidden="true">·</span>
                    <span>Reply within {replyWithinText(REPLY_WITHIN_HOURS.BUILDING)}</span>
                    <span aria-hidden="true">·</span>
                    <span>On WhatsApp</span>
                  </p>
                </Card>
              </div>
            </aside>
          </div>
        </div>

        {/* Mobile CTA. The page fixes it to the viewport; the panel makes it
            sticky to its own scrolling edge, since fixed there would float
            over the whole app, chat included. Same label as the card's button,
            so a renter meets one name for the action at every width. */}
        <div
          className={`lg:hidden bg-background/95 backdrop-blur-md border-t border-border p-4 ${
            isPanel ? 'sticky bottom-0 z-20 mt-8' : 'fixed bottom-0 inset-x-0 z-50'
          }`}
        >
          <Button className="w-full" size="lg" onClick={() => setModalOpen(true)}>
            Request availability
          </Button>
        </div>

        <ConciergeCaptureModal
          open={modalOpen}
          onOpenChange={setModalOpen}
          complexId={complex.id}
          complexName={complex.name}
        />


        {/* Image lightbox */}
        <Dialog open={!!lightbox} onOpenChange={(o) => !o && setLightbox(null)}>
          <DialogContent className="max-w-5xl p-0 bg-background/95 border-0">
            {lightbox && (
              <img src={lightbox} alt={complex.name} className="w-full h-auto max-h-[85vh] object-contain rounded-lg" />
            )}
          </DialogContent>
        </Dialog>
      </div>
  );
};
