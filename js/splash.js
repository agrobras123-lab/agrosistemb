/* =====================================================================
 * Agro Bras Hortifruti — Splash de abertura
 * ---------------------------------------------------------------------
 * Toca a animação do logo uma vez ao carregar o app e some sozinha,
 * revelando a tela de PIN por baixo. Pode ser pulada a qualquer momento
 * (clique/toque na tela ou no botão "Pular"). Não interfere no fluxo de
 * acesso: o PIN já está montado embaixo enquanto a splash está visível.
 * ===================================================================== */
(function () {
  const splash = document.getElementById('splash');
  if (!splash) return;

  // Tempo total da animação até a tagline aparecer (~4.6s). Damos uma folga
  // para o usuário apreciar e então iniciamos o fade-out.
  const AUTO_MS = 5200;

  let done = false;
  function dismiss() {
    if (done) return;
    done = true;
    splash.classList.add('fade-out');
    // remove do DOM após o fade para liberar a tela e parar as animações
    splash.addEventListener('transitionend', () => splash.remove(), { once: true });
    // garante remoção mesmo se o transitionend não disparar
    setTimeout(() => { if (splash.isConnected) splash.remove(); }, 800);
  }

  // Pular: botão dedicado ou toque/clique em qualquer ponto da splash
  const skip = document.getElementById('splash-skip');
  if (skip) skip.addEventListener('click', dismiss);
  splash.addEventListener('click', dismiss);

  // Respeita "reduzir movimento": sai bem mais rápido
  const reduz = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  setTimeout(dismiss, reduz ? 1200 : AUTO_MS);
})();
