// script.js
(() => {
  const root = document.documentElement;
  const btn  = document.getElementById('theme-toggle');
  const KEY  = 'pref-theme';

  // read saved preference
  const saved = localStorage.getItem(KEY);
  if (saved) {
    // user clicked before → force that theme
    root.setAttribute('data-theme', saved);
    btn?.setAttribute('aria-pressed', String(saved === 'dark'));
  } else {
    // no saved choice → leave no data-theme
    // the CSS + media query decides initial color
  }

  // toggle on click
  btn?.addEventListener('click', () => {
    const current = root.getAttribute('data-theme');
    let next;
    if (!current) {
      // user has no stored pref yet, so detect current system mode
      const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      next = systemDark ? 'light' : 'dark'; // flip whatever system is
    } else {
      next = current === 'dark' ? 'light' : 'dark';
    }
    root.setAttribute('data-theme', next);
    localStorage.setItem(KEY, next);
    btn?.setAttribute('aria-pressed', String(next === 'dark'));
  });
})();
