// year stamp
document.addEventListener('DOMContentLoaded', () => {
  const y = document.getElementById('year');
  if (y) y.textContent = new Date().getFullYear();
});

// theme toggle (respects prefers-color-scheme, persists choice)
(function themeToggle(){
  const root = document.documentElement;
  const btn = document.getElementById('theme-toggle');
  const STORAGE_KEY = 'pref-theme';

  function apply(mode){
    root.classList.remove('light','dark');
    if (mode === 'light' || mode === 'dark') root.classList.add(mode);
    if (mode) localStorage.setItem(STORAGE_KEY, mode);
  }

  // load saved
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) apply(saved);

  btn?.addEventListener('click', () => {
    const next = root.classList.contains('dark') ? 'light'
              : root.classList.contains('light') ? 'system'
              : 'dark';
    apply(next === 'system' ? '' : next);
  });
})();
