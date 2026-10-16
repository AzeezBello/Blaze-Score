// Runs before first paint so a saved light/dark choice never flashes the
// other theme. Kept out of index.html because the CSP allows no inline script.
(function () {
  try {
    var t = JSON.parse(localStorage.getItem('blaze:theme') || 'null');
    if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  } catch (e) { /* storage blocked: follow the system theme */ }
})();
