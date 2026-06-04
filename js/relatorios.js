/* =====================================================================
 * Agro Bras Hortifruti — Relatórios (Etapa 5)
 * 1) Vendas    — período/cliente/forma/vendedor; total geral + por
 *                modalidade; avulsas identificadas.
 * 2) Compras   — idem, com fornecedor.
 * 3) Clientes  — lista + saldo + total de fiado + histórico.
 * 4) Fornecedores — idem (saldo em aberto / total a pagar).
 * 5) Produtos  — mais vendidos por quantidade e por valor (sem período).
 * Todos imprimíveis (cupom 80mm na mesma impressora).
 *
 * "Parcial em aberto" sempre como categoria CALCULADA (total − pagamentos).
 * ===================================================================== */
(function () {
  const UI = () => window.AGB.ui;
  const MOD_ORDEM = ['dinheiro', 'pix', 'cartao', 'boleto'];
  const MOD_LABEL = { dinheiro: 'Dinheiro', pix: 'Pix', cartao: 'Cartão', boleto: 'Boleto' };

  let main = null;
  const estado = { aba: 'vendas' };
  const cache = {}; // listas para filtros

  const TRANS = {
    vendas: { ped: 'pedidos_venda', pag: 'pagamentos_venda', emb: 'clientes', col: 'cliente_id',
              label: 'Cliente', lista: 'clientes', avulso: true, titulo: 'RELATÓRIO DE VENDAS' },
    compras: { ped: 'pedidos_compra', pag: 'pagamentos_compra', emb: 'fornecedores', col: 'fornecedor_id',
               label: 'Fornecedor', lista: 'fornecedores', avulso: false, titulo: 'RELATÓRIO DE COMPRAS' }
  };

  // ---- Datas ---------------------------------------------------------
  const fmtYMD = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const isoStart = (ymd) => new Date(ymd + 'T00:00:00').toISOString();
  const isoEndExcl = (ymd) => { const d = new Date(ymd + 'T00:00:00'); d.setDate(d.getDate() + 1); return d.toISOString(); };
  function periodoPadrao() {
    const n = new Date();
    return { ini: fmtYMD(new Date(n.getFullYear(), n.getMonth(), 1)), fim: fmtYMD(n) };
  }

  // ---- Shell ---------------------------------------------------------
  function render(el) {
    main = el;
    main.innerHTML = `
      <nav class="subnav">
        ${[['vendas', 'Vendas'], ['compras', 'Compras'], ['clientes', 'Clientes'],
           ['fornecedores', 'Fornecedores'], ['produtos', 'Produtos']]
          .map(([k, l]) => `<button class="subnav-tab${k === estado.aba ? ' active' : ''}" data-aba="${k}">${l}</button>`).join('')}
      </nav>
      <div id="rel-conteudo"></div>`;
    main.querySelectorAll('.subnav-tab').forEach((b) =>
      b.addEventListener('click', () => { estado.aba = b.dataset.aba; render(main); }));
    abrirAba();
  }

  function abrirAba() {
    if (estado.aba === 'vendas') return telaTransacao(TRANS.vendas);
    if (estado.aba === 'compras') return telaTransacao(TRANS.compras);
    if (estado.aba === 'clientes') return telaSaldos('clientes');
    if (estado.aba === 'fornecedores') return telaSaldos('fornecedores');
    if (estado.aba === 'produtos') return telaProdutos();
  }

  async function listaCache(tabela) {
    if (cache[tabela]) return cache[tabela];
    const cols = tabela === 'vendedores' ? 'id,nome' : 'id,nome';
    const { data } = await UI().db().from(tabela).select(cols).order('nome');
    cache[tabela] = data || [];
    return cache[tabela];
  }

  // ========================= VENDAS / COMPRAS =========================
  async function telaTransacao(cfg) {
    const box = main.querySelector('#rel-conteudo');
    box.innerHTML = `<div class="muted" style="padding:18px">Carregando filtros...</div>`;
    const [contraLista, vendLista] = await Promise.all([listaCache(cfg.lista), listaCache('vendedores')]);
    const per = periodoPadrao();

    box.innerHTML = `
      <section class="card bloco">
        <div class="filtros">
          <label class="campo"><span>De</span><input id="f-ini" class="input" type="date" value="${per.ini}"/></label>
          <label class="campo"><span>Até</span><input id="f-fim" class="input" type="date" value="${per.fim}"/></label>
          <label class="campo"><span>${cfg.label}</span>
            <select id="f-contra" class="input"><option value="">Todos</option>
              ${contraLista.map((c) => `<option value="${c.id}">${UI().esc(c.nome)}</option>`).join('')}</select></label>
          <label class="campo"><span>Forma</span>
            <select id="f-forma" class="input"><option value="">Todas</option>
              ${MOD_ORDEM.map((m) => `<option value="${m}">${MOD_LABEL[m]}</option>`).join('')}</select></label>
          <label class="campo"><span>Vendedor</span>
            <select id="f-vend" class="input"><option value="">Todos</option>
              ${vendLista.map((v) => `<option value="${v.id}">${UI().esc(v.nome)}</option>`).join('')}</select></label>
          <div class="filtros-acoes">
            <button id="f-gerar" class="btn btn-primary">Gerar</button>
            <button id="f-imprimir" class="btn btn-ghost" disabled>🖨 Imprimir</button>
          </div>
        </div>
      </section>
      <div id="rel-result"></div>`;

    let ultimo = null;
    const gerar = async () => {
      const filtros = {
        ini: box.querySelector('#f-ini').value, fim: box.querySelector('#f-fim').value,
        contra: box.querySelector('#f-contra').value, forma: box.querySelector('#f-forma').value,
        vend: box.querySelector('#f-vend').value
      };
      if (!filtros.ini || !filtros.fim) { UI().toast('Informe o período.', 'erro'); return; }
      const res = box.querySelector('#rel-result');
      res.innerHTML = `<div class="muted" style="padding:18px">Gerando...</div>`;
      try {
        ultimo = await consultarTransacao(cfg, filtros);
        ultimo.filtros = filtros; ultimo.contraLista = contraLista; ultimo.vendLista = vendLista;
        renderResultadoTransacao(cfg, ultimo);
        box.querySelector('#f-imprimir').disabled = false;
      } catch (err) { UI().erro('Falha ao gerar relatório', err); res.innerHTML = ''; }
    };
    box.querySelector('#f-gerar').onclick = gerar;
    box.querySelector('#f-imprimir').onclick = () => {
      if (ultimo) AGB.cupom.imprimirHTML(printTransacao(cfg, ultimo));
    };
    gerar();
  }

  async function consultarTransacao(cfg, f) {
    const db = UI().db();
    let q = db.from(cfg.ped)
      .select(`id,numero,data,total,${cfg.col},${cfg.emb}(nome),vendedores(nome)`)
      .gte('data', isoStart(f.ini)).lt('data', isoEndExcl(f.fim))
      .order('data', { ascending: true });
    if (f.contra) q = q.eq(cfg.col, f.contra);
    if (f.vend) q = q.eq('vendedor_id', f.vend);
    const { data: pedidos0, error } = await q;
    if (error) throw error;
    let pedidos = pedidos0 || [];
    let ids = pedidos.map((p) => p.id);

    let pags = [];
    if (ids.length) {
      const { data, error: e2 } = await db.from(cfg.pag).select('pedido_id,modalidade,valor').in('pedido_id', ids);
      if (e2) throw e2;
      pags = data || [];
    }
    if (f.forma) {
      const comForma = new Set(pags.filter((p) => p.modalidade === f.forma).map((p) => p.pedido_id));
      pedidos = pedidos.filter((p) => comForma.has(p.id));
      const idset = new Set(pedidos.map((p) => p.id));
      pags = pags.filter((p) => idset.has(p.pedido_id));
    }
    const total = pedidos.reduce((s, p) => s + Number(p.total), 0);
    const mods = { dinheiro: 0, pix: 0, cartao: 0, boleto: 0 };
    pags.forEach((p) => { mods[p.modalidade] = (mods[p.modalidade] || 0) + Number(p.valor); });
    const pago = MOD_ORDEM.reduce((s, m) => s + mods[m], 0);
    return { pedidos, total, mods, aberto: total - pago, qtd: pedidos.length };
  }

  function nomeContra(cfg, p) {
    const emb = p[cfg.emb];
    if (emb && emb.nome) return emb.nome;
    return cfg.avulso ? 'Avulso' : '—';
  }

  function renderResultadoTransacao(cfg, r) {
    const res = main.querySelector('#rel-result');
    const linhas = r.pedidos.map((p) => `
      <tr>
        <td>${p.numero}</td>
        <td>${UI().dataCurta(p.data)}</td>
        <td class="${(!p[cfg.emb] && cfg.avulso) ? 'avulso-tag' : ''}">${UI().esc(nomeContra(cfg, p))}</td>
        <td>${UI().esc((p.vendedores && p.vendedores.nome) || '—')}</td>
        <td class="td-valor">${UI().money(p.total)}</td>
      </tr>`).join('');
    res.innerHTML = `
      <div class="resumo-cards">
        <div class="resumo-card"><span>Total geral</span><strong>${UI().money(r.total)}</strong></div>
        <div class="resumo-card"><span>Pedidos</span><strong>${r.qtd}</strong></div>
        <div class="resumo-card"><span>Parcial em aberto</span><strong class="${r.aberto > 0.005 ? 'cor-deve' : ''}">${UI().money(r.aberto)}</strong></div>
      </div>
      <div class="dash-cols">
        <section class="card bloco">
          <h3 class="bloco-titulo">Por modalidade</h3>
          ${MOD_ORDEM.map((m) => `<div class="cp-row mod-linha"><span>${MOD_LABEL[m]}</span><span>${UI().money(r.mods[m])}</span></div>`).join('')}
          <div class="cp-row mod-linha mod-aberto"><span>Parcial em aberto</span><span>${UI().money(r.aberto)}</span></div>
          <div class="cp-row mod-total"><span>Total</span><span>${UI().money(r.total)}</span></div>
        </section>
        <section class="card bloco">
          <h3 class="bloco-titulo">${r.qtd} pedido(s)</h3>
          ${r.qtd ? `<div class="cad-lista" style="box-shadow:none;border:none">
            <table class="tabela"><thead><tr><th>Nº</th><th>Data</th><th>${cfg.label}</th><th>Vendedor</th><th>Total</th></tr></thead>
            <tbody>${linhas}</tbody></table></div>` : '<div class="empty-sm">Nenhum pedido no período/filtros.</div>'}
        </section>
      </div>`;
  }

  function printTransacao(cfg, r) {
    const f = r.filtros;
    const sub = `${UI().dataCurta(isoStart(f.ini))} a ${UI().dataCurta(isoStart(f.fim))}`;
    const filtroExtra = [
      f.contra ? `${cfg.label}: ${(r.contraLista.find((c) => c.id === f.contra) || {}).nome || ''}` : '',
      f.vend ? `Vendedor: ${(r.vendLista.find((v) => v.id === f.vend) || {}).nome || ''}` : '',
      f.forma ? `Forma: ${MOD_LABEL[f.forma]}` : ''
    ].filter(Boolean).join(' · ');
    const itens = r.pedidos.map((p) => `
      <div class="cp-item">
        <div class="cp-item-calc"><span>#${p.numero} ${UI().dataCurta(p.data)}</span><span>${UI().money(p.total)}</span></div>
        <div class="cp-info">${UI().esc(nomeContra(cfg, p))}${(p.vendedores && p.vendedores.nome) ? ' · ' + UI().esc(p.vendedores.nome) : ''}</div>
      </div>`).join('') || '<div class="cp-info">Nenhum pedido.</div>';
    const conteudo = `
      ${filtroExtra ? `<div class="cp-info">${filtroExtra}</div>` : ''}
      <div class="cp-sep"></div>
      ${itens}
      <div class="cp-sep"></div>
      <div class="cp-sub">Por modalidade</div>
      ${MOD_ORDEM.map((m) => `<div class="cp-row"><span>${MOD_LABEL[m]}</span><span>${UI().money(r.mods[m])}</span></div>`).join('')}
      <div class="cp-row"><span>Parcial em aberto</span><span>${UI().money(r.aberto)}</span></div>
      <div class="cp-row cp-total"><span>TOTAL (${r.qtd})</span><span>${UI().money(r.total)}</span></div>`;
    return AGB.cupom.relatorio(cfg.titulo, sub, conteudo);
  }

  // ====================== CLIENTES / FORNECEDORES =====================
  async function telaSaldos(tipo) {
    const cfg = tipo === 'clientes'
      ? { tabela: 'clientes', saldoCol: 'saldo_devedor', titulo: 'RELATÓRIO DE CLIENTES', totalLabel: 'Total a receber (fiado)', tipoEnt: 'cliente', ped: 'pedidos_venda', col: 'cliente_id' }
      : { tabela: 'fornecedores', saldoCol: 'saldo_aberto', titulo: 'RELATÓRIO DE FORNECEDORES', totalLabel: 'Total a pagar', tipoEnt: 'fornecedor', ped: 'pedidos_compra', col: 'fornecedor_id' };
    const box = main.querySelector('#rel-conteudo');
    box.innerHTML = `<div class="muted" style="padding:18px">Carregando...</div>`;
    const { data, error } = await UI().db().from(cfg.tabela)
      .select(`id,nome,telefone,${cfg.saldoCol}`).order('nome');
    if (error) { UI().erro('Falha ao carregar', error); return; }
    const lista = data || [];
    const totalFiado = lista.reduce((s, r) => s + Number(r[cfg.saldoCol]), 0);
    const devedores = lista.filter((r) => Number(r[cfg.saldoCol]) > 0.005).length;

    const linhas = lista.map((r) => `
      <tr>
        <td class="td-nome">${UI().esc(r.nome)}</td>
        <td>${UI().esc(r.telefone || '—')}</td>
        <td>${saldoBadge(r[cfg.saldoCol])}</td>
        <td class="td-acoes"><button class="btn btn-sm btn-ghost" data-hist="${r.id}" data-nome="${UI().esc(r.nome)}">Histórico</button></td>
      </tr>`).join('');

    box.innerHTML = `
      <div class="resumo-cards">
        <div class="resumo-card"><span>${cfg.totalLabel}</span><strong class="${totalFiado > 0.005 ? 'cor-deve' : ''}">${UI().money(totalFiado)}</strong></div>
        <div class="resumo-card"><span>Cadastrados</span><strong>${lista.length}</strong></div>
        <div class="resumo-card"><span>Com saldo</span><strong>${devedores}</strong></div>
        <div class="resumo-acoes"><button id="rel-imprimir" class="btn btn-ghost">🖨 Imprimir</button></div>
      </div>
      <div class="cad-lista">
        ${lista.length ? `<table class="tabela"><thead><tr><th>Nome</th><th>Telefone</th><th>Saldo</th><th></th></tr></thead>
          <tbody>${linhas}</tbody></table>` : '<div class="empty">Nenhum cadastro.</div>'}
      </div>`;

    box.querySelectorAll('[data-hist]').forEach((b) => b.onclick = () => abrirHistorico(cfg, b.dataset.hist, b.dataset.nome));
    box.querySelector('#rel-imprimir').onclick = () => {
      const conteudo = `
        <div class="cp-sep"></div>
        ${lista.map((r) => `<div class="cp-row"><span>${UI().esc(r.nome)}</span><span>${UI().money(r[cfg.saldoCol])}</span></div>`).join('') || '<div class="cp-info">Sem cadastros.</div>'}
        <div class="cp-sep"></div>
        <div class="cp-row cp-total"><span>${cfg.totalLabel}</span><span>${UI().money(totalFiado)}</span></div>`;
      AGB.cupom.imprimirHTML(AGB.cupom.relatorio(cfg.titulo, UI().dataCurta(new Date().toISOString()), conteudo));
    };
  }

  async function abrirHistorico(cfg, id, nome) {
    const db = UI().db();
    const m = UI().openModal({ titulo: 'Histórico — ' + nome, largura: '520px', corpo: '<div class="muted">Carregando...</div>' });
    const [peds, ajs] = await Promise.all([
      db.from(cfg.ped).select('numero,data,total').eq(cfg.col, id).order('data', { ascending: false }),
      db.from('ajustes_saldo').select('tipo,valor,data,observacao').eq('tipo_entidade', cfg.tipoEnt).eq('entidade_id', id).order('data', { ascending: false })
    ]);
    const movimentos = [
      ...(peds.data || []).map((p) => ({ data: p.data, txt: `${cfg.tipoEnt === 'cliente' ? 'Venda' : 'Compra'} #${p.numero}`, valor: Number(p.total), tipo: 'pedido' })),
      ...(ajs.data || []).map((a) => ({ data: a.data, txt: 'Ajuste ' + a.tipo + (a.observacao ? ' · ' + a.observacao : ''), valor: (a.tipo === 'debito' ? 1 : -1) * Number(a.valor), tipo: 'ajuste' }))
    ].sort((x, y) => new Date(y.data) - new Date(x.data));

    m.body.innerHTML = movimentos.length ? `
      <div class="hist-rel">
        ${movimentos.map((mv) => `<div class="hist-linha">
          <span>${UI().dataCurta(mv.data)} · ${UI().esc(mv.txt)}</span>
          <span class="${mv.valor >= 0 ? 'cor-deve' : 'saldo-credito'}">${UI().money(mv.valor)}</span>
        </div>`).join('')}
      </div>
      <p class="muted" style="font-size:.8rem;margin-top:10px">Pedidos somam ao saldo; pagamentos/abatimentos reduzem (ver saldo atual na lista).</p>`
      : '<div class="empty-sm">Sem movimentos registrados.</div>';
  }

  // ============================ PRODUTOS ==============================
  async function telaProdutos() {
    const box = main.querySelector('#rel-conteudo');
    box.innerHTML = `<div class="muted" style="padding:18px">Apurando produtos mais vendidos...</div>`;
    const { data, error } = await UI().db().from('itens_venda')
      .select('produto_id,quantidade,valor,produtos(nome,unidade)');
    if (error) { UI().erro('Falha ao apurar produtos', error); return; }
    const mapa = {};
    (data || []).forEach((it) => {
      const k = it.produto_id;
      if (!mapa[k]) mapa[k] = { nome: it.produtos ? it.produtos.nome : '(produto removido)', unidade: it.produtos ? it.produtos.unidade : '', qtd: 0, valor: 0 };
      mapa[k].qtd += Number(it.quantidade);
      mapa[k].valor += Number(it.valor);
    });
    const arr = Object.values(mapa);
    const porQtd = [...arr].sort((a, b) => b.qtd - a.qtd).slice(0, 30);
    const porValor = [...arr].sort((a, b) => b.valor - a.valor).slice(0, 30);

    const tabela = (rows, tipo) => rows.length ? `
      <table class="tabela"><thead><tr><th>#</th><th>Produto</th><th>${tipo === 'qtd' ? 'Qtd' : 'Valor'}</th></tr></thead>
      <tbody>${rows.map((r, i) => `<tr><td>${i + 1}</td><td class="td-nome">${UI().esc(r.nome)} <span class="muted">(${UI().esc(r.unidade)})</span></td>
        <td class="td-valor">${tipo === 'qtd' ? UI().qtd(r.qtd) : UI().money(r.valor)}</td></tr>`).join('')}</tbody></table>`
      : '<div class="empty-sm">Sem vendas registradas.</div>';

    box.innerHTML = `
      <div class="resumo-cards">
        <div class="resumo-card"><span>Produtos vendidos</span><strong>${arr.length}</strong></div>
        <div class="resumo-acoes"><button id="rel-imprimir" class="btn btn-ghost">🖨 Imprimir</button></div>
      </div>
      <div class="dash-cols">
        <section class="card bloco"><h3 class="bloco-titulo">Mais vendidos — por quantidade</h3><div class="cad-lista" style="box-shadow:none;border:none">${tabela(porQtd, 'qtd')}</div></section>
        <section class="card bloco"><h3 class="bloco-titulo">Mais vendidos — por valor</h3><div class="cad-lista" style="box-shadow:none;border:none">${tabela(porValor, 'valor')}</div></section>
      </div>`;

    box.querySelector('#rel-imprimir').onclick = () => {
      const bloco = (titulo, rows, tipo) => `
        <div class="cp-sub">${titulo}</div>
        ${rows.slice(0, 15).map((r, i) => `<div class="cp-row"><span>${i + 1}. ${UI().esc(r.nome)}</span><span>${tipo === 'qtd' ? UI().qtd(r.qtd) + ' ' + UI().esc(r.unidade) : UI().money(r.valor)}</span></div>`).join('') || '<div class="cp-info">Sem dados.</div>'}`;
      const conteudo = `<div class="cp-sep"></div>${bloco('Por quantidade (top 15)', porQtd, 'qtd')}<div class="cp-sep"></div>${bloco('Por valor (top 15)', porValor, 'valor')}`;
      AGB.cupom.imprimirHTML(AGB.cupom.relatorio('PRODUTOS MAIS VENDIDOS', UI().dataCurta(new Date().toISOString()), conteudo));
    };
  }

  // ---- Helpers -------------------------------------------------------
  function saldoBadge(v) {
    v = Number(v) || 0;
    if (Math.abs(v) < 0.005) return '<span class="saldo saldo-zero">Em dia</span>';
    if (v > 0) return `<span class="saldo saldo-deve">${UI().money(v)}</span>`;
    return `<span class="saldo saldo-credito">Crédito ${UI().money(-v)}</span>`;
  }

  // invalida caches de filtro ao reentrar (dados podem ter mudado)
  window.addEventListener('hashchange', () => {
    if ((location.hash || '').includes('relatorios')) { delete cache.clientes; delete cache.fornecedores; delete cache.vendedores; }
  });

  window.AGB.registerView('relatorios', render);
})();
