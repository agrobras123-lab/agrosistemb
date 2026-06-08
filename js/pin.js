/* =====================================================================
 * Agro Bras Hortifruti — Tela de Acesso (trava de balcão)
 * ---------------------------------------------------------------------
 * PIN único de 4 dígitos definido em js/supabase.js (APP_PIN).
 * Campo único de PIN (estilo login), com botão de mostrar/ocultar.
 * Enquanto não destravado, o resto do app fica escondido.
 * O estado destravado vive em sessionStorage: fechou a aba, tranca de novo.
 * ===================================================================== */
(function () {
  const UNLOCK_KEY = 'agb_unlocked';

  const overlay = document.getElementById('pin-screen');
  const form = document.getElementById('loginForm');
  const input = document.getElementById('pin');
  const field = document.getElementById('field');
  const hint = document.getElementById('pin-error');
  const eye = document.getElementById('eye');

  function icons() {
    if (window.lucide && typeof lucide.createIcons === 'function') {
      try { lucide.createIcons(); } catch (e) { /* silencioso */ }
    }
  }

  function isUnlocked() {
    return sessionStorage.getItem(UNLOCK_KEY) === '1';
  }

  function flashHint(msg, ok) {
    hint.textContent = msg;
    hint.classList.toggle('ok', !!ok);
    hint.classList.add('show');
  }
  function clearHint() { hint.classList.remove('show'); }

  function shake(msg) {
    field.classList.add('error', 'shake');
    flashHint(msg || 'PIN incorreto, tente novamente', false);
    setTimeout(() => { field.classList.remove('shake'); input.select(); }, 420);
  }

  function unlock() {
    sessionStorage.setItem(UNLOCK_KEY, '1');
    overlay.classList.add('hidden');
    document.body.classList.remove('locked');
    window.dispatchEvent(new CustomEvent('agb:unlocked'));
  }

  function lock() {
    sessionStorage.removeItem(UNLOCK_KEY);
    input.value = '';
    input.type = 'password';
    clearHint();
    field.classList.remove('error');
    overlay.classList.remove('hidden');
    document.body.classList.add('locked');
    icons();
    input.focus({ preventScroll: true });
  }

  // só dígitos; limpa erro ao digitar
  input.addEventListener('input', () => {
    input.value = input.value.replace(/\D/g, '');
    clearHint();
    field.classList.remove('error');
  });

  // mostrar / ocultar PIN
  eye.addEventListener('click', () => {
    const mostrar = input.type === 'password';
    input.type = mostrar ? 'text' : 'password';
    eye.setAttribute('aria-label', mostrar ? 'Ocultar PIN' : 'Mostrar PIN');
    eye.innerHTML = '<i data-lucide="' + (mostrar ? 'eye-off' : 'eye') + '"></i>';
    icons();
    input.focus({ preventScroll: true });
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const val = input.value.trim();
    if (val.length === 0) { shake('Digite seu PIN para continuar'); return; }
    if (val === AGB.config.APP_PIN) {
      flashHint('Acesso liberado, redirecionando…', true);
      field.style.borderColor = '#36c878';
      setTimeout(unlock, 550);
    } else {
      shake('PIN incorreto, tente novamente');
    }
  });

  // API pública mínima
  window.AGB = window.AGB || {};
  window.AGB.lock = lock;
  window.AGB.isUnlocked = isUnlocked;

  // Estado inicial
  icons();
  if (isUnlocked()) {
    overlay.classList.add('hidden');
    document.body.classList.remove('locked');
  } else {
    document.body.classList.add('locked');
    input.focus({ preventScroll: true });
  }
})();
