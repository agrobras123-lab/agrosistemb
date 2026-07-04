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
    vendas: { tipo: 'venda', emb: 'clientes', col: 'cliente_id',
              label: 'Cliente', lista: 'clientes', avulso: true, titulo: 'RELATÓRIO DE VENDAS' },
    compras: { tipo: 'compra', emb: 'fornecedores', col: 'fornecedor_id',
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
           ['fornecedores', 'Fornecedores'], ['produtos', 'Produtos'], ['boletos', 'Boletos']]
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
    if (estado.aba === 'boletos') return telaBoletos();
  }

  async function listaCache(tabela) {
    if (cache[tabela]) return cache[tabela];
    const { data } = await UI().db().from(tabela).select('id,nome').order('nome');
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
    // Agregação no SERVIDOR (RPC rel_transacao): totais corretos sobre TODOS
    // os pedidos do período — sem o limite de 1000 linhas do PostgREST. Devolve
    // um único JSON compacto (totais + por modalidade + lista de pedidos).
    const { data, error } = await UI().db().rpc('rel_transacao', {
      p_tipo: cfg.tipo,
      p_ini: isoStart(f.ini),
      p_fim: isoEndExcl(f.fim),
      p_contra: f.contra || null,
      p_vend: f.vend || null,
      p_forma: f.forma || null
    });
    if (error) throw error;
    const r = data || {};
    const m = r.mods || {};
    return {
      pedidos: r.pedidos || [],
      total: Number(r.total) || 0,
      mods: {
        dinheiro: Number(m.dinheiro) || 0, pix: Number(m.pix) || 0,
        cartao: Number(m.cartao) || 0, boleto: Number(m.boleto) || 0
      },
      aberto: Number(r.aberto) || 0,
      qtd: Number(r.qtd) || 0
    };
  }

  function nomeContra(cfg, p) {
    if (p.contra) return p.contra;
    return cfg.avulso ? 'Avulso' : '—';
  }

  function renderResultadoTransacao(cfg, r) {
    const res = main.querySelector('#rel-result');
    const linhas = r.pedidos.map((p) => `
      <tr>
        <td>${p.numero}</td>
        <td>${UI().dataCurta(p.data)}</td>
        <td class="${(!p.contra && cfg.avulso) ? 'avulso-tag' : ''}">${UI().esc(nomeContra(cfg, p))}</td>
        <td>${UI().esc(p.vendedor || '—')}</td>
        <td class="td-valor">${UI().money(p.total)}</td>
      </tr>`).join('');
    const notaLista = r.pedidos.length < r.qtd
      ? `<p class="muted" style="font-size:.8rem;margin:6px 2px 0">Listagem limitada aos ${r.pedidos.length} primeiros do período — os totais acima já consideram todos os ${r.qtd} pedidos.</p>`
      : '';
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
          ${notaLista}
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
    const PRINT_CAP = 300;
    const lista = r.pedidos.slice(0, PRINT_CAP);
    const itens = lista.map((p) => `
      <div class="cp-item">
        <div class="cp-item-calc"><span>#${p.numero} ${UI().dataCurta(p.data)}</span><span>${UI().money(p.total)}</span></div>
        <div class="cp-info">${UI().esc(nomeContra(cfg, p))}${p.vendedor ? ' · ' + UI().esc(p.vendedor) : ''}</div>
      </div>`).join('') || '<div class="cp-info">Nenhum pedido.</div>';
    const notaPrint = r.qtd > lista.length
      ? `<div class="cp-info">(listados ${lista.length} de ${r.qtd} — o TOTAL abaixo considera todos)</div>`
      : '';
    const conteudo = `
      ${filtroExtra ? `<div class="cp-info">${filtroExtra}</div>` : ''}
      <div class="cp-sep"></div>
      ${itens}
      ${notaPrint}
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
        <td class="td-acoes"><button class="btn btn-sm btn-ghost" data-hist="${r.id}" data-nome="${UI().esc(r.nome)}">Extrato</button></td>
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

    box.querySelectorAll('[data-hist]').forEach((b) => b.onclick = () => abrirExtrato(cfg, b.dataset.hist, b.dataset.nome));
    box.querySelector('#rel-imprimir').onclick = () => {
      const conteudo = `
        <div class="cp-sep"></div>
        ${lista.map((r) => `<div class="cp-row"><span>${UI().esc(r.nome)}</span><span>${UI().money(r[cfg.saldoCol])}</span></div>`).join('') || '<div class="cp-info">Sem cadastros.</div>'}
        <div class="cp-sep"></div>
        <div class="cp-row cp-total"><span>${cfg.totalLabel}</span><span>${UI().money(totalFiado)}</span></div>`;
      AGB.cupom.imprimirHTML(AGB.cupom.relatorio(cfg.titulo, UI().dataCurta(new Date().toISOString()), conteudo));
    };
  }

  // ---------------------- EXTRATO (cliente/fornecedor) ----------------
  // Conta-corrente no formato do "caderninho": saldo anterior + movimento
  // do período (vendas/compras com forma de pagamento) + créditos/abatimentos
  // = saldo final. Computado no cliente (1 entidade por vez = volume pequeno).
  async function abrirExtrato(cfg, id, nome) {
    const ehCliente = cfg.tipoEnt === 'cliente';
    const tPag = ehCliente ? 'pagamentos_venda' : 'pagamentos_compra';
    const movLabel = ehCliente ? 'Vendas' : 'Compras';
    const saldoLabel = ehCliente ? 'Saldo devedor' : 'Saldo a pagar';
    const per = periodoPadrao();

    const m = UI().openModal({ titulo: 'Extrato — ' + nome, largura: '620px', corpo: `
      <div class="filtros" style="margin-bottom:12px">
        <label class="campo"><span>De</span><input id="ex-ini" class="input" type="date" value="${per.ini}"/></label>
        <label class="campo"><span>Até</span><input id="ex-fim" class="input" type="date" value="${per.fim}"/></label>
        <div class="filtros-acoes">
          <button id="ex-gerar" class="btn btn-primary">Gerar</button>
          <button id="ex-imprimir" class="btn btn-ghost" disabled>🖨 Imprimir</button>
        </div>
      </div>
      <div id="ex-result"><div class="muted" style="padding:8px">Escolha o período e clique em Gerar.</div></div>` });

    let ultimo = null;

    async function gerar() {
      const f = { ini: m.body.querySelector('#ex-ini').value, fim: m.body.querySelector('#ex-fim').value };
      if (!f.ini || !f.fim) { UI().toast('Informe o período.', 'erro'); return; }
      const res = m.body.querySelector('#ex-result');
      res.innerHTML = `<div class="muted" style="padding:8px">Gerando extrato...</div>`;
      try {
        const r = await consultarExtrato(cfg, id, f, tPag);
        ultimo = { cfg, nome, f, r };
        renderExtrato(res, cfg, r, { movLabel, saldoLabel });
        m.body.querySelector('#ex-imprimir').disabled = false;
      } catch (err) { UI().erro('Falha ao gerar extrato', err); res.innerHTML = ''; }
    }

    m.body.querySelector('#ex-gerar').onclick = gerar;
    m.body.querySelector('#ex-imprimir').onclick = () => {
      if (ultimo) AGB.cupom.imprimirHTML(printExtrato(ultimo.cfg, ultimo.nome, ultimo.f, ultimo.r, { movLabel, saldoLabel }));
    };
    gerar();
  }

  async function consultarExtrato(cfg, id, f, tPag) {
    const db = UI().db();
    const pIni = isoStart(f.ini), pFimEx = isoEndExcl(f.fim);
    const r = (n) => Math.round((Number(n) || 0) * 100) / 100;

    // Tudo da entidade (pedidos + ajustes); pagamentos dos pedidos. Volume por
    // entidade é pequeno, então split por data acontece no cliente.
    const [pedRes, ajRes] = await Promise.all([
      db.from(cfg.ped).select('id,numero,data,total').eq(cfg.col, id).order('data', { ascending: true }),
      db.from('ajustes_saldo').select('data,tipo,valor,observacao').eq('tipo_entidade', cfg.tipoEnt).eq('entidade_id', id).order('data', { ascending: true })
    ]);
    if (pedRes.error) throw pedRes.error;
    if (ajRes.error) throw ajRes.error;
    const pedidos = pedRes.data || [];
    const ajustes = ajRes.data || [];

    // pagamentos de todos os pedidos da entidade
    const ids = pedidos.map((p) => p.id);
    let pags = [];
    if (ids.length) {
      const pgRes = await db.from(tPag).select('pedido_id,modalidade,valor').in('pedido_id', ids);
      if (pgRes.error) throw pgRes.error;
      pags = pgRes.data || [];
    }
    const dataDoPedido = {}; pedidos.forEach((p) => { dataDoPedido[p.id] = p.data; });
    const pagoPorPedido = {}; const formasPorPedido = {};
    pags.forEach((g) => {
      pagoPorPedido[g.pedido_id] = r((pagoPorPedido[g.pedido_id] || 0) + Number(g.valor));
      (formasPorPedido[g.pedido_id] = formasPorPedido[g.pedido_id] || new Set()).add(g.modalidade);
    });

    const antes = (d) => d < pIni;
    const dentro = (d) => d >= pIni && d < pFimEx;

    // ---- Saldo anterior (tudo antes do período) ----
    let saldoAnt = 0;
    pedidos.forEach((p) => { if (antes(p.data)) saldoAnt = r(saldoAnt + Number(p.total)); });
    pags.forEach((g) => { if (antes(dataDoPedido[g.pedido_id])) saldoAnt = r(saldoAnt - Number(g.valor)); });
    ajustes.forEach((a) => { if (antes(a.data)) saldoAnt = r(saldoAnt + (a.tipo === 'debito' ? Number(a.valor) : -Number(a.valor))); });

    // ---- Período: vendas/compras ----
    const mods = { dinheiro: 0, pix: 0, cartao: 0, boleto: 0 };
    const linhasPed = [];
    let totalMov = 0;
    pedidos.filter((p) => dentro(p.data)).forEach((p) => {
      const pago = pagoPorPedido[p.id] || 0;
      totalMov = r(totalMov + Number(p.total));
      linhasPed.push({
        numero: p.numero, data: p.data, total: Number(p.total), pago,
        formas: formasPorPedido[p.id] ? Array.from(formasPorPedido[p.id]).join('+') : ''
      });
    });
    pags.forEach((g) => { if (dentro(dataDoPedido[g.pedido_id]) && mods[g.modalidade] != null) mods[g.modalidade] = r(mods[g.modalidade] + Number(g.valor)); });
    const totalPago = r(mods.dinheiro + mods.pix + mods.cartao + mods.boleto);
    const parcial = r(totalMov - totalPago);

    // ---- Período: créditos / débitos (ajustes) ----
    const linhasCred = ajustes.filter((a) => dentro(a.data)).map((a) => ({ data: a.data, tipo: a.tipo, valor: Number(a.valor), observacao: a.observacao }));
    const totalCreditos = r(linhasCred.filter((a) => a.tipo === 'credito').reduce((s, a) => s + a.valor, 0));
    const totalDebitos = r(linhasCred.filter((a) => a.tipo === 'debito').reduce((s, a) => s + a.valor, 0));

    const saldoFinal = r(saldoAnt + totalMov - totalPago - totalCreditos + totalDebitos);

    return { saldoAnt, linhasPed, mods, totalMov, totalPago, parcial, linhasCred, totalCreditos, totalDebitos, saldoFinal, qtd: linhasPed.length };
  }

  function formaTxt(p) {
    if (!(p.pago > 0.005)) return 'Fiado';
    const lbl = p.formas.split('+').map((m) => MOD_LABEL[m] || m).join(' + ');
    return p.pago < p.total - 0.005 ? lbl + ' (parcial)' : lbl;
  }

  // Rótulo do saldo final conforme o sinal (positivo = deve; negativo = crédito).
  function saldoFinalLinha(saldoFinal, ehCliente) {
    if (saldoFinal > 0.005) return { lbl: ehCliente ? 'Saldo devedor' : 'Saldo a pagar', val: UI().money(saldoFinal), credito: false };
    if (saldoFinal < -0.005) return { lbl: 'Crédito a favor', val: UI().money(-saldoFinal), credito: true };
    return { lbl: ehCliente ? 'Em dia' : 'Quitado', val: UI().money(0), credito: false };
  }

  function renderExtrato(res, cfg, r, t) {
    const sf = saldoFinalLinha(r.saldoFinal, cfg.tipoEnt === 'cliente');
    const linhasPed = r.linhasPed.map((p) => `
      <tr><td>${p.numero}</td><td>${UI().dataCurta(p.data)}</td>
      <td>${UI().esc(formaTxt(p))}</td><td class="td-valor">${UI().money(p.total)}</td></tr>`).join('');
    const linhasCred = r.linhasCred.map((a) => `
      <div class="cp-row"><span>${UI().dataCurta(a.data)} · ${a.tipo === 'credito' ? 'Crédito' : 'Débito'}${a.observacao ? ' · ' + UI().esc(a.observacao) : ''}</span>
      <span class="${a.tipo === 'credito' ? 'saldo-credito' : 'cor-deve'}">${a.tipo === 'credito' ? '-' : '+'}${UI().money(a.valor)}</span></div>`).join('')
      || '<div class="empty-sm">Nenhum crédito/abatimento no período.</div>';

    res.innerHTML = `
      <div class="resumo-cards" style="margin-bottom:10px">
        <div class="resumo-card"><span>Saldo anterior</span><strong class="${r.saldoAnt > 0.005 ? 'cor-deve' : ''}">${UI().money(r.saldoAnt)}</strong></div>
        <div class="resumo-card"><span>${t.movLabel} (${r.qtd})</span><strong>${UI().money(r.totalMov)}</strong></div>
        <div class="resumo-card"><span>${sf.lbl}</span><strong class="${sf.credito ? 'saldo-credito' : (r.saldoFinal > 0.005 ? 'cor-deve' : '')}">${sf.val}</strong></div>
      </div>
      <section class="card bloco">
        <h3 class="bloco-titulo">${t.movLabel} no período</h3>
        ${r.qtd ? `<div class="cad-lista" style="box-shadow:none;border:none"><table class="tabela">
          <thead><tr><th>Nº</th><th>Data</th><th>Forma</th><th>Valor</th></tr></thead>
          <tbody>${linhasPed}</tbody></table></div>` : '<div class="empty-sm">Nenhum pedido no período.</div>'}
        <div class="cp-row mod-linha" style="margin-top:8px"><span>Dinheiro</span><span>${UI().money(r.mods.dinheiro)}</span></div>
        <div class="cp-row mod-linha"><span>Pix</span><span>${UI().money(r.mods.pix)}</span></div>
        <div class="cp-row mod-linha"><span>Cartão</span><span>${UI().money(r.mods.cartao)}</span></div>
        <div class="cp-row mod-linha"><span>Boleto</span><span>${UI().money(r.mods.boleto)}</span></div>
        <div class="cp-row mod-linha mod-aberto"><span>Parcial (fiado)</span><span>${UI().money(r.parcial)}</span></div>
        <div class="cp-row mod-total"><span>Total ${t.movLabel.toLowerCase()}</span><span>${UI().money(r.totalMov)}</span></div>
      </section>
      <section class="card bloco">
        <h3 class="bloco-titulo">Créditos / abatimentos</h3>
        ${linhasCred}
        <div class="cp-row mod-total" style="margin-top:6px"><span>Total créditos</span><span>${UI().money(r.totalCreditos)}</span></div>
      </section>
      <div class="cp-row mod-total" style="font-size:1.05rem;padding:10px 2px">
        <span>${sf.lbl}</span>
        <span class="${sf.credito ? 'saldo-credito' : (r.saldoFinal > 0.005 ? 'cor-deve' : '')}">${sf.val}</span>
      </div>`;
  }

  function printExtrato(cfg, nome, f, r, t) {
    const venLabel = t.movLabel.toUpperCase();
    const sf = saldoFinalLinha(r.saldoFinal, cfg.tipoEnt === 'cliente');
    const peds = r.linhasPed.map((p) => `
      <div class="cp-item"><div class="cp-item-calc"><span>#${p.numero} ${UI().dataCurta(p.data)}</span><span>${UI().money(p.total)}</span></div>
      <div class="cp-info">${UI().esc(formaTxt(p))}</div></div>`).join('') || '<div class="cp-info">Nenhum.</div>';
    const creds = r.linhasCred.map((a) => `
      <div class="cp-row"><span>${UI().dataCurta(a.data)} ${a.tipo === 'credito' ? 'créd.' : 'déb.'}${a.observacao ? ' ' + UI().esc(a.observacao) : ''}</span>
      <span>${a.tipo === 'credito' ? '-' : '+'}${UI().money(a.valor)}</span></div>`).join('') || '<div class="cp-info">Nenhum.</div>';
    const conteudo = `
      <div class="cp-info" style="text-align:center"><strong>${UI().esc(nome)}</strong></div>
      <div class="cp-info" style="text-align:center">Período ${UI().dataCurta(isoStart(f.ini))} a ${UI().dataCurta(isoStart(f.fim))}</div>
      <div class="cp-sep"></div>
      <div class="cp-row"><span>Saldo anterior</span><span>${UI().money(r.saldoAnt)}</span></div>
      <div class="cp-sep"></div>
      <div class="cp-sub">${venLabel}</div>
      ${peds}
      <div class="cp-sep"></div>
      <div class="cp-row"><span>Dinheiro</span><span>${UI().money(r.mods.dinheiro)}</span></div>
      <div class="cp-row"><span>Pix</span><span>${UI().money(r.mods.pix)}</span></div>
      <div class="cp-row"><span>Cartão</span><span>${UI().money(r.mods.cartao)}</span></div>
      <div class="cp-row"><span>Boleto</span><span>${UI().money(r.mods.boleto)}</span></div>
      <div class="cp-row"><span>Parcial (fiado)</span><span>${UI().money(r.parcial)}</span></div>
      <div class="cp-row cp-total"><span>TOTAL ${venLabel}</span><span>${UI().money(r.totalMov)}</span></div>
      <div class="cp-sep"></div>
      <div class="cp-sub">CRÉDITOS / ABATIMENTOS</div>
      ${creds}
      <div class="cp-row cp-total"><span>TOTAL CRÉDITOS</span><span>${UI().money(r.totalCreditos)}</span></div>
      <div class="cp-sep"></div>
      <div class="cp-row cp-total" style="font-size:1.1em"><span>${sf.lbl.toUpperCase()}</span><span>${sf.val}</span></div>`;
    return AGB.cupom.relatorio('EXTRATO — ' + (cfg.tipoEnt === 'cliente' ? 'CLIENTE' : 'FORNECEDOR'), '', conteudo);
  }

  // ============================ PRODUTOS ==============================
  async function telaProdutos() {
    const box = main.querySelector('#rel-conteudo');
    box.innerHTML = `<div class="muted" style="padding:18px">Apurando produtos mais vendidos...</div>`;
    // Apuração no SERVIDOR (RPC rel_produtos): top 30 por qtd e por valor sobre
    // TODOS os itens — antes baixava a tabela inteira e capava em 1000 itens.
    const { data, error } = await UI().db().rpc('rel_produtos', { p_limit: 30 });
    if (error) { UI().erro('Falha ao apurar produtos', error); return; }
    const norm = (x) => ({ nome: x.nome || '(produto removido)', unidade: x.unidade || '', qtd: Number(x.qtd) || 0, valor: Number(x.valor) || 0 });
    const porQtd = ((data && data.por_qtd) || []).map(norm);
    const porValor = ((data && data.por_valor) || []).map(norm);
    const totalProdutos = (data && data.total_produtos) || 0;

    const tabela = (rows, tipo) => rows.length ? `
      <table class="tabela"><thead><tr><th>#</th><th>Produto</th><th>${tipo === 'qtd' ? 'Qtd' : 'Valor'}</th></tr></thead>
      <tbody>${rows.map((r, i) => `<tr><td>${i + 1}</td><td class="td-nome">${UI().esc(r.nome)} <span class="muted">(${UI().esc(r.unidade)})</span></td>
        <td class="td-valor">${tipo === 'qtd' ? UI().qtd(r.qtd) : UI().money(r.valor)}</td></tr>`).join('')}</tbody></table>`
      : '<div class="empty-sm">Sem vendas registradas.</div>';

    box.innerHTML = `
      <div class="resumo-cards">
        <div class="resumo-card"><span>Produtos vendidos</span><strong>${totalProdutos}</strong></div>
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

  // ============================ BOLETOS ===============================
  // Agenda de vencimentos, com clientes (a receber) e fornecedores (a pagar)
  // bem separados. Lê os pagamentos modalidade=boleto que têm vencimento.
  async function telaBoletos() {
    const box = main.querySelector('#rel-conteudo');
    const hoje = new Date();
    const fim = new Date(hoje); fim.setDate(hoje.getDate() + 60);
    const per = { ini: fmtYMD(hoje), fim: fmtYMD(fim) };
    box.innerHTML = `
      <section class="card bloco">
        <div class="filtros">
          <label class="campo"><span>Vencimento de</span><input id="b-ini" class="input" type="date" value="${per.ini}"/></label>
          <label class="campo"><span>Até</span><input id="b-fim" class="input" type="date" value="${per.fim}"/></label>
          <div class="filtros-acoes">
            <button id="b-gerar" class="btn btn-primary">Gerar</button>
            <button id="b-imprimir" class="btn btn-ghost" disabled>🖨 Imprimir</button>
          </div>
        </div>
        <p class="muted" style="font-size:.8rem;margin:6px 2px 0">O padrão mostra os próximos 60 dias. Amplie o período para trás para ver vencidos.</p>
      </section>
      <div id="b-result"></div>`;

    let ultimo = null;
    const gerar = async () => {
      const f = { ini: box.querySelector('#b-ini').value, fim: box.querySelector('#b-fim').value };
      if (!f.ini || !f.fim) { UI().toast('Informe o período.', 'erro'); return; }
      const res = box.querySelector('#b-result');
      res.innerHTML = `<div class="muted" style="padding:18px">Carregando boletos...</div>`;
      try {
        ultimo = await consultarBoletos(f); ultimo.f = f;
        renderBoletos(res, ultimo);
        box.querySelector('#b-imprimir').disabled = false;
      } catch (err) { UI().erro('Falha ao carregar boletos', err); res.innerHTML = ''; }
    };
    box.querySelector('#b-gerar').onclick = gerar;
    box.querySelector('#b-imprimir').onclick = () => { if (ultimo) AGB.cupom.imprimirHTML(printBoletos(ultimo)); };
    gerar();
  }

  async function consultarBoletos(f) {
    const db = UI().db();
    const [recv, pay] = await Promise.all([
      db.from('pagamentos_venda').select('valor,vencimento,pedidos_venda(numero,clientes(nome))')
        .eq('modalidade', 'boleto').not('vencimento', 'is', null)
        .gte('vencimento', f.ini).lte('vencimento', f.fim)
        .order('vencimento', { ascending: true }).limit(500),
      db.from('pagamentos_compra').select('valor,vencimento,pedidos_compra(numero,fornecedores(nome))')
        .eq('modalidade', 'boleto').not('vencimento', 'is', null)
        .gte('vencimento', f.ini).lte('vencimento', f.fim)
        .order('vencimento', { ascending: true }).limit(500)
    ]);
    if (recv.error) throw recv.error;
    if (pay.error) throw pay.error;
    const receber = (recv.data || []).map((r) => ({
      vencimento: r.vencimento, valor: Number(r.valor),
      numero: r.pedidos_venda ? r.pedidos_venda.numero : null,
      nome: (r.pedidos_venda && r.pedidos_venda.clientes && r.pedidos_venda.clientes.nome) || 'Avulso'
    }));
    const pagar = (pay.data || []).map((r) => ({
      vencimento: r.vencimento, valor: Number(r.valor),
      numero: r.pedidos_compra ? r.pedidos_compra.numero : null,
      nome: (r.pedidos_compra && r.pedidos_compra.fornecedores && r.pedidos_compra.fornecedores.nome) || '—'
    }));
    return { receber, pagar };
  }

  function statusVenc(venc) {
    const hojeYMD = fmtYMD(new Date());
    if (venc < hojeYMD) return { cls: 'cor-deve', txt: 'Vencido' };
    if (venc === hojeYMD) return { cls: 'cor-deve', txt: 'Hoje' };
    return { cls: '', txt: 'A vencer' };
  }
  const somaBoletos = (rows) => rows.reduce((s, x) => s + x.valor, 0);

  function secaoBoletos(titulo, rows, tipoNome) {
    const total = somaBoletos(rows);
    const vencido = somaBoletos(rows.filter((r) => r.vencimento < fmtYMD(new Date())));
    const linhas = rows.map((r) => {
      const st = statusVenc(r.vencimento);
      return `<tr>
        <td>${UI().dataCurta(r.vencimento + 'T00:00:00')}</td>
        <td class="${st.cls}">${st.txt}</td>
        <td class="td-nome">${UI().esc(r.nome)}</td>
        <td>#${r.numero != null ? r.numero : '—'}</td>
        <td class="td-valor">${UI().money(r.valor)}</td>
      </tr>`;
    }).join('');
    return `<section class="card bloco">
      <h3 class="bloco-titulo">${titulo}</h3>
      ${rows.length ? `<div class="cad-lista" style="box-shadow:none;border:none"><table class="tabela">
        <thead><tr><th>Vencimento</th><th>Situação</th><th>${tipoNome}</th><th>Pedido</th><th>Valor</th></tr></thead>
        <tbody>${linhas}</tbody></table></div>
        <div class="cp-row mod-total"><span>Total${vencido > 0.005 ? ` · vencido ${UI().money(vencido)}` : ''}</span><span>${UI().money(total)}</span></div>`
        : '<div class="empty-sm">Nenhum boleto no período.</div>'}
    </section>`;
  }

  function renderBoletos(res, r) {
    res.innerHTML = `
      <div class="resumo-cards">
        <div class="resumo-card"><span>A receber (boletos)</span><strong class="${somaBoletos(r.receber) > 0.005 ? 'cor-deve' : ''}">${UI().money(somaBoletos(r.receber))}</strong></div>
        <div class="resumo-card"><span>A pagar (boletos)</span><strong class="${somaBoletos(r.pagar) > 0.005 ? 'cor-deve' : ''}">${UI().money(somaBoletos(r.pagar))}</strong></div>
      </div>
      ${secaoBoletos('📥 A receber — clientes', r.receber, 'Cliente')}
      ${secaoBoletos('📤 A pagar — fornecedores', r.pagar, 'Fornecedor')}`;
  }

  function printBoletos(r) {
    const linha = (x) => `<div class="cp-row"><span>${UI().dataCurta(x.vencimento + 'T00:00:00')} · ${UI().esc(x.nome)}</span><span>${UI().money(x.valor)}</span></div>`;
    const sub = `${UI().dataCurta(r.f.ini + 'T00:00:00')} a ${UI().dataCurta(r.f.fim + 'T00:00:00')}`;
    const conteudo = `
      <div class="cp-sep"></div>
      <div class="cp-sub">A RECEBER (CLIENTES)</div>
      ${r.receber.map(linha).join('') || '<div class="cp-info">Nenhum.</div>'}
      <div class="cp-row cp-total"><span>TOTAL A RECEBER</span><span>${UI().money(somaBoletos(r.receber))}</span></div>
      <div class="cp-sep"></div>
      <div class="cp-sub">A PAGAR (FORNECEDORES)</div>
      ${r.pagar.map(linha).join('') || '<div class="cp-info">Nenhum.</div>'}
      <div class="cp-row cp-total"><span>TOTAL A PAGAR</span><span>${UI().money(somaBoletos(r.pagar))}</span></div>`;
    return AGB.cupom.relatorio('BOLETOS A VENCER', sub, conteudo);
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
