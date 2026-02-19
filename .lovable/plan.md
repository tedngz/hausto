

# Icon Animations for Landing Page Features

## Overview
Add three distinct animations to the feature section icons: a heartbeat pulse for the Heart icon, a gentle floating bob for the Search icon, and a radiating pulse ring behind the MessageSquare icon.

## Animations

### 1. Heart - Heartbeat
A rhythmic scale pulse mimicking a heartbeat (quick double-beat, then pause).

### 2. Search - Gentle Bob
A slow up-and-down floating motion (translateY oscillation).

### 3. MessageSquare - Pulse Ring
A radiating ring that expands outward from behind the icon and fades, using a pseudo-element on the wrapper div.

## Technical Details

### `src/index.css` - Add 3 new keyframes + classes

```css
@keyframes heartbeat {
  0%, 100% { transform: scale(1); }
  14% { transform: scale(1.15); }
  28% { transform: scale(1); }
  42% { transform: scale(1.25); }
  56% { transform: scale(1); }
}

@keyframes gentle-bob {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-6px); }
}

@keyframes pulse-ring {
  0% { transform: scale(1); opacity: 0.4; }
  100% { transform: scale(1.8); opacity: 0; }
}

.animate-heartbeat { animation: heartbeat 1.8s ease-in-out infinite; }
.animate-gentle-bob { animation: gentle-bob 3s ease-in-out infinite; }

.pulse-ring-wrapper {
  position: relative;
}
.pulse-ring-wrapper::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: 9999px;
  border: 2px solid hsl(var(--primary));
  animation: pulse-ring 2.5s ease-out infinite;
}
```

### `src/components/LandingPage.tsx` - Apply classes to icons

- Heart icon: add `animate-heartbeat` class
- Search icon: add `animate-gentle-bob` class
- MessageSquare wrapper div: add `pulse-ring-wrapper` class alongside existing classes

No new dependencies required.

