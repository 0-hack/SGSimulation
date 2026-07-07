// Shared page-switcher used by the game, the Map Tracer and the 3D Designer.
// One source of truth for cross-page navigation: each page just drops a
// <div id="page-nav"></div> and loads this module — the switcher renders itself,
// detects the current page, and marks it active. No page-specific link markup.
const PAGES = [
  { id: 'game', href: '/', icon: '🎮', label: 'Game' },
  // gated: the Map Tracer edits the SHARED base map, so its link only shows on
  // servers that accept trace edits (TRACE_EDIT=1) — ordinary players never see it.
  { id: 'trace', href: '/trace.html', icon: '🗺', label: 'Map Tracer', gated: true },
  { id: 'design', href: '/design.html', icon: '🏗', label: '3D Designer' },
];

// Does this server accept base-map edits? Cached probe; fails CLOSED (link hidden).
let _canEdit = null;
export function canEditMap() {
  if (_canEdit === null) {
    _canEdit = fetch('/api/trace/canedit').then((r) => r.json()).then((j) => !!(j && j.edit)).catch(() => false);
  }
  return _canEdit;
}

function currentPage() {
  const p = location.pathname;
  if (p.endsWith('/trace.html')) return 'trace';
  if (p.endsWith('/design.html')) return 'design';
  return 'game';
}

// Render the switcher into `target` (an element or a selector). `fixed` pins it
// as a top-centre bar (for the full-screen tool pages); otherwise it flows inline.
// Gated pages start hidden and appear only once the server confirms editing is on
// (no flash of a creator link for ordinary players). The page you're ALREADY on
// always shows its own marker, so the tracer's bar still reads correctly there.
export function mountPageNav(target, { fixed = false } = {}) {
  const el = typeof target === 'string' ? document.querySelector(target) : target;
  if (!el) return null;
  const cur = currentPage();
  el.classList.add('pagenav');
  if (fixed) el.classList.add('pagenav-fixed');
  el.setAttribute('role', 'navigation');
  el.setAttribute('aria-label', 'Switch between the game and creator tools');
  const render = (showGated) => {
    el.innerHTML = PAGES.filter((pg) => !pg.gated || showGated || pg.id === cur).map((pg) => {
      const inner = `<span class="pagenav-ico" aria-hidden="true">${pg.icon}</span><span class="pagenav-lbl">${pg.label}</span>`;
      return pg.id === cur
        ? `<span class="pagenav-item is-active" aria-current="page">${inner}</span>`
        : `<a class="pagenav-item" href="${pg.href}">${inner}</a>`;
    }).join('');
  };
  render(false);
  canEditMap().then((ok) => { if (ok) render(true); });
  return el;
}

// Auto-mount into #page-nav, flowing inline within each page's own chrome (the
// game's start menu, the tracer's top bar, the designer's sidebar).
const mount = document.getElementById('page-nav');
if (mount) mountPageNav(mount);
