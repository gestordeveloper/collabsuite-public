// Modo embutido (ver css/embed.css): só age quando a página está num iframe do mesmo domínio do CollabSuite.
(function () {
  var host;
  try {
    if (window.parent === window) return;
    host = window.parent.document.documentElement;
  } catch (e) { return; }

  var root = document.documentElement;
  root.classList.add('embedded');

  function sync() {
    root.classList.toggle('cs-light', !host.classList.contains('dark'));
    var primary = window.parent.getComputedStyle(host).getPropertyValue('--primary').trim();
    if (!primary) return;
    root.style.setProperty('--pink-500', primary);
    root.style.setProperty('--pink-hover', 'color-mix(in srgb, ' + primary + ' 88%, #fff)');
    root.style.setProperty('--pink-soft', 'color-mix(in srgb, ' + primary + ' 14%, transparent)');
    root.style.setProperty('--accent-glow', 'color-mix(in srgb, ' + primary + ' 35%, transparent)');
    root.style.setProperty('--focus-ring', '0 0 0 3px color-mix(in srgb, ' + primary + ' 22%, transparent)');
  }

  sync();
  new MutationObserver(sync).observe(host, { attributes: true, attributeFilter: ['class', 'style'] });
})();
