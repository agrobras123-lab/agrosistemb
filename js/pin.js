/* =====================================================================
 * Agro Bras Hortifruti — Tela de PIN (trava de balcão)
 * ---------------------------------------------------------------------
 * PIN único de 4 dígitos definido em js/supabase.js (APP_PIN).
 * Enquanto não destravado, o resto do app fica escondido.
 * O estado destravado vive em sessionStorage: fechou a aba, tranca de novo.
 * ===================================================================== */
(function () {
  const UNLOCK_KEY = 'agb_unlocked';
  let buffer = '';

  const overlay = document.getElementById('pin-screen');
  const dots = Array.from(document.querySelectorAll('#pin-dots .pin-dot'));
  const keys = document.querySelectorAll('#pin-pad [data-key]');
  const errorEl = document.getElementById('pin-error');

  function isUnlocked() {
    return sessionStorage.getItem(UNLOCK_KEY) === '1';
  }

  function renderDots() {
    dots.forEach((d, i) => d.classList.toggle('filled', i < buffer.length));
  }

  function shake() {
    errorEl.textContent = 'PIN incorreto';
    overlay.classList.add('pin-shake');
    setTimeout(() => overlay.classList.remove('pin-shake'), 400);
    buffer = '';
    renderDots();
  }

  function unlock() {
    sessionStorage.setItem(UNLOCK_KEY, '1');
    overlay.classList.add('hidden');
    document.body.classList.remove('locked');
    window.dispatchEvent(new CustomEvent('agb:unlocked'));
  }

  function lock() {
    sessionStorage.removeItem(UNLOCK_KEY);
    buffer = '';
    errorEl.textContent = '';
    renderDots();
    overlay.classList.remove('hidden');
    document.body.classList.add('locked');
  }

  function press(val) {
    errorEl.textContent = '';
    if (val === 'back') {
      buffer = buffer.slice(0, -1);
      renderDots();
      return;
    }
    if (buffer.length >= 4) return;
    buffer += val;
    renderDots();
    if (buffer.length === 4) {
      // pequeno atraso só pra mostrar o 4º ponto preenchido
      setTimeout(() => {
        if (buffer === AGB.config.APP_PIN) unlock();
        else shake();
      }, 120);
    }
  }

  keys.forEach((btn) => {
    btn.addEventListener('click', () => press(btn.dataset.key));
  });

  // Teclado físico (útil no PC)
  window.addEventListener('keydown', (e) => {
    if (overlay.classList.contains('hidden')) return;
    if (e.key >= '0' && e.key <= '9') press(e.key);
    else if (e.key === 'Backspace') press('back');
  });

  // API pública mínima
  window.AGB = window.AGB || {};
  window.AGB.lock = lock;
  window.AGB.isUnlocked = isUnlocked;

  // Estado inicial
  if (isUnlocked()) {
    overlay.classList.add('hidden');
    document.body.classList.remove('locked');
  } else {
    document.body.classList.add('locked');
    renderDots();
  }
})();
