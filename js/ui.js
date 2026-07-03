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

  // ---- Compartilhado entre Vendas e Compras --------------------------
  // (antes duplicado nos dois módulos, que são espelhos um do outro)
  UI.MOD_ORDEM = ['dinheiro', 'pix', 'cartao', 'boleto'];
  UI.MOD_LABEL = { dinheiro: 'Dinheiro', pix: 'Pix', cartao: 'Cartão', boleto: 'Boleto' };
  // Arredonda para 2 casas (centavos) sem erro de ponto flutuante.
  UI.arred = (n) => Math.round((Number(n) || 0) * 100) / 100;
  // Indicador de etapas do fluxo (1=Itens, 2=Pagamento, 3=Pronto).
  UI.etapasHTML = (n) => {
    const passos = ['Itens', 'Pagamento', 'Pronto'];
    return `<div class="passos">${passos.map((p, i) =>
      `<span class="passo ${i + 1 === n ? 'ativo' : ''} ${i + 1 < n ? 'feito' : ''}">${i + 1}. ${p}</span>`).join('')}</div>`;
  };

  // ---- Toast ---------------------------------------------------------
  let toastTimer;
  UI.toast = (msg, tipo = 'ok') => {
    let t = document.getElementById('toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'toast';
      document.body.appendChild(t);
    }
    t.setAttribute('role', 'status');
    t.setAttribute('aria-live', 'polite');
    t.className = 'toast toast-' + tipo + ' show';
    t.textContent = msg;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
  };

  // ---- Card de erro (estado estável, com "Tentar novamente") ---------
  // Mantém o layout no lugar em vez de deixar um "Carregando..." preso.
  UI.errorCard = (container, msg, onRetry) => {
    if (!container) return;
    container.innerHTML = `
      <div class="error-card" role="alert">
        <div class="error-ico" aria-hidden="true">⚠️</div>
        <div class="error-msg">${UI.esc(msg || 'Não foi possível carregar os dados.')}</div>
        ${onRetry ? '<button class="btn btn-primary error-retry">Tentar novamente</button>' : ''}
      </div>`;
    if (onRetry) {
      const b = container.querySelector('.error-retry');
      if (b) b.onclick = onRetry;
    }
  };

  // ---- Combobox (busca + autocomplete) -------------------------------
  // Substitui <select> grande por busca por nome/código com teclado.
  // host: elemento container (será preenchido).
  // opts: { items:[{id,label,sub?,code?,search?}], value?, placeholder?, emptyText?, onChange?(id,item) }
  // - code: código exibido como chip e usado para busca/atalho (Enter por código exato).
  // Retorna { get, set, clear, focus, el }.
  UI.combobox = (host, opts) => {
    const items = (opts.items || []).map((it) => ({
      id: String(it.id),
      label: it.label || '',
      sub: it.sub || '',
      code: it.code != null && it.code !== '' ? String(it.code) : '',
      search: (it.search || (it.label + ' ' + (it.sub || '') + ' ' + (it.code != null ? it.code : ''))).toLowerCase()
    }));
    const byId = (id) => items.find((x) => x.id === String(id));
    let selectedId = opts.value != null && opts.value !== '' ? String(opts.value) : '';
    let activeIdx = -1;
    let filtered = [];

    host.classList.add('combobox');
    host.innerHTML = `
      <input type="text" class="input combobox-input" role="combobox" aria-expanded="false"
        aria-autocomplete="list" autocomplete="off" placeholder="${UI.esc(opts.placeholder || 'Buscar...')}" />
      <div class="combobox-list" role="listbox" hidden></div>`;
    const input = host.querySelector('.combobox-input');
    const list = host.querySelector('.combobox-list');

    if (selectedId && byId(selectedId)) input.value = byId(selectedId).label;

    const labelFor = (id) => { const it = byId(id); return it ? it.label : ''; };

    function compute() {
      const q = input.value.trim().toLowerCase();
      const tokens = q ? q.split(/\s+/) : [];
      let res = items.filter((it) => tokens.every((t) => it.search.includes(t)));
      if (q) {
        // Ranqueia: código exato > código começa com > nome começa com > resto (estável).
        const score = (it) => {
          const code = it.code.toLowerCase();
          if (code && code === q) return 0;
          if (code && code.startsWith(q)) return 1;
          if (it.label.toLowerCase().startsWith(q)) return 2;
          return 3;
        };
        res = res.map((it, i) => ({ it, i })).sort((a, b) => score(a.it) - score(b.it) || a.i - b.i).map((x) => x.it);
      }
      filtered = res.slice(0, 50);
    }
    function renderList() {
      if (!filtered.length) {
        list.innerHTML = `<div class="combobox-empty">${UI.esc(opts.emptyText || 'Nenhum resultado')}</div>`;
        return;
      }
      list.innerHTML = filtered.map((it, i) => `
        <div class="combobox-option${i === activeIdx ? ' active' : ''}" role="option"
          aria-selected="${i === activeIdx}" data-idx="${i}">
          <span class="cb-main">${it.code ? `<span class="cb-code">#${UI.esc(it.code)}</span>` : ''}<span class="cb-label">${UI.esc(it.label)}</span></span>
          ${it.sub ? `<span class="cb-sub">${UI.esc(it.sub)}</span>` : ''}
        </div>`).join('');
      list.querySelectorAll('.combobox-option').forEach((o) => {
        o.onmousedown = (e) => { e.preventDefault(); pick(Number(o.dataset.idx)); };
      });
    }
    function open() { compute(); if (activeIdx >= filtered.length) activeIdx = filtered.length - 1; renderList(); list.hidden = false; input.setAttribute('aria-expanded', 'true'); }
    function close() { list.hidden = true; input.setAttribute('aria-expanded', 'false'); activeIdx = -1; }
    function pickItem(it) {
      if (!it) return;
      selectedId = it.id;
      input.value = it.label;
      close();
      if (opts.onChange) opts.onChange(it.id, it);
    }
    function pick(i) { pickItem(filtered[i]); }
    function exactCode(q) {
      const t = q.trim().toLowerCase();
      return t ? items.find((it) => it.code && it.code.toLowerCase() === t) : null;
    }

    input.addEventListener('focus', open);
    input.addEventListener('input', () => { selectedId = ''; activeIdx = 0; open(); });
    input.addEventListener('blur', () => {
      // Sem clique numa opção: restaura o texto da seleção atual (evita texto solto).
      setTimeout(() => { close(); input.value = labelFor(selectedId); }, 120);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); if (list.hidden) open(); activeIdx = Math.min(activeIdx + 1, filtered.length - 1); renderList(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); activeIdx = Math.max(activeIdx - 1, 0); renderList(); }
      else if (e.key === 'Enter') {
        // Código exato + Enter seleciona direto (atalho rápido / leitor de código).
        const ex = exactCode(input.value);
        if (ex) { e.preventDefault(); pickItem(ex); return; }
        if (!list.hidden && (activeIdx >= 0 || filtered.length === 1)) { e.preventDefault(); pick(activeIdx >= 0 ? activeIdx : 0); return; }
        // Campo vazio, sem nada para selecionar: deixa o consumidor "avançar"
        // (ex.: ir para o pagamento ao pressionar Enter no produto vazio).
        if (!input.value.trim() && !selectedId && opts.onEnterEmpty) { e.preventDefault(); close(); opts.onEnterEmpty(); }
      } else if (e.key === 'Escape') { close(); }
    });

    return {
      el: host,
      get: () => selectedId,
      set: (id) => { selectedId = id ? String(id) : ''; input.value = labelFor(selectedId); },
      clear: () => { selectedId = ''; input.value = ''; },
      focus: () => input.focus()
    };
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
    const onEsc = (e) => {
      if (e.key !== 'Escape') return;
      // Fecha só o modal do topo — com modal sobre modal, um Esc não derruba os dois.
      const abertos = document.querySelectorAll('.modal-backdrop');
      if (abertos.length && abertos[abertos.length - 1] === root) close();
    };
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
