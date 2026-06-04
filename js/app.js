/* =====================================================================
 * Agro Bras Hortifruti — Shell + roteamento simples (hash-based)
 * ---------------------------------------------------------------------
 * Etapa 0: só o esqueleto. Cada rota renderiza um placeholder.
 * As etapas seguintes substituem os render*() por telas reais
 * (js/cadastros.js, js/vendas.js, etc.).
 * ===================================================================== */
(function () {
  const main = document.getElementById('view');
  const titleEl = document.getElementById('topbar-title');
  const navLinks = document.querySelectorAll('.nav-link');
  const sidebar = document.getElementById('sidebar');
  const scrim = document.getElementById('scrim');

  // ---- Rotas ---------------------------------------------------------
  // Cada módulo (cadastros.js, vendas.js, ...) registra sua tela via
  // AGB.registerView('rota', fn). Enquanto não houver tela registrada,
  // mostramos um placeholder indicando a etapa.
  const ROUTES = {
    inicio:     { titulo: 'Início',      etapa: 4, desc: 'Totais do dia: vendas e compras por modalidade, saldo do dia e contagem de pedidos.' },
    vendas:     { titulo: 'Vendas',      etapa: 2, desc: 'Fluxo de venda: vendedor → cliente/avulso → itens → pagamento → cupom 80mm.' },
    compras:    { titulo: 'Compras',     etapa: 3, desc: 'Fluxo de compra: fornecedor → itens → pagamento → cupom 80mm.' },
    cadastros:  { titulo: 'Cadastros',   etapa: 1, desc: 'Clientes, fornecedores, produtos e vendedores. Ajuste de saldo (débito/crédito/zeramento).' },
    relatorios: { titulo: 'Relatórios',  etapa: 5, desc: 'Vendas, Compras, Clientes, Fornecedores e Produtos. Todos imprimíveis.' }
  };
  const DEFAULT_ROUTE = 'inicio';
  const views = {};

  function placeholder(r) {
    const route = ROUTES[r];
    main.innerHTML = `
      <section class="placeholder card">
        <div class="placeholder-badge">Etapa ${route.etapa}</div>
        <h2>${route.titulo}</h2>
        <p>${route.desc}</p>
        <p class="muted">Esta tela será construída na etapa indicada acima.</p>
      </section>`;
  }

  // ---- Router --------------------------------------------------------
  function currentRoute() {
    const r = (location.hash || '').replace(/^#\/?/, '').split('/')[0];
    return ROUTES[r] ? r : DEFAULT_ROUTE;
  }

  function render() {
    if (!window.AGB || !AGB.isUnlocked || !AGB.isUnlocked()) return;
    const r = currentRoute();
    const route = ROUTES[r];
    titleEl.textContent = route.titulo;
    navLinks.forEach((a) => a.classList.toggle('active', a.dataset.route === r));
    document.title = `Agro Bras — ${route.titulo}`;
    closeSidebar();
    main.scrollTop = 0;
    if (views[r]) {
      try { views[r](main); }
      catch (e) { console.error('[Agro Bras] erro ao renderizar', r, e); placeholder(r); }
    } else {
      placeholder(r);
    }
  }

  // Registro de telas pelos módulos. Se a rota atual for a registrada agora,
  // re-renderiza (cobre o caso do módulo carregar depois do primeiro render).
  function registerView(rota, fn) {
    views[rota] = fn;
    if (AGB.isUnlocked && AGB.isUnlocked() && currentRoute() === rota) render();
  }

  window.AGB = window.AGB || {};
  window.AGB.registerView = registerView;

  // ---- Menu lateral (mobile) -----------------------------------------
  function openSidebar()  { sidebar.classList.add('open');  scrim.classList.add('show'); }
  function closeSidebar() { sidebar.classList.remove('open'); scrim.classList.remove('show'); }

  document.getElementById('menu-toggle').addEventListener('click', openSidebar);
  scrim.addEventListener('click', closeSidebar);

  // Botão de travar
  document.getElementById('lock-btn').addEventListener('click', () => {
    if (window.AGB && AGB.lock) AGB.lock();
  });

  // ---- Eventos -------------------------------------------------------
  window.addEventListener('hashchange', render);
  window.addEventListener('agb:unlocked', () => {
    if (!location.hash) location.hash = '#/' + DEFAULT_ROUTE;
    render();
  });

  // Boot
  document.addEventListener('DOMContentLoaded', () => {
    if (!location.hash) location.hash = '#/' + DEFAULT_ROUTE;
    if (window.AGB && AGB.isUnlocked && AGB.isUnlocked()) render();
  });

  // ---- PWA: botão instalar -------------------------------------------
  let promptInstalar = null;
  const installBtn = document.getElementById('install-btn');
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    promptInstalar = e;
    if (installBtn) installBtn.classList.remove('hidden');
  });
  if (installBtn) installBtn.addEventListener('click', async () => {
    if (!promptInstalar) return;
    promptInstalar.prompt();
    await promptInstalar.userChoice;
    promptInstalar = null;
    installBtn.classList.add('hidden');
  });
  window.addEventListener('appinstalled', () => { if (installBtn) installBtn.classList.add('hidden'); });

  // ---- Service Worker (PWA) ------------------------------------------
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch((err) =>
        console.warn('[Agro Bras] Falha ao registrar service worker:', err)
      );
    });
  }
})();
