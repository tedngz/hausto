

# Infer "Furnished" Status from Furniture Amenities

## Problem
The AI incorrectly reports properties as "not furnished" even when their amenities list contains furniture items like "Bed," "Sofa," "Wardrobe," "Bookshelf," etc. Currently the check only looks for the literal word "furnished."

## Solution
Add a furniture-keyword inference step in the amenity matching logic of `supabase/functions/chat-ai/index.ts`. When a user asks for "furnished," the system will check not just for the word "furnished" but also for the presence of furniture-related amenities.

## Changes

### `supabase/functions/chat-ai/index.ts`

1. **Add a furniture keywords list** near the amenity matching section (~line 752):
   ```
   const FURNITURE_KEYWORDS = [
     'bed', 'sofa', 'couch', 'wardrobe', 'desk', 'table', 'dresser',
     'bookshelf', 'cabinet', 'chair', 'mattress', 'nightstand',
     'bedside table', 'dining table', 'coffee table', 'tv stand',
     'shelving', 'armchair', 'bar stool', 'barstools'
   ];
   ```

2. **Update the amenity matching logic** for the "furnished" amenity specifically: when the requested amenity is "furnished," also check if the property has 2+ furniture-related items in its amenities list. If so, treat it as a match (furnished).

3. **Update the system prompt** (~line 1348): Expand the AMENITY ACCURACY instruction to say:
   - "A property is considered furnished if 'Furnished' appears in amenities/description/highlights, OR if the property has multiple furniture items (e.g., Bed, Sofa, Wardrobe, Desk) in its amenities."

## Why 2+ furniture items?
A single item like "Bed" in a studio might be minimal. But 2+ furniture items (e.g., Bed + Wardrobe, or Sofa + Desk) strongly indicate a furnished unit. This avoids false positives from properties that only have built-in fixtures.

