/**
 * The Hausto brand lockup - the mark and wordmark exactly as the homepage
 * draws them, so every header, footer and sign-in screen shows the same logo
 * instead of each surface inventing its own size and colour.
 *
 * This renders the lockup only. Wrap it in whatever <a>, <Link> or <button>
 * the surface needs. The mark is decorative (`alt=""`) because the wordmark
 * sits right next to it - if you pass `hideWordmarkOnMobile`, give the wrapper
 * an aria-label so the brand still has an accessible name on small screens.
 */
const MARK_SRC = '/lovable-uploads/15e7e5a0-a35d-46c1-b0ba-9e273a963e39.png';

const SIZES = {
  /** Compact nav bars and footers. */
  sm: { mark: 'h-6 w-6', word: 'text-lg' },
  /** The homepage header, and any page that mirrors it. */
  md: { mark: 'h-6 w-6 md:h-8 md:w-8', word: 'text-lg md:text-2xl' },
  /** Standalone screens where the logo is the page's masthead (auth). */
  lg: { mark: 'h-8 w-8 md:h-10 md:w-10', word: 'text-2xl md:text-3xl' },
} as const;

interface HaustoLogoProps {
  size?: keyof typeof SIZES;
  /** Drop the wordmark on the narrowest screens, where nav bars run out of room. */
  hideWordmarkOnMobile?: boolean;
  className?: string;
}

export const HaustoLogo = ({
  size = 'md',
  hideWordmarkOnMobile = false,
  className = '',
}: HaustoLogoProps) => {
  const { mark, word } = SIZES[size];
  return (
    <span className={`flex items-center gap-2 ${className}`}>
      <img src={MARK_SRC} alt="" className={`${mark} shrink-0`} />
      <span
        className={`font-bold text-foreground ${word} ${hideWordmarkOnMobile ? 'hidden sm:inline' : ''}`}
      >
        Hausto
      </span>
    </span>
  );
};
