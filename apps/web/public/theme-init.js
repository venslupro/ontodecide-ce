/*
 * Applies the stored theme before the first paint (loaded synchronously in
 * <head>; the CSP allows no inline script). Same logic as
 * src/shared/lib/theme.ts: od.prefs.theme = system | light | dark, "system"
 * follows prefers-color-scheme. Keep the two in sync.
 */
(function () {
  var pref = 'system';
  try {
    var p = JSON.parse(localStorage.getItem('od.prefs') || '{}');
    if (p && (p.theme === 'light' || p.theme === 'dark')) pref = p.theme;
  } catch (e) {
    // Storage unavailable: follow the system.
  }
  var dark = true;
  try {
    dark = matchMedia('(prefers-color-scheme: dark)').matches;
  } catch (e) {
    // No matchMedia: keep dark.
  }
  var theme = pref === 'system' ? (dark ? 'dark' : 'light') : pref;
  var root = document.documentElement;
  root.setAttribute('data-theme', theme);
  root.style.colorScheme = theme;
})();
