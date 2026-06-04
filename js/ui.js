/* =====================================================================
 * Agro Bras Hortifruti — Helpers de UI compartilhados
 * Usados por cadastros, vendas, compras, relatórios.
 * ===================================================================== */
(function () {
  const UI = {};

  // ---- Formatação ----------------------------------------------------
  const fmtBRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  UI.money = (n) => fmtBRL.format(Number(n) || 0);

  const fmtQtd = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 3 });
  UI.qtd = (n) => fmtQtd.format(Number(n) || 0);

  UI.data = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  };
  UI.dataCurta = (iso) => (iso ? new Date(iso).toLocaleDateString('pt-BR') : '');

  // Escapa texto para inserção segura em HTML
  UI.esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---- Toast ---------------------------------------------------------
  let toastTimer;
  UI.toast = (msg, tipo = 'ok') => {
    let t = document.getElementById('toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'toast';
      document.body.appendChild(t);
    }
    t.className = 'toast toast-' + tipo + ' show';
    t.textContent = msg;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
  };

  // ---- Modal ---------------------------------------------------------
  // openModal({ titulo, corpo (HTML string), largura }) → devolve { root, body, close }
  UI.openModal = ({ titulo, corpo, largura }) => {
    const root = document.createElement('div');
    root.className = 'modal-backdrop';
    root.innerHTML = `
      <div class="modal" style="${largura ? 'max-width:' + largura + ';' : ''}">
        <div class="modal-head">
          <h3>${UI.esc(titulo)}</h3>
          <button class="icon-btn modal-x" aria-label="Fechar">✕</button>
        </div>
        <div class="modal-body">${corpo || ''}</div>
      </div>`;
    const close = () => { root.remove(); document.removeEventListener('keydown', onEsc); };
    const onEsc = (e) => { if (e.key === 'Escape') close(); };
    root.addEventListener('click', (e) => { if (e.target === root) close(); });
    root.querySelector('.modal-x').addEventListener('click', close);
    document.addEventListener('keydown', onEsc);
    document.body.appendChild(root);
    return { root, body: root.querySelector('.modal-body'), close };
  };

  // confirmDialog(msg) → Promise<boolean>
  UI.confirm = (msg, { okLabel = 'Confirmar', perigo = false } = {}) =>
    new Promise((resolve) => {
      const m = UI.openModal({
        titulo: 'Confirmar',
        largura: '380px',
        corpo: `
          <p style="margin-top:0">${UI.esc(msg)}</p>
          <div class="form-actions">
            <button class="btn btn-ghost" data-x>Cancelar</button>
            <button class="btn ${perigo ? 'btn-danger' : 'btn-primary'}" data-ok>${UI.esc(okLabel)}</button>
          </div>`
      });
      m.body.querySelector('[data-x]').onclick = () => { m.close(); resolve(false); };
      m.body.querySelector('[data-ok]').onclick = () => { m.close(); resolve(true); };
    });

  // ---- Supabase guard ------------------------------------------------
  // Garante que há cliente; devolve o cliente ou lança erro amigável.
  UI.db = () => {
    if (!window.AGB || !AGB.client) {
      UI.toast('Supabase não configurado. Verifique js/supabase.js.', 'erro');
      throw new Error('Supabase client indisponível');
    }
    return AGB.client;
  };

  // Trata erro de query do supabase de forma uniforme
  UI.erro = (contexto, error) => {
    console.error('[Agro Bras]', contexto, error);
    UI.toast(contexto + ': ' + (error?.message || 'erro desconhecido'), 'erro');
  };

  window.AGB = window.AGB || {};
  window.AGB.ui = UI;
})();
