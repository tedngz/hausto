import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import { trackAppHeight } from './lib/appHeight'

trackAppHeight();

createRoot(document.getElementById("root")!).render(<App />);
