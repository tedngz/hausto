import { detectLifestyleIntent, hasShoppingKeyword } from './supabase/functions/_shared/lifestyle-kb.ts';

const message = "let me know the vibe in Thao Dien";

console.log("hasShoppingKeyword:", hasShoppingKeyword(message));
console.log("detectLifestyleIntent:", detectLifestyleIntent(message));
