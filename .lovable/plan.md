

# Add Title to Swipe Interface

## What
Add a motivational title above the swipe cards, consistent with the other views ("Describe Your Dream Home" for AI chat, "Your Matches" for matches).

## Title Choice
Based on your suggestions, I recommend **"Vibe & Find Your Home"** -- it combines the app's "vibe" branding with the action of discovering. But here are all options for reference:
- "Vibe & Find Your Home"
- "Let's Vibe"
- "Start Vibing"
- "Vibe to Find Your Home"

I'll go with **"Vibe & Find Your Home"** unless you prefer another.

## Technical Changes

### `src/pages/Discover.tsx`
Add a title block for the `swipe` view, matching the existing pattern used for `ai-chat`:

```
{currentView === 'swipe' && userType && (
  <div className="text-center py-0">
    <h1 className="text-2xl font-bold mt-20 mb-2 text-center text-inherit">
      Vibe & Find Your Home
    </h1>
  </div>
)}
```

This reuses the exact same styling as the "Describe Your Dream Home" title, keeping visual consistency across views. The `mt-20` accounts for the fixed navigation bar.

Since the `SwipeInterface` component itself already adds `pt-20` for nav spacing, I'll remove the duplicate top spacing from the swipe interface's main container to avoid double padding -- or alternatively, place the title inside `SwipeInterface.tsx` instead. I'll add it in `Discover.tsx` for consistency with how the AI chat title is handled, and adjust the SwipeInterface's `pt-20` to `pt-4` so the title + card flow naturally.

### `src/components/SwipeInterface.tsx`
Change the top padding from `pt-20` to `pt-4` on the main render returns (lines 540, 555, 584, 620, 665) since the title in `Discover.tsx` will now handle the top spacing.

