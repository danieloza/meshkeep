(function () {
  try {
    var saved = localStorage.getItem('meshkeep-theme');
    var dark = saved === 'dark' || (!saved && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.classList.toggle('dark', dark);
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
  } catch (_) {
    // Theme selection remains available after hydration.
  }
})();
