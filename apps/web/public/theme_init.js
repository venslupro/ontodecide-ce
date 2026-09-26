// Applies the stored theme before first paint to avoid a flash of the wrong
// theme. Kept as an external file so the CSP can forbid inline scripts.
(function () {
  try {
    var raw = localStorage.getItem('od.prefs');
    var p = raw ? JSON.parse(raw) : {};
    var t = p.theme || 'dark';
    if (t === 'system') {
      t = matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    }
    if (/[?&]mode=wall/.test(location.search)) t = 'dark';
    document.documentElement.dataset.theme = t;
  } catch (e) {
    document.documentElement.dataset.theme = 'dark';
  }
})();
