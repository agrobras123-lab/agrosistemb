/* =====================================================================
 * Agro Bras Hortifruti — Compras (Etapa 3)
 * Espelho de Vendas, trocando cliente por fornecedor.
 * Fluxo: vendedor (quem registra) → fornecedor → itens → observação →
 *        pagamento (distribuição livre) → confirma → cupom 80mm "COMPRA".
 *
 * Mesmas regras de Vendas:
 *  - numero do pedido vem da sequência do Postgres (lemos o retorno).
 *  - valor do item = quantidade * preco_unit (gravado); total por trigger.
 *  - pagamento misto em pagamentos_compra.
 *  - "parcial em aberto" = total - soma(pagamentos); vira saldo_aberto via trigger.
 *  - saldo: só LEMOS o saldo_aberto atualizado depois de gravar.
 * (Compra sempre tem fornecedor — não há "avulso" como na venda.)
 * ===================================================================== */
(function () {
  const UI = () => window.AGB.ui;
  // Constantes/helpers compartilhados com Vendas vivem em ui.js.
  const MOD_ORDEM = UI().MOD_ORDEM;
  const MOD_LABEL = UI().MOD_LABEL;

  const COMP_KEY = 'agb_comprador'; // lembra o último comprador (vendedor) da sessão

  let main = null;
  let cache = { vendedores: [], fornecedores: [], produtos: [] };
  let compra = null;
  let cbFornecedor = null;
  let cbProduto = null;
  let gravando = false;  // trava anti-duplo-envio

  // Texto curto de saldo (para o subtítulo do combobox de fornecedor)
  function saldoTexto(v) {
    const n = Number(v) || 0;
    if (Math.abs(n) < 0.005) return 'Em dia';
    return n > 0 ? 'Em aberto ' + UI().money(n) : 'Crédito ' + UI().money(-n);
  }

  function novaCompra() {
    compra = {
      step: 'montar',
      editId: null,
      editNumero: null,
      editUpdatedAt: null,     // atualizado_em lido ao abrir (trava otimista leve)
      vendedor_id: sessionStorage.getItem(COMP_KEY) || '',  // lembra o comprador
      fornecedor_id: '',
      itens: [],
      observacao: '',
      formaPg: '',
      pagamentos: { dinheiro: 0, pix: 0, cartao: 0, boleto: 0 },
      boletoVenc: '',
      resultado: null
    };
  }

  const arred = UI().arred;
  const totalItens = () => arred(compra.itens.reduce((s, i) => s + i.quantidade * i.preco_unit, 0));
  const totalPago  = () => arred(MOD_ORDEM.reduce((s, m) => s + (Number(compra.pagamentos[m]) || 0), 0));

  // ---- Entrada -------------------------------------------------------
  async function render(el) {
    main = el;
    if (!compra) novaCompra();
    main.innerHTML = `<div class="muted" style="padding:18px">Carregando...</div>`;
    if (!cache.carregado) {
      const db = UI().db();
      const [v, f, p] = await Promise.all([
        db.from('vendedores').select('id,nome').eq('ativo', true).order('nome'),
        db.from('fornecedores').select('id,nome,saldo_aberto').order('nome'),
        db.from('produtos').select('id,codigo,nome,unidade').eq('ativo', true).order('nome')
      ]);
      if (v.error || f.error || p.error) {
        UI().erro('Falha ao carregar dados de compra', v.error || f.error || p.error);
        return;
      }
      cache = { vendedores: v.data || [], fornecedores: f.data || [], produtos: p.data || [], carregado: true };
    }
    if (compra.vendedor_id && !cache.vendedores.some((v) => v.id === compra.vendedor_id)) {
      compra.vendedor_id = '';
      sessionStorage.removeItem(COMP_KEY);
    }
    pintar();
  }

  function pintar() {
    if (compra.step === 'montar') return pintarMontar();
    if (compra.step === 'pagamento') return pintarPagamento();
    if (compra.step === 'ok') return pintarOk();
  }

  // ===================== PASSO 1: MONTAR =============================
  function pintarMontar() {
    const forn = fornecedorAtual();
    const totalAPagar = cache.fornecedores.reduce((s, f) => s + Math.max(0, Number(f.saldo_aberto) || 0), 0);
    main.innerHTML = `
      <div class="fluxo">
        ${totalAPagar > 0 ? `<div class="dk-apagar"><i data-lucide="receipt"></i><div><div class="dk-apagar-lbl">A pagar (fornecedores)</div><div class="dk-apagar-val num">${UI().money(totalAPagar)}</div></div></div>` : ''}
        <div class="acoes-topo">
          <button id="btn-buscar" class="btn btn-outline-verde btn-acao-topo">🔍 Buscar / editar compra <kbd>F3</kbd></button>
          <button id="btn-reimprimir" class="btn btn-outline-verde btn-acao-topo">🖨 Reimprimir cupom <kbd>F7</kbd></button>
        </div>
        ${compra.editId ? `<div class="fluxo-top">
          <span class="edit-flag">✎ Editando compra nº ${compra.editNumero}</span>
          <button id="btn-cancelar-edit" class="btn btn-ghost btn-sm">Cancelar edição</button>
          <button id="btn-excluir-edit" class="btn btn-sm" style="color:var(--erro);border:1px solid var(--erro)">🗑 Excluir esta compra</button>
        </div>` : ''}
        <div class="fluxo-head">
          <h2>${compra.editId ? 'Editar compra' : 'Nova compra'}</h2>
          ${etapasHTML(1)}
        </div>

        <section class="card bloco">
          <div class="grid2">
            <label class="campo"><span>Comprador *</span>
              <select id="sel-vendedor" class="input">
                <option value="">Selecione...</option>
                ${cache.vendedores.map((v) => `<option value="${v.id}" ${v.id === compra.vendedor_id ? 'selected' : ''}>${UI().esc(v.nome)}</option>`).join('')}
              </select>
            </label>
            <label class="campo"><span>Fornecedor *</span>
              <div id="cb-fornecedor"></div>
            </label>
          </div>
          <div class="saldo-inline" id="saldo-inline">${forn ? `Saldo em aberto atual: ${saldoBadge(forn.saldo_aberto)}` : ''}</div>
          ${cache.fornecedores.length ? '' : '<p class="aviso">Nenhum fornecedor cadastrado. Cadastre em <strong>Cadastros → Fornecedores</strong>.</p>'}
        </section>

        <section class="card bloco">
          <h3 class="bloco-titulo">Itens</h3>
          <div class="item-add">
            <div id="cb-produto"></div>
            <input id="it-qtd" class="input" type="number" step="0.001" min="0" inputmode="decimal" placeholder="Qtd" />
            <input id="it-preco" class="input" type="number" step="0.01" min="0" inputmode="decimal" placeholder="Preço un." />
            <button id="it-add" class="btn btn-primary">Adicionar</button>
          </div>
          ${cache.produtos.length ? '' : '<p class="aviso">Nenhum produto ativo. Cadastre em <strong>Cadastros → Produtos</strong>.</p>'}
          <div id="itens-lista" class="itens-lista"></div>
        </section>

        <section class="card bloco">
          <label class="campo"><span>Observação</span>
            <textarea id="obs" rows="2" placeholder="opcional">${UI().esc(compra.observacao)}</textarea></label>
        </section>

        <div class="fluxo-rodape">
          <div class="rodape-total">Total: <strong>${UI().money(totalItens())}</strong></div>
          <button id="ir-pagamento" class="btn btn-primary btn-grande">Pagamento → <kbd>Enter</kbd></button>
        </div>
      </div>`;

    const selVend = main.querySelector('#sel-vendedor');
    selVend.onchange = (e) => {
      compra.vendedor_id = e.target.value;
      if (compra.vendedor_id) sessionStorage.setItem(COMP_KEY, compra.vendedor_id);
      else sessionStorage.removeItem(COMP_KEY);
    };
    selVend.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); cbFornecedor && cbFornecedor.focus(); } };

    cbFornecedor = UI().combobox(main.querySelector('#cb-fornecedor'), {
      placeholder: 'Buscar fornecedor...',
      value: compra.fornecedor_id,
      items: cache.fornecedores.map((f) => ({ id: f.id, label: f.nome, sub: saldoTexto(f.saldo_aberto) })),
      onChange: (id) => {
        compra.fornecedor_id = id;
        const sl = main.querySelector('#saldo-inline');
        const f = fornecedorAtual();
        if (sl) sl.innerHTML = f ? 'Saldo em aberto atual: ' + saldoBadge(f.saldo_aberto) : '';
        if (cbProduto) cbProduto.focus();
      }
    });

    cbProduto = UI().combobox(main.querySelector('#cb-produto'), {
      placeholder: 'Buscar produto por nome ou código...',
      items: cache.produtos.map((p) => ({
        id: p.id, label: p.nome, sub: p.unidade, code: p.codigo
      })),
      // Ao escolher o produto, pula direto para a quantidade (agiliza a compra).
      onChange: () => { const q = main.querySelector('#it-qtd'); if (q) q.focus(); },
      onEnterEmpty: irParaPagamento
    });

    main.querySelector('#it-add').onclick = adicionarItem;
    main.querySelector('#it-qtd').onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); main.querySelector('#it-preco').focus(); } };
    main.querySelector('#it-preco').onkeydown = (e) => { if (e.key === 'Enter') adicionarItem(); };
    main.querySelector('#obs').oninput = (e) => { compra.observacao = e.target.value; };
    main.querySelector('#ir-pagamento').onclick = irParaPagamento;
    main.querySelector('#btn-buscar').onclick = () => abrirBusca('editar');
    main.querySelector('#btn-reimprimir').onclick = () => abrirBusca('reimprimir');
    const cancEdit = main.querySelector('#btn-cancelar-edit');
    if (cancEdit) cancEdit.onclick = () => { novaCompra(); pintar(); };
    const btnExcluirEdit = main.querySelector('#btn-excluir-edit');
    if (btnExcluirEdit) btnExcluirEdit.onclick = () => excluirCompra(compra.editId, compra.editNumero, null);
    renderItens();
    if (window.AGB && AGB.refreshIcons) AGB.refreshIcons();

    setTimeout(() => {
      if (!compra.vendedor_id) selVend.focus();
      else if (!compra.fornecedor_id && cbFornecedor) cbFornecedor.focus();
      else if (cbProduto) cbProduto.focus();
    }, 30);
  }

  // ---- Busca / edição / reimpressão ---------------------------------
  function abrirBusca(modo) {
    modo = modo || 'editar';
    const reimpr = modo === 'reimprimir';
    const m = UI().openModal({
      titulo: reimpr ? 'Reimprimir cupom de compra' : 'Buscar compra', largura: '520px',
      corpo: `
        <div class="busca-bar">
          <input id="busca-input" class="input" type="text" placeholder="Nº do pedido ou nome do fornecedor" />
          <button id="busca-btn" class="btn btn-primary">Buscar</button>
        </div>
        <div id="busca-result" class="busca-result"><div class="muted">Buscando recentes...</div></div>`
    });
    const input = m.body.querySelector('#busca-input');
    const fazer = () => buscar(m, input.value.trim(), modo);
    m.body.querySelector('#busca-btn').onclick = fazer;
    input.onkeydown = (e) => { if (e.key === 'Enter') fazer(); };
    setTimeout(() => input.focus(), 50);
    buscar(m, '', modo);
  }

  async function buscar(m, termo, modo) {
    modo = modo || 'editar';
    const reimpr = modo === 'reimprimir';
    const db = UI().db();
    const box = m.body.querySelector('#busca-result');
    box.innerHTML = '<div class="muted">Buscando...</div>';
    const sel = 'id,numero,data,total,fornecedor_id,fornecedores(nome)';
    let q = db.from('pedidos_compra').select(sel).order('data', { ascending: false }).limit(30);
    if (termo) {
      if (/^\d+$/.test(termo)) {
        q = db.from('pedidos_compra').select(sel).eq('numero', Number(termo));
      } else {
        const { data: fs } = await db.from('fornecedores').select('id').ilike('nome', '%' + termo + '%');
        const ids = (fs || []).map((f) => f.id);
        if (!ids.length) { box.innerHTML = '<div class="empty-sm">Nenhum fornecedor com esse nome.</div>'; return; }
        q = db.from('pedidos_compra').select(sel).in('fornecedor_id', ids).order('data', { ascending: false }).limit(30);
      }
    }
    const { data, error } = await q;
    if (error) { UI().erro('Falha na busca', error); return; }
    if (!data || !data.length) { box.innerHTML = '<div class="empty-sm">Nada encontrado.</div>'; return; }
    box.innerHTML = data.map((p) => `
      <div class="busca-row">
        <button class="busca-item" data-id="${p.id}">
          <span>${reimpr ? '🖨' : '✏️'} <strong>Nº ${p.numero}</strong> · ${UI().dataCurta(p.data)} · ${UI().esc((p.fornecedores && p.fornecedores.nome) || '—')}</span>
          <span>${UI().money(p.total)}</span>
        </button>
        ${reimpr ? '' : `<button class="busca-excluir" data-id="${p.id}" data-num="${p.numero}" title="Excluir compra">🗑</button>`}
      </div>`).join('');
    box.querySelectorAll('.busca-item').forEach((b) => b.onclick = () => {
      m.close();
      if (reimpr) reimprimirPedido(b.dataset.id);
      else carregarEdicao(b.dataset.id);
    });
    if (!reimpr) box.querySelectorAll('.busca-excluir').forEach((b) => b.onclick = () => excluirCompra(b.dataset.id, b.dataset.num, m));
  }

  // Reconstrói os dados do cupom a partir do banco e reimprime.
  async function reimprimirPedido(id) {
    const db = UI().db();
    UI().toast('Preparando cupom...');
    try {
      const { data: ped, error } = await db.from('pedidos_compra')
        .select('id,numero,data,total,observacao,fornecedor_id,fornecedores(nome,saldo_aberto),vendedores(nome)')
        .eq('id', id).single();
      if (error) throw error;
      const { data: itens } = await db.from('itens_compra')
        .select('quantidade,preco_unit,valor,produtos(nome,unidade)').eq('pedido_id', id);
      const { data: pags } = await db.from('pagamentos_compra')
        .select('modalidade,valor,vencimento').eq('pedido_id', id);
      const pago = (pags || []).reduce((s, p) => s + Number(p.valor), 0);
      AGB.cupom.imprimir({
        tipo: 'COMPRA',
        numero: ped.numero, data: ped.data,
        contraparteLabel: 'Fornecedor',
        contraparteNome: ped.fornecedores ? ped.fornecedores.nome : '—',
        vendedor: ped.vendedores ? ped.vendedores.nome : '',
        itens: (itens || []).map((i) => ({
          descricao: i.produtos ? i.produtos.nome : '(produto removido)',
          unidade: i.produtos ? i.produtos.unidade : '',
          quantidade: Number(i.quantidade), preco_unit: Number(i.preco_unit), valor: Number(i.valor)
        })),
        total: Number(ped.total),
        pagamentos: (pags || []).map((p) => ({ modalidade: p.modalidade, valor: Number(p.valor), vencimento: p.vencimento })),
        emAberto: arred(Number(ped.total) - pago),
        saldoLabel: 'Saldo em aberto',
        saldo: ped.fornecedores ? Number(ped.fornecedores.saldo_aberto) : null,
        observacao: ped.observacao
      });
    } catch (err) { UI().erro('Não foi possível reimprimir o cupom', err); }
  }

  async function carregarEdicao(id) {
    const db = UI().db();
    main.innerHTML = `<div class="muted" style="padding:18px">Abrindo pedido...</div>`;
    try {
      const { data: ped, error } = await db.from('pedidos_compra')
        .select('id,numero,vendedor_id,fornecedor_id,observacao').eq('id', id).single();
      if (error) throw error;
      const { data: itens } = await db.from('itens_compra')
        .select('produto_id,quantidade,preco_unit,produtos(nome,unidade)').eq('pedido_id', id);
      const { data: pags } = await db.from('pagamentos_compra')
        .select('modalidade,valor,vencimento').eq('pedido_id', id);

      // Carimbo de versão (best-effort): se a coluna não existir ainda no
      // banco, seguimos sem trava — não quebra a abertura do pedido.
      let editUpdatedAt = null;
      try {
        const { data: t } = await db.from('pedidos_compra').select('atualizado_em').eq('id', id).single();
        editUpdatedAt = t ? t.atualizado_em : null;
      } catch (_) { /* sem coluna: sem trava otimista */ }

      novaCompra();
      compra.editId = ped.id;
      compra.editNumero = ped.numero;
      compra.editUpdatedAt = editUpdatedAt;
      compra.vendedor_id = ped.vendedor_id || '';
      compra.fornecedor_id = ped.fornecedor_id || '';
      compra.observacao = ped.observacao || '';
      compra.itens = (itens || []).map((i) => ({
        produto_id: i.produto_id,
        descricao: i.produtos ? i.produtos.nome : '(produto removido)',
        unidade: i.produtos ? i.produtos.unidade : '',
        quantidade: Number(i.quantidade), preco_unit: Number(i.preco_unit)
      }));
      (pags || []).forEach((p) => {
        compra.pagamentos[p.modalidade] = (compra.pagamentos[p.modalidade] || 0) + Number(p.valor);
        if (p.modalidade === 'boleto' && p.vencimento) compra.boletoVenc = p.vencimento;
      });
      pintar();
    } catch (err) { UI().erro('Não foi possível abrir o pedido', err); pintar(); }
  }

  function adicionarItem() {
    const prodId = cbProduto ? cbProduto.get() : '';
    const qtd = parseFloat(main.querySelector('#it-qtd').value);
    const preco = parseFloat(main.querySelector('#it-preco').value);
    if (!prodId) { UI().toast('Escolha um produto.', 'erro'); return; }
    if (!(qtd > 0)) { UI().toast('Quantidade deve ser maior que zero.', 'erro'); return; }
    if (!(preco >= 0)) { UI().toast('Preço inválido.', 'erro'); return; }
    const p = cache.produtos.find((x) => x.id === prodId);
    compra.itens.push({ produto_id: p.id, descricao: p.nome, unidade: p.unidade, quantidade: qtd, preco_unit: preco });
    cbProduto.clear();
    main.querySelector('#it-qtd').value = '';
    main.querySelector('#it-preco').value = '';
    cbProduto.focus();
    renderItens();
    atualizarTotalRodape();
  }

  function renderItens() {
    const box = main.querySelector('#itens-lista');
    if (!compra.itens.length) { box.innerHTML = '<div class="empty-sm">Nenhum item adicionado.</div>'; return; }
    box.innerHTML = compra.itens.map((i, idx) => `
      <div class="item-linha" data-idx="${idx}">
        <div class="item-info">
          <div class="item-desc">${UI().esc(i.descricao)}</div>
          <div class="item-sub">${UI().qtd(i.quantidade)} ${UI().esc(i.unidade)} × ${UI().money(i.preco_unit)}</div>
        </div>
        <div class="item-valor">${UI().money(arred(i.quantidade * i.preco_unit))}</div>
        <button class="btn btn-sm btn-ghost btn-edit-item" data-edit="${idx}">✏️ Editar</button>
        <button class="btn btn-sm btn-ghost btn-del" data-rm="${idx}" aria-label="Remover item" title="Remover item">✕</button>
      </div>`).join('');
    box.querySelectorAll('[data-rm]').forEach((b) => b.onclick = () => {
      compra.itens.splice(Number(b.dataset.rm), 1); renderItens(); atualizarTotalRodape();
    });
    box.querySelectorAll('[data-edit]').forEach((b) => b.onclick = () => editarItemInline(Number(b.dataset.edit)));
  }

  function editarItemInline(idx) {
    const item = compra.itens[idx];
    const row = main.querySelector(`.item-linha[data-idx="${idx}"]`);
    row.innerHTML = `
      <div class="item-info" style="flex:1">
        <div class="item-desc">${UI().esc(item.descricao)}</div>
        <div class="item-edit-inputs">
          <input class="input input-sm-qtd" id="eq-${idx}" type="number" step="0.001" min="0" inputmode="decimal" value="${item.quantidade}" placeholder="Qtd"/>
          <span>${UI().esc(item.unidade)} ×</span>
          <input class="input input-sm-preco" id="ep-${idx}" type="number" step="0.01" min="0" inputmode="decimal" value="${item.preco_unit}" placeholder="Preço"/>
          <button class="btn btn-sm btn-primary" id="eo-${idx}">✓ Ok</button>
          <button class="btn btn-sm btn-ghost" id="ec-${idx}">Cancelar</button>
        </div>
      </div>`;
    const qtdI = row.querySelector(`#eq-${idx}`);
    const precoI = row.querySelector(`#ep-${idx}`);
    qtdI.focus(); qtdI.select();
    const salvar = () => {
      const qtd = parseFloat(qtdI.value);
      const preco = parseFloat(precoI.value);
      if (!(qtd > 0)) { UI().toast('Quantidade deve ser maior que zero.', 'erro'); return; }
      if (!(preco >= 0)) { UI().toast('Preço inválido.', 'erro'); return; }
      compra.itens[idx].quantidade = qtd;
      compra.itens[idx].preco_unit = preco;
      renderItens(); atualizarTotalRodape();
    };
    row.querySelector(`#eo-${idx}`).onclick = salvar;
    row.querySelector(`#ec-${idx}`).onclick = renderItens;
    qtdI.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); precoI.focus(); } if (e.key === 'Escape') renderItens(); };
    precoI.onkeydown = (e) => { if (e.key === 'Enter') salvar(); if (e.key === 'Escape') renderItens(); };
  }

  function atualizarTotalRodape() {
    const el = main.querySelector('.rodape-total strong');
    if (el) el.textContent = UI().money(totalItens());
  }

  function irParaPagamento() {
    if (!compra.vendedor_id) { UI().toast('Selecione o comprador.', 'erro'); return; }
    if (!compra.fornecedor_id) { UI().toast('Selecione o fornecedor.', 'erro'); return; }
    if (!compra.itens.length) { UI().toast('Adicione ao menos um item.', 'erro'); return; }
    compra.step = 'pagamento';
    pintar();
  }

  // ===================== PASSO 2: PAGAMENTO ==========================
  // Formas com atalho por número. Compra sempre tem fornecedor → opção 4 sempre disponível.
  function formasPagamento() {
    return [
      { f: 'dinheiro', n: '1', l: 'Dinheiro' },
      { f: 'distribuir', n: '2', l: 'Distribuir entre formas' },
      { f: 'boleto', n: '3', l: 'Boleto' },
      { f: 'fiado', n: '4', l: 'Fiado / saldo' },
      { f: 'cartao', n: '5', l: 'Cartão' },
      { f: 'pix', n: '7', l: 'Pix' }
    ];
  }

  function escolherForma(forma) {
    compra.formaPg = forma;
    compra.pagamentos = { dinheiro: 0, pix: 0, cartao: 0, boleto: 0 };
    if (forma === 'dinheiro' || forma === 'cartao' || forma === 'pix' || forma === 'boleto') {
      compra.pagamentos[forma] = totalItens();
    }
    pintarPagamento();
  }

  function pintarPagamento() {
    const total = totalItens();
    const forma = compra.formaPg;
    const formas = formasPagamento();

    let detalhe = '';
    if (forma === 'distribuir') {
      detalhe = `
        <div class="pg-grid">
          ${MOD_ORDEM.map((m) => `
            <label class="campo"><span>${MOD_LABEL[m]}</span>
              <input class="input pg-input" data-mod="${m}" type="number" step="0.01" min="0" inputmode="decimal"
                value="${compra.pagamentos[m] || ''}" placeholder="0,00"/></label>`).join('')}
        </div>
        <label class="campo" id="boleto-venc-wrap" style="${compra.pagamentos.boleto > 0 ? '' : 'display:none'}">
          <span>Vencimento do boleto</span>
          <input id="boleto-venc" class="input" type="date" value="${compra.boletoVenc}"/>
        </label>`;
    } else if (forma === 'fiado') {
      detalhe = `<div class="pg-escolhido">Tudo em aberto — vira saldo com o fornecedor: <strong>${UI().money(total)}</strong></div>`;
    } else if (forma === 'boleto') {
      detalhe = `<div class="pg-escolhido">Tudo em Boleto: <strong>${UI().money(total)}</strong></div>
        <label class="campo" style="max-width:220px"><span>Vencimento do boleto</span>
          <input id="boleto-venc" class="input" type="date" value="${compra.boletoVenc}"/></label>`;
    } else if (forma === 'dinheiro' || forma === 'cartao' || forma === 'pix') {
      detalhe = `<div class="pg-escolhido">Tudo em ${MOD_LABEL[forma]}: <strong>${UI().money(total)}</strong></div>`;
    } else {
      detalhe = `<p class="muted" style="margin:4px 0 0">Escolha a forma de pagamento — <strong>tecle o número</strong>.</p>`;
    }

    main.innerHTML = `
      <div class="fluxo">
        <div class="fluxo-head">
          <h2>Pagamento</h2>
          ${etapasHTML(2)}
        </div>
        <section class="card bloco">
          <div class="pg-total">Total da compra: <strong>${UI().money(total)}</strong></div>
          <div class="pg-formas">
            ${formas.map((o) => `<button class="pg-forma${forma === o.f ? ' ativa' : ''}" data-forma="${o.f}"><kbd>${o.n}</kbd> ${o.l}</button>`).join('')}
          </div>
          <div id="pg-detalhe" class="pg-detalhe">${detalhe}</div>
          <div class="pg-resumo">
            <div class="cp-row"><span>Pago</span><span id="pg-pago">${UI().money(0)}</span></div>
            <div class="cp-row pg-aberto-row"><span id="pg-aberto-lbl">Parcial em aberto</span><span id="pg-aberto">${UI().money(total)}</span></div>
          </div>
          <p class="aviso pg-excedente-aviso" id="pg-excedente" style="display:none">Pagamento maior que o total da compra. Tire o excedente ou ajuste o total antes de confirmar.</p>
        </section>
        <div class="fluxo-rodape">
          <button id="voltar" class="btn btn-ghost btn-grande">← Voltar <kbd>Esc</kbd></button>
          <button id="confirmar" class="btn btn-primary btn-grande">${compra.editId ? '✓ Salvar alterações' : 'Confirmar compra'} <kbd>Enter</kbd></button>
        </div>
      </div>`;

    main.querySelectorAll('.pg-forma').forEach((b) => b.onclick = () => escolherForma(b.dataset.forma));

    main.querySelectorAll('.pg-input').forEach((inp) => {
      inp.oninput = () => {
        const m = inp.dataset.mod;
        compra.pagamentos[m] = parseFloat(inp.value) || 0;
        const w = main.querySelector('#boleto-venc-wrap');
        if (m === 'boleto' && w) w.style.display = compra.pagamentos.boleto > 0 ? '' : 'none';
        atualizarResumoPagamento();
      };
      inp.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); confirmarCompra(); } };
    });
    const venc = main.querySelector('#boleto-venc');
    if (venc) {
      venc.onchange = (e) => { compra.boletoVenc = e.target.value; };
      venc.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); confirmarCompra(); } };
    }

    main.querySelector('#voltar').onclick = () => { compra.step = 'montar'; pintar(); };
    main.querySelector('#confirmar').onclick = confirmarCompra;

    main.querySelector('.fluxo').onkeydown = (e) => {
      const ae = document.activeElement;
      const digitando = ae && (ae.classList.contains('pg-input') || ae.type === 'date');
      if (e.key === 'Escape') { compra.step = 'montar'; pintar(); return; }
      if (!digitando && '1234570'.includes(e.key) && e.key !== '0') {
        const o = formas.find((x) => x.n === e.key);
        if (o) { e.preventDefault(); escolherForma(o.f); }
      }
    };

    atualizarResumoPagamento();

    setTimeout(() => {
      if (forma === 'distribuir') { const d = main.querySelector('.pg-input[data-mod="dinheiro"]'); if (d) d.focus(); }
      else if (forma === 'boleto') { if (venc) venc.focus(); }
      else if (forma) { const c = main.querySelector('#confirmar'); if (c) c.focus(); }
      else { const b = main.querySelector('.pg-forma'); if (b) b.focus(); }
    }, 30);
  }

  function atualizarResumoPagamento() {
    const total = totalItens();
    const pago = totalPago();
    const aberto = arred(total - pago);
    const excedente = aberto < -0.005;
    main.querySelector('#pg-pago').textContent = UI().money(pago);
    const abEl = main.querySelector('#pg-aberto');
    const lblEl = main.querySelector('#pg-aberto-lbl');
    lblEl.textContent = excedente ? 'Excedente (pago a mais)' : 'Parcial em aberto';
    abEl.textContent = UI().money(excedente ? -aberto : aberto);
    abEl.parentElement.classList.toggle('pg-aberto-pos', aberto > 0.005);
    abEl.parentElement.classList.toggle('pg-aberto-neg', excedente);
    const aviso = main.querySelector('#pg-excedente');
    if (aviso) aviso.style.display = excedente ? '' : 'none';
    const btn = main.querySelector('#confirmar');
    if (btn) btn.disabled = excedente;
  }

  // ---- Gravação ------------------------------------------------------
  async function confirmarCompra() {
    if (gravando) return;                 // anti-duplo-envio
    const btn = main.querySelector('#confirmar');
    const db = UI().db();
    const editando = !!compra.editId;
    // Trava: pago não pode ser maior que o total da compra.
    if (totalPago() - totalItens() > 0.005) {
      UI().toast(`O pagamento (${UI().money(totalPago())}) é maior que o total (${UI().money(totalItens())}). Ajuste antes de salvar.`, 'erro');
      return;
    }
    // Trava otimista: avisa se outra pessoa mexeu no pedido desde que foi aberto.
    if (editando && compra.editUpdatedAt) {
      try {
        const { data: cur } = await db.from('pedidos_compra').select('atualizado_em').eq('id', compra.editId).single();
        if (cur && cur.atualizado_em && cur.atualizado_em !== compra.editUpdatedAt) {
          const seguir = await UI().confirm(
            'Esta compra foi alterada por outra pessoa depois que você abriu. Se salvar agora, as mudanças dela serão substituídas pelas suas. Continuar?',
            { okLabel: 'Salvar assim mesmo', perigo: true }
          );
          if (!seguir) return;
          compra.editUpdatedAt = cur.atualizado_em; // usuário aceitou sobrescrever
        }
      } catch (_) { /* sem coluna/rede: não bloqueia o salvamento */ }
    }
    gravando = true;
    if (btn) btn.disabled = true;
    try {
      const itens = compra.itens.map((i) => ({
        produto_id: i.produto_id, quantidade: i.quantidade, preco_unit: i.preco_unit,
        valor: arred(i.quantidade * i.preco_unit)
      }));
      const pagamentos = MOD_ORDEM
        .filter((m) => (Number(compra.pagamentos[m]) || 0) > 0)
        .map((m) => ({
          modalidade: m, valor: arred(compra.pagamentos[m]),
          vencimento: m === 'boleto' && compra.boletoVenc ? compra.boletoVenc : null
        }));

      // Gravação ATÔMICA no servidor (transação única).
      const { data, error } = await db.rpc('salvar_compra', {
        p_pedido_id: compra.editId,
        p_vendedor_id: compra.vendedor_id,
        p_fornecedor_id: compra.fornecedor_id,
        p_observacao: compra.observacao || null,
        p_itens: itens,
        p_pagamentos: pagamentos
      });
      if (error) throw error;

      if (data.saldo != null) {
        const ff = cache.fornecedores.find((x) => x.id === compra.fornecedor_id);
        if (ff) ff.saldo_aberto = Number(data.saldo);
      }
      compra.resultado = {
        numero: data.numero, total: Number(data.total), data: data.data,
        saldo: data.saldo != null ? Number(data.saldo) : null, editado: editando
      };
      compra.step = 'ok';
      pintar();
    } catch (err) {
      UI().erro('Não foi possível gravar a compra', err);
      if (btn) btn.disabled = false;
    } finally {
      gravando = false;
    }
  }

  // ===================== PASSO 3: CONFIRMAÇÃO ========================
  function pintarOk() {
    const r = compra.resultado;
    const forn = fornecedorAtual();
    const pago = totalPago();
    const aberto = arred(r.total - pago);
    main.innerHTML = `
      <div class="fluxo">
        <div class="ok-box card">
          <div class="ok-check">✓</div>
          <h2>Compra nº ${r.numero} ${r.editado ? 'atualizada' : 'registrada'}</h2>
          <div class="ok-total">${UI().money(r.total)}</div>
          <div class="ok-detalhes">
            <div class="cp-row"><span>Fornecedor</span><span>${UI().esc(forn ? forn.nome : '—')}</span></div>
            <div class="cp-row"><span>Pago</span><span>${UI().money(pago)}</span></div>
            ${aberto > 0.005 ? `<div class="cp-row cp-aberto"><span>Parcial em aberto</span><span>${UI().money(aberto)}</span></div>` : ''}
            ${r.saldo != null ? `<div class="cp-row cp-saldo"><span>Saldo em aberto atualizado</span><span>${saldoBadge(r.saldo)}</span></div>` : ''}
          </div>
          <div class="ok-acoes">
            <button id="imprimir" class="btn btn-primary btn-grande">🖨 Imprimir cupom <kbd>Enter</kbd></button>
            <button id="nova" class="btn btn-ghost btn-grande">Nova compra</button>
          </div>
        </div>
      </div>`;
    main.querySelector('#imprimir').onclick = () => AGB.cupom.imprimir(dadosCupom());
    main.querySelector('#nova').onclick = () => { novaCompra(); pintar(); };
    setTimeout(() => { const b = main.querySelector('#imprimir'); if (b) b.focus(); }, 30);
  }

  function dadosCupom() {
    const r = compra.resultado;
    const forn = fornecedorAtual();
    const pago = totalPago();
    return {
      tipo: 'COMPRA',
      numero: r.numero, data: r.data,
      contraparteLabel: 'Fornecedor',
      contraparteNome: forn ? forn.nome : '—',
      vendedor: (cache.vendedores.find((v) => v.id === compra.vendedor_id) || {}).nome,
      itens: compra.itens.map((i) => ({ ...i, valor: arred(i.quantidade * i.preco_unit) })),
      total: r.total,
      pagamentos: MOD_ORDEM.map((m) => ({
        modalidade: m, valor: compra.pagamentos[m],
        vencimento: m === 'boleto' && compra.boletoVenc ? compra.boletoVenc : null
      })),
      emAberto: arred(r.total - pago),
      saldoLabel: 'Saldo em aberto',
      saldo: r.saldo,
      observacao: compra.observacao
    };
  }

  // ---- Helpers -------------------------------------------------------
  function fornecedorAtual() {
    if (!compra || !compra.fornecedor_id) return null;
    return cache.fornecedores.find((f) => f.id === compra.fornecedor_id) || null;
  }
  function saldoBadge(v) {
    v = Number(v) || 0;
    if (Math.abs(v) < 0.005) return '<span class="saldo saldo-zero">Em dia</span>';
    if (v > 0) return `<span class="saldo saldo-deve">Em aberto ${UI().money(v)}</span>`;
    return `<span class="saldo saldo-credito">Crédito ${UI().money(-v)}</span>`;
  }
  const etapasHTML = (n) => UI().etapasHTML(n);

  // ---- Excluir compra -----------------------------------------------
  async function excluirCompra(id, numero, modal) {
    const ok = await UI().confirm(
      `Excluir compra nº ${numero}?\n\nTodos os itens e pagamentos serão apagados permanentemente.`,
      { okLabel: 'Excluir compra', perigo: true }
    );
    if (!ok) return;
    if (modal) modal.close();
    const { error } = await UI().db().from('pedidos_compra').delete().eq('id', id);
    if (error) { UI().erro('Não foi possível excluir a compra', error); return; }
    UI().toast('Compra excluída.');
    novaCompra();
    pintar();
  }

  window.addEventListener('hashchange', () => {
    if ((location.hash || '').includes('compras')) cache.carregado = false;
  });

  // API pública p/ atalhos de teclado (F2 nova, F3 editar, F7 reimprimir).
  window.AGB.compras = {
    nova: function () {
      novaCompra();
      if ((location.hash || '').includes('compras')) pintar();
      else location.hash = '#/compras';
    },
    busca: () => abrirBusca('editar'),
    reimprimir: () => abrirBusca('reimprimir')
  };

  window.AGB.registerView('compras', render);
})();
