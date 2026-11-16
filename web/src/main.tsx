import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import App, { loadBoot, type Boot } from './App';
import './styles.css';

const root = document.getElementById('root')!;
const mount = (initial?: Boot) => createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <App initial={initial} />
    </BrowserRouter>
  </StrictMode>,
);

// In production the server sends each page as readable HTML. Keep that on screen while the app's
// data loads, then swap once, so visitors never see the page blank out to a loading line.
if (root.firstElementChild) {
  // The page is already on screen, so skip the fade-in when the app replaces it. Layout turns it back on at the next page.
  document.documentElement.classList.add('no-enter');
  loadBoot().then(mount, () => mount());
}
else mount();
