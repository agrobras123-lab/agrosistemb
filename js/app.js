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
  // Rotas exclusivas do DONO (operador é barrado aqui).
  const DONO_ROUTES = { compras: true, cadastros: true };
  const views = {};

  function ehDono() { return !!(window.AGB && AGB.isDono && AGB.isDono()); }

  function restricted(route) {
    main.innerHTML = `
      <section class="placeholder card">
        <div class="placeholder-badge">Acesso restrito</div>
        <h2>${route.titulo} — só o dono</h2>
        <p>Esta área é liberada apenas com o <strong>acesso de dono</strong>.</p>
        <p class="muted">Trave a tela e entre com o PIN de dono para acessar.</p>
      </section>`;
  }

  // Atualiza o rótulo de papel na sidebar.
  function aplicarPapel() {
    const role = (window.AGB && AGB.role) ? AGB.role() : null;
    const el = document.getElementById('user-role');
    if (el) el.textContent = role === 'dono' ? 'Dono · acesso total'
      : role === 'operador' ? 'Operador · venda' : '—';
  }

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
    // Guarda de permissão: operador não entra em Compras/Cadastros.
    if (DONO_ROUTES[r] && !ehDono()) {
      restricted(route);
      refreshIcons();
      return;
    }
    if (views[r]) {
      try { views[r](main); }
      catch (e) { console.error('[Agro Bras] erro ao renderizar', r, e); placeholder(r); }
    } else {
      placeholder(r);
    }
    refreshIcons();
  }

  // Renderiza/atualiza os ícones Lucide (shell + tela atual)
  function refreshIcons() {
    if (window.lucide && typeof lucide.createIcons === 'function') {
      try { lucide.createIcons(); } catch (e) { /* silencioso */ }
    }
  }
  window.AGB = window.AGB || {};
  window.AGB.refreshIcons = refreshIcons;

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

  // Botões de backup/restauração na sidebar (as funções vivem em dashboard.js)
  const sbBackup = document.getElementById('sb-backup');
  if (sbBackup) sbBackup.addEventListener('click', () => {
    if (window.AGB && AGB.exportarBackup) AGB.exportarBackup(sbBackup);
  });
  const sbRestore = document.getElementById('sb-restore');
  if (sbRestore) sbRestore.addEventListener('click', () => {
    if (window.AGB && AGB.importarBackup) AGB.importarBackup(sbRestore);
  });

  // ---- Atalhos de teclado --------------------------------------------
  // F2 → nova venda (ou nova compra se estiver na aba Compras)
  // F3 → buscar/editar (venda na aba Vendas; compra na aba Compras)
  // F7 → reimprimir cupom (venda/compra conforme a aba)
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    if (!window.AGB || !AGB.isUnlocked || !AGB.isUnlocked()) return;
    const r = currentRoute();
    const dono = ehDono();
    if (e.key === 'F2') {
      e.preventDefault();
      if (r === 'compras' && dono) { if (AGB.compras) AGB.compras.nova(); }
      else if (AGB.vendas) AGB.vendas.nova();
    } else if (e.key === 'F3') {
      if (r === 'vendas' && dono) { e.preventDefault(); if (AGB.vendas) AGB.vendas.busca(); }
      else if (r === 'compras' && dono) { e.preventDefault(); if (AGB.compras) AGB.compras.busca(); }
    } else if (e.key === 'F7') {
      if (r === 'vendas') { e.preventDefault(); if (AGB.vendas) AGB.vendas.reimprimir(); }
      else if (r === 'compras' && dono) { e.preventDefault(); if (AGB.compras) AGB.compras.reimprimir(); }
    }
  });

  // ---- Eventos -------------------------------------------------------
  window.addEventListener('hashchange', render);
  window.addEventListener('agb:unlocked', () => {
    aplicarPapel();
    location.hash = '#/' + DEFAULT_ROUTE; // sempre cai no Início ao entrar
    render();
    refreshIcons();
  });

  // Boot
  document.addEventListener('DOMContentLoaded', () => {
    refreshIcons(); // ícones do shell (sidebar/topbar)
    if (!location.hash) location.hash = '#/' + DEFAULT_ROUTE;
    if (window.AGB && AGB.isUnlocked && AGB.isUnlocked()) { aplicarPapel(); render(); }
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
    // Quando um service worker novo assume o controle, recarrega a página uma
    // única vez para que o código mais novo entre em ação automaticamente
    // (sem o usuário precisar dar "hard refresh").
    let recarregando = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (recarregando) return;
      recarregando = true;
      window.location.reload();
    });
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch((err) =>
        console.warn('[Agro Bras] Falha ao registrar service worker:', err)
      );
    });
  }
})();
