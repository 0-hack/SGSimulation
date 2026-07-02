// Shared page-switcher used by the game, the Map Tracer and the 3D Designer.
// One source of truth for cross-page navigation: each page just drops a
// <div id="page-nav"></div> and loads this module — the switcher renders itself,
// detects the current page, and marks it active. No page-specific link markup.
const PAGES = [
  { id: 'game', href: '/', icon: '🎮', label: 'Game' },
  { id: 'trace', href: '/trace.html', icon: '🗺', label: 'Map Tracer' },
  { id: 'design', href: '/design.html', icon: '🏗', label: '3D Designer' },
];

function currentPage() {
  const p = location.pathname;
  if (p.endsWith('/trace.html')) return 'trace';
  if (p.endsWith('/design.html')) return 'design';
  return 'game';
}

// Render the switcher into `target` (an element or a selector). `fixed` pins it
// as a top-centre bar (for the full-screen tool pages); otherwise it flows inline.
export function mountPageNav(target, { fixed = false } = {}) {
  const el = typeof target === 'string' ? document.querySelector(target) : target;
  if (!el) return null;
  const cur = currentPage();
  el.classList.add('pagenav');
  if (fixed) el.classList.add('pagenav-fixed');
  el.setAttribute('role', 'navigation');
  el.setAttribute('aria-label', 'Switch between the game and creator tools');
  el.innerHTML = PAGES.map((pg) => {
    const inner = `<span class="pagenav-ico" aria-hidden="true">${pg.icon}</span><span class="pagenav-lbl">${pg.label}</span>`;
    return pg.id === cur
      ? `<span class="pagenav-item is-active" aria-current="page">${inner}</span>`
      : `<a class="pagenav-item" href="${pg.href}">${inner}</a>`;
  }).join('');
  return el;
}

// Auto-mount into #page-nav, flowing inline within each page's own chrome (the
// game's start menu, the tracer's top bar, the designer's sidebar).
const mount = document.getElementById('page-nav');
if (mount) mountPageNav(mount);
