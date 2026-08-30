/* =====================================================================
 * Agro Bras Hortifruti — Fechamento em boleto (semana do cliente)
 * ---------------------------------------------------------------------
 * O cliente leva a semana inteira no fiado; no fim da semana o dono
 * escolhe QUAIS vendas entram, escolhe a data de vencimento e fecha tudo
 * num boleto só. Cada venda escolhida recebe um pagamento 'boleto' no
 * valor que faltava — e o saldo do cliente zera pelos triggers do banco.
 *
 * Regras respeitadas:
 *  - o VALOR de cada boleto é calculado no SERVIDOR (RPC fechar_boleto);
 *    o app só manda quais vendas foram marcadas e a data escolhida.
 *  - saldo nunca é calculado aqui: só LEMOS o que a RPC devolve.
 *  - dá para somar vendas depois, trocar o vencimento de todos de uma vez
 *    e desfazer o fechamento inteiro (as vendas voltam a ficar em aberto).
 * ===================================================================== */
(function () {
  const UI = () => window.AGB.ui;

  let main = null;
  const estado = {
    aba: 'fechar',
    cliente_id: '',
    ini: '', fim: '',          // período das vendas (YYYY-MM-DD, fim inclusivo)
    marcadas: new Set(),       // ids das vendas escolhidas
    vendas: [],                // vendas em aberto carregadas
    resultado: null            // detalhe do último fechamento gravado
  };
  let cacheClientes = null;
  let clientesSujo = false;   // recarrega no próximo acesso (saldo pode ter mudado)

  // ---- Datas ---------------------------------------------------------
  const fmtYMD = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const isoStart = (ymd) => new Date(ymd + 'T00:00:00').toISOString();
  const isoEndExcl = (ymd) => { const d = new Date(ymd + 'T00:00:00'); d.setDate(d.getDate() + 1); return d.toISOString(); };
  const dataCurtaYMD = (ymd) => (ymd ? UI().dataCurta(ymd + 'T00:00:00') : '');

  // Segunda-feira da semana de `d` (semana comercial começa na segunda).
  function segundaDa(d) {
    const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const dow = (x.getDay() + 6) % 7;   // 0 = segunda
    x.setDate(x.getDate() - dow);
    return x;
  }
  function periodoSemana(offset) {
    const seg = segundaDa(new Date());
    seg.setDate(seg.getDate() + offset * 7);
    const dom = new Date(seg); dom.setDate(seg.getDate() + 6);
    return { ini: fmtYMD(seg), fim: fmtYMD(dom) };
  }
  function daquiA(dias) { const d = new Date(); d.setDate(d.getDate() + dias); return fmtYMD(d); }
  function proximaSexta() {
    const d = new Date();
    const faltam = (5 - d.getDay() + 7) % 7 || 7;   // sempre a PRÓXIMA sexta
    d.setDate(d.getDate() + faltam);
    return fmtYMD(d);
  }
  function fimDoMes() { const n = new Date(); return fmtYMD(new Date(n.getFullYear(), n.getMonth() + 1, 0)); }

  const arred = (n) => UI().arred(n);
  const somaMarcadas = () => arred(estado.vendas
    .filter((v) => estado.marcadas.has(v.id))
    .reduce((s, v) => s + Number(v.aberto), 0));

  function statusVenc(venc) {
    const hoje = fmtYMD(new Date());
    if (venc < hoje) return { cls: 'fc-vencido', txt: 'Vencido' };
    if (venc === hoje) return { cls: 'fc-vencido', txt: 'Vence hoje' };
    return { cls: 'fc-avencer', txt: 'A vencer' };
  }

  // ---- Shell ---------------------------------------------------------
  async function render(el) {
    main = el;
    main.innerHTML = `
      <nav class="subnav">
        <button class="subnav-tab${estado.aba === 'fechar' ? ' active' : ''}" data-aba="fechar">Fechar semana</button>
        <button class="subnav-tab${estado.aba === 'lista' ? ' active' : ''}" data-aba="lista">Fechamentos feitos</button>
      </nav>
      <div id="fc-conteudo"></div>`;
    main.querySelectorAll('.subnav-tab').forEach((b) =>
      b.onclick = () => { estado.aba = b.dataset.aba; render(main); });
    if (estado.aba === 'lista') return telaLista();
    if (estado.resultado) return telaOk();
    return telaFechar();
  }

  async function clientes() {
    if (cacheClientes && !clientesSujo) return cacheClientes;
    const { data, error } = await UI().db()
      .from('clientes').select('id,nome,saldo_devedor').order('nome');
    if (error) throw error;
    cacheClientes = data || [];
    clientesSujo = false;
    return cacheClientes;
  }

  // ===================== ABA 1: FECHAR A SEMANA ======================
  async function telaFechar() {
    const box = main.querySelector('#fc-conteudo');
    box.innerHTML = `<div class="muted" style="padding:18px">Carregando clientes...</div>`;
    let lista;
    try { lista = await clientes(); }
    catch (err) { UI().errorCard(box, 'Não foi possível carregar os clientes.', () => telaFechar()); return; }

    box.innerHTML = `
      <section class="card bloco">
        <h3 class="bloco-titulo">1. Cliente</h3>
        <div id="fc-cb-cliente"></div>
        <div id="fc-saldo" class="fc-saldo"></div>
      </section>

      <section class="card bloco" id="fc-periodo-card">
        <h3 class="bloco-titulo">2. Período das vendas</h3>
        <div class="fc-chips fc-chips-rolagem">
          <button class="fc-chip${estado.ini ? '' : ' ativo'}" data-per="tudo">Tudo em aberto</button>
          <button class="fc-chip" data-per="0">Esta semana</button>
          <button class="fc-chip" data-per="-1">Semana passada</button>
          <button class="fc-chip" data-per="15">Últimos 15 dias</button>
        </div>
        <details class="fc-datas"${estado.ini ? ' open' : ''}>
          <summary>Escolher as datas na mão</summary>
          <div class="grid2">
            <label class="campo"><span>De</span><input id="fc-ini" class="input" type="date" value="${estado.ini}"/></label>
            <label class="campo"><span>Até</span><input id="fc-fim" class="input" type="date" value="${estado.fim}"/></label>
          </div>
        </details>
      </section>

      <section class="card bloco">
        <div class="fc-lista-head">
          <h3 class="bloco-titulo" style="margin:0">3. Escolha as vendas</h3>
          <div class="fc-lista-acoes">
            <button id="fc-todas" class="btn btn-ghost btn-sm">Marcar todas</button>
            <button id="fc-nenhuma" class="btn btn-ghost btn-sm">Limpar</button>
          </div>
        </div>
        <div id="fc-vendas"><div class="empty-sm">Escolha um cliente para ver as vendas em aberto.</div></div>
      </section>

      <div class="fluxo-rodape fc-rodape">
        <div class="rodape-total"><span id="fc-qtd">0 vendas</span> · <strong id="fc-soma">${UI().money(0)}</strong></div>
        <button id="fc-fechar" class="btn btn-primary btn-grande" disabled>Fechar em boleto →</button>
      </div>`;

    UI().combobox(box.querySelector('#fc-cb-cliente'), {
      placeholder: 'Buscar cliente...',
      value: estado.cliente_id,
      items: lista.map((c) => ({ id: c.id, label: c.nome, sub: saldoTexto(c.saldo_devedor) })),
      onChange: (id) => { estado.cliente_id = id; estado.marcadas.clear(); mostrarSaldo(); carregarVendas(); }
    });

    box.querySelectorAll('.fc-chip').forEach((b) => b.onclick = () => {
      const p = b.dataset.per;
      if (p === 'tudo') { estado.ini = ''; estado.fim = ''; }
      else if (p === '15') { estado.ini = daquiA(-14); estado.fim = fmtYMD(new Date()); }
      else { const per = periodoSemana(Number(p)); estado.ini = per.ini; estado.fim = per.fim; }
      box.querySelector('#fc-ini').value = estado.ini;
      box.querySelector('#fc-fim').value = estado.fim;
      box.querySelectorAll('.fc-chip').forEach((x) => x.classList.toggle('ativo', x === b));
      carregarVendas();
    });
    box.querySelector('#fc-ini').onchange = (e) => { estado.ini = e.target.value; carregarVendas(); };
    box.querySelector('#fc-fim').onchange = (e) => { estado.fim = e.target.value; carregarVendas(); };
    box.querySelector('#fc-todas').onclick = () => {
      estado.vendas.forEach((v) => estado.marcadas.add(v.id)); renderVendas(); };
    box.querySelector('#fc-nenhuma').onclick = () => { estado.marcadas.clear(); renderVendas(); };
    box.querySelector('#fc-fechar').onclick = abrirVencimento;

    mostrarSaldo();
    if (estado.cliente_id) carregarVendas();
  }

  function clienteAtual() {
    return (cacheClientes || []).find((c) => c.id === estado.cliente_id) || null;
  }
  function saldoTexto(v) {
    const n = Number(v) || 0;
    if (Math.abs(n) < 0.005) return 'Em dia';
    return n > 0 ? 'Deve ' + UI().money(n) : 'Crédito ' + UI().money(-n);
  }
  function mostrarSaldo() {
    const el = main.querySelector('#fc-saldo');
    if (!el) return;
    const c = clienteAtual();
    el.innerHTML = c
      ? `Saldo atual de <strong>${UI().esc(c.nome)}</strong>: ${saldoBadge(c.saldo_devedor)}`
      : '';
  }
  function saldoBadge(v) {
    v = Number(v) || 0;
    if (Math.abs(v) < 0.005) return '<span class="saldo saldo-zero">Em dia</span>';
    if (v > 0) return `<span class="saldo saldo-deve">Deve ${UI().money(v)}</span>`;
    return `<span class="saldo saldo-credito">Crédito ${UI().money(-v)}</span>`;
  }

  async function carregarVendas() {
    const box = main.querySelector('#fc-vendas');
    if (!box) return;
    if (!estado.cliente_id) {
      estado.vendas = []; box.innerHTML = '<div class="empty-sm">Escolha um cliente para ver as vendas em aberto.</div>';
      atualizarRodape(); return;
    }
    box.innerHTML = `<div class="muted" style="padding:12px 0">Carregando vendas...</div>`;
    try {
      const { data, error } = await UI().db().rpc('vendas_em_aberto', {
        p_cliente: estado.cliente_id,
        p_ini: estado.ini ? isoStart(estado.ini) : null,
        p_fim: estado.fim ? isoEndExcl(estado.fim) : null,
        p_limit: 400
      });
      if (error) throw error;
      estado.vendas = (data || []).map((v) => ({
        id: v.id, numero: v.numero, data: v.data,
        total: Number(v.total), pago: Number(v.pago), aberto: Number(v.aberto),
        observacao: v.observacao || ''
      }));
      // mantém marcadas só as que continuam na lista
      const ids = new Set(estado.vendas.map((v) => v.id));
      [...estado.marcadas].forEach((id) => { if (!ids.has(id)) estado.marcadas.delete(id); });
      renderVendas();
    } catch (err) {
      UI().erro('Não foi possível carregar as vendas em aberto', err);
      box.innerHTML = '<div class="empty-sm">Falha ao carregar. Tente de novo.</div>';
    }
  }

  function renderVendas() {
    const box = main.querySelector('#fc-vendas');
    if (!box) return;
    if (!estado.vendas.length) {
      box.innerHTML = '<div class="empty-sm">Nenhuma venda em aberto nesse período. Esse cliente está em dia.</div>';
      atualizarRodape(); return;
    }
    box.innerHTML = estado.vendas.map((v) => {
      const marcada = estado.marcadas.has(v.id);
      const parcial = v.pago > 0.005;
      return `
        <button type="button" class="fc-venda${marcada ? ' marcada' : ''}" data-id="${v.id}" aria-pressed="${marcada}">
          <span class="fc-check" aria-hidden="true">${marcada ? '✓' : ''}</span>
          <span class="fc-venda-info">
            <span class="fc-venda-top">Venda nº ${v.numero} <span class="fc-venda-data">${UI().dataCurta(v.data)}</span></span>
            <span class="fc-venda-sub">${parcial
              ? `total ${UI().money(v.total)} · já pago ${UI().money(v.pago)}`
              : UI().esc(v.observacao) || 'em aberto'}</span>
          </span>
          <span class="fc-venda-valor">${UI().money(v.aberto)}</span>
        </button>`;
    }).join('');
    box.querySelectorAll('.fc-venda').forEach((b) => b.onclick = () => {
      const id = b.dataset.id;
      if (estado.marcadas.has(id)) estado.marcadas.delete(id); else estado.marcadas.add(id);
      b.classList.toggle('marcada');
      b.setAttribute('aria-pressed', estado.marcadas.has(id) ? 'true' : 'false');
      b.querySelector('.fc-check').textContent = estado.marcadas.has(id) ? '✓' : '';
      atualizarRodape();
    });
    atualizarRodape();
  }

  function atualizarRodape() {
    const q = main.querySelector('#fc-qtd');
    const s = main.querySelector('#fc-soma');
    const b = main.querySelector('#fc-fechar');
    if (!q || !s || !b) return;
    const n = estado.marcadas.size;
    q.textContent = n === 1 ? '1 venda' : n + ' vendas';
    s.textContent = UI().money(somaMarcadas());
    b.disabled = n === 0;
  }

  // ---- Passo final: vencimento --------------------------------------
  function abrirVencimento() {
    if (!estado.marcadas.size) return;
    const c = clienteAtual();
    const m = UI().openModal({
      titulo: 'Vencimento do boleto', largura: '440px',
      corpo: `
        <div class="fc-resumo-modal">
          <div class="cp-row"><span>Cliente</span><strong>${UI().esc(c ? c.nome : '—')}</strong></div>
          <div class="cp-row"><span>Vendas escolhidas</span><strong>${estado.marcadas.size}</strong></div>
          <div class="cp-row fc-resumo-total"><span>Total do boleto</span><strong>${UI().money(somaMarcadas())}</strong></div>
        </div>
        <label class="campo" style="margin-top:14px"><span>Vence em *</span>
          <input id="fc-venc" class="input" type="date" value="${proximaSexta()}"/></label>
        <div class="fc-chips">
          <button type="button" class="fc-chip" data-venc="${daquiA(7)}">+7 dias</button>
          <button type="button" class="fc-chip" data-venc="${daquiA(15)}">+15 dias</button>
          <button type="button" class="fc-chip" data-venc="${proximaSexta()}">Próxima sexta</button>
          <button type="button" class="fc-chip" data-venc="${fimDoMes()}">Fim do mês</button>
        </div>
        <label class="campo" style="margin-top:12px"><span>Observação</span>
          <input id="fc-obs" class="input" type="text" placeholder="ex.: semana 01/09 a 06/09"/></label>
        <div class="form-actions">
          <button class="btn btn-ghost" data-x>Cancelar</button>
          <button class="btn btn-primary" data-ok>Gerar boleto</button>
        </div>`
    });
    const venc = m.body.querySelector('#fc-venc');
    m.body.querySelectorAll('.fc-chip').forEach((b) => b.onclick = () => {
      venc.value = b.dataset.venc;
      m.body.querySelectorAll('.fc-chip').forEach((x) => x.classList.toggle('ativo', x === b));
    });
    m.body.querySelector('[data-x]').onclick = () => m.close();
    const ok = m.body.querySelector('[data-ok]');
    ok.onclick = async () => {
      if (!venc.value) { UI().toast('Escolha a data de vencimento.', 'erro'); return; }
      ok.disabled = true;
      try {
        const { data, error } = await UI().db().rpc('fechar_boleto', {
          p_cliente_id: estado.cliente_id,
          p_vencimento: venc.value,
          p_pedidos: [...estado.marcadas],
          p_observacao: m.body.querySelector('#fc-obs').value.trim() || null
        });
        if (error) throw error;
        m.close();
        const c2 = clienteAtual();
        if (c2 && data.saldo != null) c2.saldo_devedor = Number(data.saldo);
        estado.resultado = await carregarDetalhe(data.id);
        estado.marcadas.clear();
        render(main);
      } catch (err) { UI().erro('Não foi possível fechar o boleto', err); ok.disabled = false; }
    };
  }

  async function carregarDetalhe(id) {
    const { data, error } = await UI().db().rpc('fechamento_detalhe', { p_id: id });
    if (error) throw error;
    return data;
  }

  // ---- Confirmação ---------------------------------------------------
  function telaOk() {
    const d = estado.resultado;
    const box = main.querySelector('#fc-conteudo');
    box.innerHTML = `
      <div class="fluxo">
        <div class="ok-box card">
          <div class="ok-check">✓</div>
          <h2>Fechamento nº ${d.numero}</h2>
          <div class="ok-total">${UI().money(d.total)}</div>
          <div class="ok-detalhes">
            <div class="cp-row"><span>Cliente</span><span>${UI().esc(d.cliente || '—')}</span></div>
            <div class="cp-row"><span>Vencimento</span><span><strong>${dataCurtaYMD(d.vencimento)}</strong></span></div>
            <div class="cp-row"><span>Vendas no boleto</span><span>${(d.vendas || []).length}</span></div>
            <div class="cp-row cp-saldo"><span>Saldo do cliente agora</span><span>${saldoBadge(d.saldo)}</span></div>
          </div>
          <div class="ok-acoes">
            <button id="fc-imprimir" class="btn btn-primary btn-grande">🖨 Imprimir boleto</button>
            <button id="fc-novo" class="btn btn-ghost btn-grande">Novo fechamento</button>
          </div>
        </div>
      </div>`;
    box.querySelector('#fc-imprimir').onclick = () => imprimir(d);
    box.querySelector('#fc-novo').onclick = () => { estado.resultado = null; render(main); };
  }

  // ---- Cupom 80mm ----------------------------------------------------
  function imprimir(d) {
    const linhas = (d.vendas || []).map((v) => `
      <div class="cp-row"><span>Nº ${v.numero} · ${UI().dataCurta(v.data)}</span><span>${UI().money(v.valor)}</span></div>`).join('');
    const conteudo = `
      <div class="cp-meta">
        <div class="cp-row"><span>Nº</span><span>${d.numero}</span></div>
        <div class="cp-row"><span>Cliente</span><span>${UI().esc(d.cliente || '—')}</span></div>
        <div class="cp-row"><span>Emissão</span><span>${UI().dataCurta(d.criado_em)}</span></div>
        <div class="cp-row"><span>Vencimento</span><span>${dataCurtaYMD(d.vencimento)}</span></div>
      </div>
      <div class="cp-sep"></div>
      <div class="cp-sub">Vendas incluídas</div>
      ${linhas || '<div class="cp-info">Nenhuma.</div>'}
      <div class="cp-sep"></div>
      <div class="cp-row cp-total"><span>TOTAL DO BOLETO</span><span>${UI().money(d.total)}</span></div>
      <div class="cp-row cp-saldo"><span>Saldo restante</span><span>${saldoTexto(d.saldo)}</span></div>
      ${d.observacao ? `<div class="cp-sep"></div><div class="cp-obs"><strong>Obs:</strong> ${UI().esc(d.observacao)}</div>` : ''}`;
    AGB.cupom.imprimirHTML(AGB.cupom.relatorio('FECHAMENTO EM BOLETO',
      'vence em ' + dataCurtaYMD(d.vencimento), conteudo));
  }

  // ===================== ABA 2: FECHAMENTOS FEITOS ===================
  async function telaLista() {
    const box = main.querySelector('#fc-conteudo');
    box.innerHTML = `
      <section class="card bloco">
        <div class="grid2">
          <label class="campo"><span>Vencimento de</span><input id="fl-ini" class="input" type="date" value="${daquiA(-60)}"/></label>
          <label class="campo"><span>Até</span><input id="fl-fim" class="input" type="date" value="${daquiA(60)}"/></label>
        </div>
        <div class="filtros-acoes"><button id="fl-gerar" class="btn btn-primary">Buscar</button></div>
      </section>
      <div id="fl-result"><div class="muted" style="padding:14px">Carregando...</div></div>`;
    const buscar = async () => {
      const res = box.querySelector('#fl-result');
      res.innerHTML = `<div class="muted" style="padding:14px">Carregando...</div>`;
      try {
        const { data, error } = await UI().db().rpc('listar_fechamentos', {
          p_cliente: null,
          p_ini: box.querySelector('#fl-ini').value || null,
          p_fim: box.querySelector('#fl-fim').value || null,
          p_limit: 100
        });
        if (error) throw error;
        renderLista(res, data || []);
      } catch (err) {
        UI().errorCard(res, 'Não foi possível carregar os fechamentos.', buscar);
      }
    };
    box.querySelector('#fl-gerar').onclick = buscar;
    buscar();
  }

  function renderLista(res, linhas) {
    if (!linhas.length) {
      res.innerHTML = '<div class="card bloco"><div class="empty-sm">Nenhum fechamento nesse período.</div></div>';
      return;
    }
    const total = linhas.reduce((s, f) => s + Number(f.total), 0);
    res.innerHTML = `
      <div class="resumo-cards">
        <div class="resumo-card"><span>Fechamentos</span><strong>${linhas.length}</strong></div>
        <div class="resumo-card"><span>Total em boletos</span><strong>${UI().money(total)}</strong></div>
      </div>
      <div class="fc-fechs">
        ${linhas.map((f) => {
          const st = statusVenc(f.vencimento);
          return `<button type="button" class="fc-fech" data-id="${f.id}">
            <span class="fc-fech-l">
              <span class="fc-fech-top">Nº ${f.numero} · ${UI().esc(f.cliente || '—')}</span>
              <span class="fc-fech-sub">${f.qtd} venda${Number(f.qtd) === 1 ? '' : 's'} · vence ${dataCurtaYMD(f.vencimento)}
                <span class="fc-tag ${st.cls}">${st.txt}</span></span>
            </span>
            <span class="fc-fech-v">${UI().money(f.total)}</span>
          </button>`;
        }).join('')}
      </div>`;
    res.querySelectorAll('.fc-fech').forEach((b) => b.onclick = () => abrirDetalhe(b.dataset.id, res));
  }

  async function abrirDetalhe(id, res) {
    let d;
    try { d = await carregarDetalhe(id); }
    catch (err) { UI().erro('Não foi possível abrir o fechamento', err); return; }
    if (!d) { UI().toast('Fechamento não encontrado.', 'erro'); return; }
    const dono = AGB.isDono();
    const m = UI().openModal({
      titulo: `Fechamento nº ${d.numero}`, largura: '480px',
      corpo: `
        <div class="fc-resumo-modal">
          <div class="cp-row"><span>Cliente</span><strong>${UI().esc(d.cliente || '—')}</strong></div>
          <div class="cp-row"><span>Vencimento</span><strong>${dataCurtaYMD(d.vencimento)}</strong></div>
          <div class="cp-row fc-resumo-total"><span>Total</span><strong>${UI().money(d.total)}</strong></div>
        </div>
        ${d.observacao ? `<p class="muted" style="margin:10px 0 0">${UI().esc(d.observacao)}</p>` : ''}
        <div class="hist-titulo" style="margin-top:14px">Vendas no boleto</div>
        <div class="fc-det-vendas">
          ${(d.vendas || []).map((v) => `<div class="hist-linha">
            <span>Nº ${v.numero} · ${UI().dataCurta(v.data)}</span>
            <span>${UI().money(v.valor)}</span></div>`).join('') || '<div class="empty-sm">Sem vendas.</div>'}
        </div>
        <div class="fc-det-acoes">
          <button class="btn btn-primary" data-print>🖨 Imprimir</button>
          ${dono ? `<button class="btn btn-ghost" data-venc>📅 Trocar vencimento</button>
          <button class="btn btn-ghost" data-add>➕ Somar vendas</button>
          <button class="btn btn-danger-soft" data-del>🗑 Desfazer</button>` : ''}
        </div>`
    });
    m.body.querySelector('[data-print]').onclick = () => imprimir(d);
    const bVenc = m.body.querySelector('[data-venc]');
    if (bVenc) bVenc.onclick = () => trocarVencimento(d, m, res);
    const bAdd = m.body.querySelector('[data-add]');
    if (bAdd) bAdd.onclick = () => somarVendas(d, m, res);
    const bDel = m.body.querySelector('[data-del]');
    if (bDel) bDel.onclick = async () => {
      const ok = await UI().confirm(
        `Desfazer o fechamento nº ${d.numero}?\n\nOs boletos somem e as ${(d.vendas || []).length} vendas voltam a ficar em aberto no saldo do cliente.`,
        { okLabel: 'Desfazer fechamento', perigo: true });
      if (!ok) return;
      try {
        const { error } = await UI().db().rpc('cancelar_fechamento', { p_id: d.id });
        if (error) throw error;
        clientesSujo = true;
        m.close();
        UI().toast('Fechamento desfeito.');
        telaLista();
      } catch (err) { UI().erro('Não foi possível desfazer', err); }
    };
  }

  function trocarVencimento(d, modal, res) {
    const m = UI().openModal({
      titulo: 'Trocar vencimento', largura: '380px',
      corpo: `
        <p class="muted" style="margin-top:0">Muda a data de todos os ${(d.vendas || []).length} boletos deste fechamento.</p>
        <label class="campo"><span>Novo vencimento</span>
          <input id="tv-venc" class="input" type="date" value="${d.vencimento}"/></label>
        <div class="fc-chips">
          <button type="button" class="fc-chip" data-venc="${daquiA(7)}">+7 dias</button>
          <button type="button" class="fc-chip" data-venc="${proximaSexta()}">Próxima sexta</button>
          <button type="button" class="fc-chip" data-venc="${fimDoMes()}">Fim do mês</button>
        </div>
        <div class="form-actions">
          <button class="btn btn-ghost" data-x>Cancelar</button>
          <button class="btn btn-primary" data-ok>Salvar</button>
        </div>`
    });
    const inp = m.body.querySelector('#tv-venc');
    m.body.querySelectorAll('.fc-chip').forEach((b) => b.onclick = () => { inp.value = b.dataset.venc; });
    m.body.querySelector('[data-x]').onclick = () => m.close();
    m.body.querySelector('[data-ok]').onclick = async () => {
      if (!inp.value) { UI().toast('Escolha a data.', 'erro'); return; }
      try {
        const { error } = await UI().db().rpc('atualizar_fechamento', {
          p_id: d.id, p_vencimento: inp.value, p_observacao: null
        });
        if (error) throw error;
        m.close(); modal.close();
        UI().toast('Vencimento atualizado.');
        telaLista();
      } catch (err) { UI().erro('Não foi possível trocar o vencimento', err); }
    };
  }

  // Soma ao boleto existente as vendas que ficaram de fora (ou entraram depois).
  async function somarVendas(d, modal, res) {
    const m = UI().openModal({
      titulo: 'Somar vendas ao boleto', largura: '480px',
      corpo: `<div id="sv-lista"><div class="muted">Carregando vendas em aberto...</div></div>
        <div class="form-actions">
          <button class="btn btn-ghost" data-x>Cancelar</button>
          <button class="btn btn-primary" data-ok disabled>Somar ao boleto</button>
        </div>`
    });
    const btnOk = m.body.querySelector('[data-ok]');
    m.body.querySelector('[data-x]').onclick = () => m.close();
    const escolhidas = new Set();
    let abertas = [];
    try {
      const { data, error } = await UI().db().rpc('vendas_em_aberto', {
        p_cliente: d.cliente_id, p_ini: null, p_fim: null, p_limit: 400
      });
      if (error) throw error;
      abertas = data || [];
    } catch (err) { UI().erro('Falha ao carregar vendas', err); return; }

    const lista = m.body.querySelector('#sv-lista');
    if (!abertas.length) {
      lista.innerHTML = '<div class="empty-sm">Esse cliente não tem venda em aberto para somar.</div>';
      return;
    }
    lista.innerHTML = abertas.map((v) => `
      <button type="button" class="fc-venda" data-id="${v.id}">
        <span class="fc-check" aria-hidden="true"></span>
        <span class="fc-venda-info">
          <span class="fc-venda-top">Venda nº ${v.numero} <span class="fc-venda-data">${UI().dataCurta(v.data)}</span></span>
        </span>
        <span class="fc-venda-valor">${UI().money(v.aberto)}</span>
      </button>`).join('');
    lista.querySelectorAll('.fc-venda').forEach((b) => b.onclick = () => {
      const id = b.dataset.id;
      if (escolhidas.has(id)) escolhidas.delete(id); else escolhidas.add(id);
      b.classList.toggle('marcada');
      b.querySelector('.fc-check').textContent = escolhidas.has(id) ? '✓' : '';
      btnOk.disabled = escolhidas.size === 0;
    });
    btnOk.onclick = async () => {
      btnOk.disabled = true;
      try {
        const { error } = await UI().db().rpc('adicionar_ao_fechamento', {
          p_id: d.id, p_pedidos: [...escolhidas]
        });
        if (error) throw error;
        clientesSujo = true;
        m.close(); modal.close();
        UI().toast('Vendas somadas ao boleto.');
        telaLista();
      } catch (err) { UI().erro('Não foi possível somar as vendas', err); btnOk.disabled = false; }
    };
  }

  // Recarrega clientes/saldos ao reentrar na tela.
  window.addEventListener('hashchange', () => {
    if ((location.hash || '').includes('fechamento')) clientesSujo = true;
  });

  window.AGB.fechamento = {
    // Atalho a partir da tela do cliente/venda: já abre com o cliente escolhido.
    abrirPara: (clienteId) => {
      estado.aba = 'fechar';
      estado.resultado = null;
      estado.cliente_id = clienteId || '';
      estado.marcadas.clear();
      clientesSujo = true;
      if ((location.hash || '').includes('fechamento')) render(main);
      else location.hash = '#/fechamento';
    }
  };

  window.AGB.registerView('fechamento', render);
})();
