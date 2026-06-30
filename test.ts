import { DOMParser } from 'https://deno.land/x/deno_dom/deno-dom-wasm.ts';
const html = await fetch('https://housingsgn.com/').then(r => r.text());
const doc = new DOMParser().parseFromString(html, 'text/html');
const links = Array.from(doc.querySelectorAll('a')).map(a => a.getAttribute('href'));
console.log([...new Set(links)]);
