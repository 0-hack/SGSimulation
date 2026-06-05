// Hand-drawn monoline SVG icon set (stroke = currentColor) used across the UI,
// replacing emoji in the chrome for a cleaner, custom look.
const svg = (inner, opts = '') =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" ${opts}>${inner}</svg>`;

export const ICONS = {
  menu: svg('<path d="M4 7h16M4 12h16M4 17h16"/>'),
  close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  back: svg('<path d="M15 5l-7 7 7 7"/>'),

  // HUD stats
  money: svg('<path d="M4 7h16v10H4z"/><circle cx="12" cy="12" r="2.4"/><path d="M7 12h.01M17 12h.01"/>'),
  people: svg('<circle cx="9" cy="8" r="2.6"/><path d="M4 19c0-2.8 2.2-5 5-5s5 2.2 5 5"/><circle cx="16.5" cy="9" r="2.1"/><path d="M15 14.4c2.4.3 4 2.3 4 4.6"/>'),
  smile: svg('<circle cx="12" cy="12" r="9"/><path d="M8.5 14c1 1.3 2.2 2 3.5 2s2.5-.7 3.5-2"/><path d="M9 9.5h.01M15 9.5h.01"/>'),
  meh: svg('<circle cx="12" cy="12" r="9"/><path d="M8.5 15h7"/><path d="M9 9.5h.01M15 9.5h.01"/>'),
  frown: svg('<circle cx="12" cy="12" r="9"/><path d="M8.5 16c1-1.3 2.2-2 3.5-2s2.5.7 3.5 2"/><path d="M9 9.5h.01M15 9.5h.01"/>'),

  // toolbar
  build: svg('<path d="M4 21h16"/><path d="M6 21V8l7-3v16"/><path d="M13 21V9l5 2v10"/><path d="M9 9h.01M9 13h.01M9 17h.01"/>'),
  policy: svg('<path d="M12 4v16"/><path d="M5 8h14"/><path d="M5 8l-2.5 5a3 3 0 0 0 5 0z"/><path d="M19 8l-2.5 5a3 3 0 0 0 5 0z"/><path d="M8 20h8"/>'),
  stats: svg('<path d="M5 20V11M12 20V5M19 20v-6"/>'),
  news: svg('<path d="M5 5h11v14H5z"/><path d="M16 9h3v8a2 2 0 0 1-4 0"/><path d="M8 9h5M8 12h5M8 15h3"/>'),
  save: svg('<path d="M6.5 18a4 4 0 0 1-.4-8 5.5 5.5 0 0 1 10.7-1.2A3.8 3.8 0 0 1 18 18z"/><path d="M12 11v5M9.5 14l2.5 2.5 2.5-2.5"/>'),

  // speed
  pause: svg('<path d="M9 6v12M15 6v12"/>'),
  play: svg('<path d="M8 5l11 7-11 7z" fill="currentColor" stroke="none"/>'),
  ff2: svg('<path d="M4 6l7 6-7 6zM13 6l7 6-7 6z" fill="currentColor" stroke="none"/>'),
  ff3: svg('<path d="M2 6l6 6-6 6zM9 6l6 6-6 6zM16 6l6 6-6 6z" fill="currentColor" stroke="none"/>'),

  // category / building tabs
  residential: svg('<path d="M4 11l8-6 8 6"/><path d="M6 10v9h12v-9"/><path d="M10 19v-5h4v5"/>'),
  power: svg('<path d="M13 3L5 13h6l-1 8 8-10h-6z" fill="currentColor" stroke="none"/>'),
  water: svg('<path d="M12 3c4 5 6 8 6 11a6 6 0 0 1-12 0c0-3 2-6 6-11z"/>'),
  industry: svg('<path d="M3 20V10l5 3V10l5 3V8l8 3v9z"/><path d="M3 20h18"/>'),
  civic: svg('<path d="M12 4v6M9 7h6"/><path d="M5 21v-9l7-3 7 3v9"/><path d="M10 21v-4h4v4"/>'),
  green: svg('<path d="M12 21V11"/><path d="M12 11c0-4 3-7 8-7 0 5-3 8-8 8z"/><path d="M12 14C12 10 9 8 4 8c0 4 3 6 8 6z"/>'),

  flag: svg('<path d="M6 21V4"/><path d="M6 5h11l-2 3 2 3H6" fill="currentColor" stroke="none"/>', 'stroke-width="1.6"'),
  globe: svg('<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>'),
  bulldoze: svg('<path d="M3 18h7l2-4h6v4h3"/><circle cx="7" cy="20" r="1.6"/><circle cx="17" cy="20" r="1.6"/><path d="M5 14V9h4l2 4"/>'),
  pin: svg('<path d="M12 21s7-6.3 7-11a7 7 0 1 0-14 0c0 4.7 7 11 7 11z"/><circle cx="12" cy="10" r="2.4"/>'),
};

export const CAT_ICON = {
  residential: 'residential', power: 'power', water: 'water',
  industry: 'industry', civic: 'civic', green: 'green',
};

// Replace any element carrying [data-icon="name"] with the matching SVG.
export function injectIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach((el) => {
    const name = el.getAttribute('data-icon');
    if (ICONS[name]) el.innerHTML = ICONS[name];
  });
}
