(function () {
  'use strict';

  if (window.top === window.self) return;
  document.documentElement.style.display = 'none';
  try {
    window.top.location = window.self.location.href;
  } catch (_) {
    // A página permanece oculta quando o navegador bloqueia a navegação do topo.
  }
})();
