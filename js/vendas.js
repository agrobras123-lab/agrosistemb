/* =====================================================================
 * Agro Bras Hortifruti — Vendas (Etapa 2)
 * Fluxo: vendedor → cliente/avulso → itens → observação →
 *        pagamento (distribuição livre) → confirma → cupom 80mm.
 *
 * Regras respeitadas:
 *  - numero do pedido NUNCA é gerado no app (vem da sequência do Postgres;
 *    lemos o valor retornado no INSERT).
 *  - valor do item = quantidade * preco_unit (gravado); total por trigger.
 *  - pagamento misto: vários registros em pagamentos_venda.
 *  - "parcial em aberto" = total - soma(pagamentos); NÃO é gravado como
 *    pagamento — vira saldo automaticamente via trigger.
 *  - venda avulsa: cliente_id = NULL.
 *  - saldo: só LEMOS o saldo atualizado depois de gravar.
 * ===================================================================== */
(function () {
  const UI = () => window.AGB.ui;
  const MOD_ORDEM = ['dinheiro', 'pix', 'cartao', 'boleto'];
  const MOD_LABEL = { dinheiro: 'Dinheiro', pix: 'Pix', cartao: 'Cartão', boleto: 'Boleto' };

  let main = null;
  let cache = { vendedores: [], clientes: [], produtos: [] };
  let venda = null;
  let cbCliente = null;
  let cbProduto = null;

  // Texto curto de saldo (para o subtítulo do combobox de cliente)
  function saldoTexto(v) {
    const n = Number(v) || 0;
    if (Math.abs(n) < 0.005) return 'Em dia';
    return n > 0 ? 'Deve ' + UI().money(n) : 'Crédito ' + UI().money(-n);
  }

  function novaVenda() {
    venda = {
      step: 'montar',
      editId: null,            // id do pedido em edição (null = nova venda)
      editNumero: null,
      vendedor_id: '',
      cliente_id: '',          // '' = ainda não escolhido; 'AVULSO' = avulsa
      itens: [],               // {produto_id, descricao, unidade, quantidade, preco_unit}
      observacao: '',
      pagamentos: { dinheiro: 0, pix: 0, cartao: 0, boleto: 0 },
      boletoVenc: '',
      resultado: null          // {numero, total, saldo, data}
    };
  }

  const arred = (n) => Math.round((Number(n) || 0) * 100) / 100;
  const totalItens = () => arred(venda.itens.reduce((s, i) => s + i.quantidade * i.preco_unit, 0));
  const totalPago  = () => arred(MOD_ORDEM.reduce((s, m) => s + (Number(venda.pagamentos[m]) || 0), 0));

  // ---- Entrada -------------------------------------------------------
  async function render(el) {
    main = el;
    if (!venda) novaVenda();
    main.innerHTML = `<div class="muted" style="padding:18px">Carregando...</div>`;
    if (!cache.carregado) {
      const db = UI().db();
      const [v, c, p] = await Promise.all([
        db.from('vendedores').select('id,nome').eq('ativo', true).order('nome'),
        db.from('clientes').select('id,nome,saldo_devedor').order('nome'),
        db.from('produtos').select('id,codigo,nome,unidade').eq('ativo', true).order('nome')
      ]);
      if (v.error || c.error || p.error) {
        UI().erro('Falha ao carregar dados de venda', v.error || c.error || p.error);
        return;
      }
      cache = { vendedores: v.data || [], clientes: c.data || [], produtos: p.data || [], carregado: true };
    }
    pintar();
  }

  function pintar() {
    if (venda.step === 'montar') return pintarMontar();
    if (venda.step === 'pagamento') return pintarPagamento();
    if (venda.step === 'ok') return pintarOk();
  }

  // ===================== PASSO 1: MONTAR =============================
  function pintarMontar() {
    const cliente = clienteAtual();
    main.innerHTML = `
      <div class="fluxo">
        <div class="fluxo-top">
          <button id="btn-buscar" class="btn btn-ghost btn-sm">🔍 Buscar / editar venda</button>
          ${venda.editId ? `<span class="edit-flag">✎ Editando venda nº ${venda.editNumero}</span>
            <button id="btn-cancelar-edit" class="btn btn-ghost btn-sm">Cancelar edição</button>` : ''}
        </div>
        <div class="fluxo-head">
          <h2>${venda.editId ? 'Editar venda' : 'Nova venda'}</h2>
          ${etapasHTML(1)}
        </div>

        <section class="card bloco">
          <div class="grid2">
            <label class="campo"><span>Vendedor *</span>
              <select id="sel-vendedor" class="input">
                <option value="">Selecione...</option>
                ${cache.vendedores.map((v) => `<option value="${v.id}" ${v.id === venda.vendedor_id ? 'selected' : ''}>${UI().esc(v.nome)}</option>`).join('')}
              </select>
            </label>
            <label class="campo"><span>Cliente</span>
              <div id="cb-cliente"></div>
            </label>
          </div>
          ${cliente ? `<div class="saldo-inline">Saldo atual: ${saldoBadge(cliente.saldo_devedor)}</div>` : ''}
          ${cache.vendedores.length ? '' : '<p class="aviso">Nenhum vendedor ativo cadastrado. Cadastre em <strong>Cadastros → Vendedores</strong>.</p>'}
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
            <textarea id="obs" rows="2" placeholder="opcional">${UI().esc(venda.observacao)}</textarea></label>
        </section>

        <div class="fluxo-rodape">
          <div class="rodape-total">Total: <strong>${UI().money(totalItens())}</strong></div>
          <button id="ir-pagamento" class="btn btn-primary btn-grande">Pagamento →</button>
        </div>
      </div>`;

    // Eventos
    main.querySelector('#sel-vendedor').onchange = (e) => { venda.vendedor_id = e.target.value; };

    cbCliente = UI().combobox(main.querySelector('#cb-cliente'), {
      placeholder: 'Buscar cliente ou Avulso...',
      value: venda.cliente_id,
      items: [{ id: 'AVULSO', label: 'Avulso (sem cliente)', sub: '' }].concat(
        cache.clientes.map((c) => ({ id: c.id, label: c.nome, sub: saldoTexto(c.saldo_devedor) }))),
      onChange: (id) => { venda.cliente_id = id; pintarMontar(); }
    });

    cbProduto = UI().combobox(main.querySelector('#cb-produto'), {
      placeholder: 'Buscar produto por nome ou código...',
      items: cache.produtos.map((p) => ({
        id: p.id, label: p.nome, sub: p.unidade, code: p.codigo
      })),
      // Ao escolher o produto, pula direto para a quantidade (agiliza a venda).
      onChange: () => { const q = main.querySelector('#it-qtd'); if (q) q.focus(); }
    });

    main.querySelector('#it-add').onclick = adicionarItem;
    main.querySelector('#it-qtd').onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); main.querySelector('#it-preco').focus(); } };
    main.querySelector('#it-preco').onkeydown = (e) => { if (e.key === 'Enter') adicionarItem(); };
    main.querySelector('#obs').oninput = (e) => { venda.observacao = e.target.value; };
    main.querySelector('#ir-pagamento').onclick = irParaPagamento;
    main.querySelector('#btn-buscar').onclick = abrirBusca;
    const cancEdit = main.querySelector('#btn-cancelar-edit');
    if (cancEdit) cancEdit.onclick = () => { novaVenda(); pintar(); };
    renderItens();
  }

  // ---- Busca / edição -----------------------------------------------
  function abrirBusca() {
    const m = UI().openModal({
      titulo: 'Buscar venda', largura: '520px',
      corpo: `
        <div class="busca-bar">
          <input id="busca-input" class="input" type="text" placeholder="Nº do pedido ou nome do cliente" />
          <button id="busca-btn" class="btn btn-primary">Buscar</button>
        </div>
        <div id="busca-result" class="busca-result"><div class="muted">Buscando recentes...</div></div>`
    });
    const input = m.body.querySelector('#busca-input');
    const fazer = () => buscar(m, input.value.trim());
    m.body.querySelector('#busca-btn').onclick = fazer;
    input.onkeydown = (e) => { if (e.key === 'Enter') fazer(); };
    setTimeout(() => input.focus(), 50);
    buscar(m, ''); // recentes
  }

  async function buscar(m, termo) {
    const db = UI().db();
    const box = m.body.querySelector('#busca-result');
    box.innerHTML = '<div class="muted">Buscando...</div>';
    let q = db.from('pedidos_venda').select('id,numero,data,total,cliente_id,clientes(nome)').order('data', { ascending: false }).limit(30);
    if (termo) {
      if (/^\d+$/.test(termo)) {
        q = db.from('pedidos_venda').select('id,numero,data,total,cliente_id,clientes(nome)').eq('numero', Number(termo));
      } else {
        const { data: cls } = await db.from('clientes').select('id').ilike('nome', '%' + termo + '%');
        const ids = (cls || []).map((c) => c.id);
        if (!ids.length) { box.innerHTML = '<div class="empty-sm">Nenhum cliente com esse nome.</div>'; return; }
        q = db.from('pedidos_venda').select('id,numero,data,total,cliente_id,clientes(nome)').in('cliente_id', ids).order('data', { ascending: false }).limit(30);
      }
    }
    const { data, error } = await q;
    if (error) { UI().erro('Falha na busca', error); return; }
    if (!data || !data.length) { box.innerHTML = '<div class="empty-sm">Nada encontrado.</div>'; return; }
    box.innerHTML = data.map((p) => `
      <button class="busca-item" data-id="${p.id}">
        <span><strong>Nº ${p.numero}</strong> · ${UI().dataCurta(p.data)} · ${UI().esc((p.clientes && p.clientes.nome) || 'Avulso')}</span>
        <span>${UI().money(p.total)}</span>
      </button>`).join('');
    box.querySelectorAll('.busca-item').forEach((b) => b.onclick = () => { m.close(); carregarEdicao(b.dataset.id); });
  }

  async function carregarEdicao(id) {
    const db = UI().db();
    main.innerHTML = `<div class="muted" style="padding:18px">Abrindo pedido...</div>`;
    try {
      const { data: ped, error } = await db.from('pedidos_venda')
        .select('id,numero,vendedor_id,cliente_id,observacao').eq('id', id).single();
      if (error) throw error;
      const { data: itens } = await db.from('itens_venda')
        .select('produto_id,quantidade,preco_unit,produtos(nome,unidade)').eq('pedido_id', id);
      const { data: pags } = await db.from('pagamentos_venda')
        .select('modalidade,valor,vencimento').eq('pedido_id', id);

      novaVenda();
      venda.editId = ped.id;
      venda.editNumero = ped.numero;
      venda.vendedor_id = ped.vendedor_id || '';
      venda.cliente_id = ped.cliente_id || 'AVULSO';
      venda.observacao = ped.observacao || '';
      venda.itens = (itens || []).map((i) => ({
        produto_id: i.produto_id,
        descricao: i.produtos ? i.produtos.nome : '(produto removido)',
        unidade: i.produtos ? i.produtos.unidade : '',
        quantidade: Number(i.quantidade), preco_unit: Number(i.preco_unit)
      }));
      (pags || []).forEach((p) => {
        venda.pagamentos[p.modalidade] = (venda.pagamentos[p.modalidade] || 0) + Number(p.valor);
        if (p.modalidade === 'boleto' && p.vencimento) venda.boletoVenc = p.vencimento;
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
    venda.itens.push({ produto_id: p.id, descricao: p.nome, unidade: p.unidade, quantidade: qtd, preco_unit: preco });
    cbProduto.clear();
    main.querySelector('#it-qtd').value = '';
    main.querySelector('#it-preco').value = '';
    cbProduto.focus();
    renderItens();
    atualizarTotalRodape();
  }

  function renderItens() {
    const box = main.querySelector('#itens-lista');
    if (!venda.itens.length) { box.innerHTML = '<div class="empty-sm">Nenhum item adicionado.</div>'; return; }
    box.innerHTML = venda.itens.map((i, idx) => `
      <div class="item-linha">
        <div class="item-info">
          <div class="item-desc">${UI().esc(i.descricao)}</div>
          <div class="item-sub">${UI().qtd(i.quantidade)} ${UI().esc(i.unidade)} × ${UI().money(i.preco_unit)}</div>
        </div>
        <div class="item-valor">${UI().money(arred(i.quantidade * i.preco_unit))}</div>
        <button class="btn btn-sm btn-ghost btn-del" data-rm="${idx}">✕</button>
      </div>`).join('');
    box.querySelectorAll('[data-rm]').forEach((b) => b.onclick = () => {
      venda.itens.splice(Number(b.dataset.rm), 1); renderItens(); atualizarTotalRodape();
    });
  }

  function atualizarTotalRodape() {
    const el = main.querySelector('.rodape-total strong');
    if (el) el.textContent = UI().money(totalItens());
  }

  function irParaPagamento() {
    if (!venda.vendedor_id) { UI().toast('Selecione o vendedor.', 'erro'); return; }
    if (venda.cliente_id === '') { UI().toast('Selecione o cliente ou Avulso.', 'erro'); return; }
    if (!venda.itens.length) { UI().toast('Adicione ao menos um item.', 'erro'); return; }
    venda.step = 'pagamento';
    pintar();
  }

  // ===================== PASSO 2: PAGAMENTO ==========================
  function pintarPagamento() {
    const total = totalItens();
    main.innerHTML = `
      <div class="fluxo">
        <div class="fluxo-head">
          <h2>Pagamento</h2>
          ${etapasHTML(2)}
        </div>
        <section class="card bloco">
          <div class="pg-total">Total da venda: <strong>${UI().money(total)}</strong></div>
          <p class="muted" style="margin-top:0">Distribua livremente entre as formas. O que não for pago vira <strong>parcial em aberto</strong> (saldo do cliente).</p>
          <div class="pg-grid">
            ${MOD_ORDEM.map((m) => `
              <label class="campo"><span>${MOD_LABEL[m]}</span>
                <input class="input pg-input" data-mod="${m}" type="number" step="0.01" min="0" inputmode="decimal"
                  value="${venda.pagamentos[m] || ''}" placeholder="0,00"/></label>`).join('')}
          </div>
          <label class="campo" id="boleto-venc-wrap" style="${venda.pagamentos.boleto > 0 ? '' : 'display:none'}">
            <span>Vencimento do boleto</span>
            <input id="boleto-venc" class="input" type="date" value="${venda.boletoVenc}"/>
          </label>
          <div class="pg-resumo">
            <div class="cp-row"><span>Pago</span><span id="pg-pago">${UI().money(0)}</span></div>
            <div class="cp-row pg-aberto-row"><span>Parcial em aberto</span><span id="pg-aberto">${UI().money(total)}</span></div>
          </div>
          ${venda.cliente_id === 'AVULSO' ? '<p class="aviso">Venda avulsa: o parcial em aberto não é registrado como saldo (sem cliente).</p>' : ''}
        </section>
        <div class="fluxo-rodape">
          <button id="voltar" class="btn btn-ghost btn-grande">← Voltar</button>
          <button id="confirmar" class="btn btn-primary btn-grande">Confirmar venda</button>
        </div>
      </div>`;

    main.querySelectorAll('.pg-input').forEach((inp) => inp.oninput = () => {
      const m = inp.dataset.mod;
      venda.pagamentos[m] = parseFloat(inp.value) || 0;
      if (m === 'boleto') {
        main.querySelector('#boleto-venc-wrap').style.display = venda.pagamentos.boleto > 0 ? '' : 'none';
      }
      atualizarResumoPagamento();
    });
    const venc = main.querySelector('#boleto-venc');
    if (venc) venc.onchange = (e) => { venda.boletoVenc = e.target.value; };
    main.querySelector('#voltar').onclick = () => { venda.step = 'montar'; pintar(); };
    main.querySelector('#confirmar').onclick = confirmarVenda;
    atualizarResumoPagamento();
  }

  function atualizarResumoPagamento() {
    const total = totalItens();
    const pago = totalPago();
    const aberto = arred(total - pago);
    main.querySelector('#pg-pago').textContent = UI().money(pago);
    const abEl = main.querySelector('#pg-aberto');
    abEl.textContent = UI().money(aberto);
    abEl.parentElement.classList.toggle('pg-aberto-pos', aberto > 0.005);
    abEl.parentElement.classList.toggle('pg-aberto-neg', aberto < -0.005);
  }

  // ---- Gravação ------------------------------------------------------
  async function confirmarVenda() {
    const btn = main.querySelector('#confirmar');
    btn.disabled = true;
    const db = UI().db();
    const editando = !!venda.editId;
    try {
      const cliente_id = venda.cliente_id === 'AVULSO' ? null : venda.cliente_id;
      const itens = venda.itens.map((i) => ({
        produto_id: i.produto_id, quantidade: i.quantidade, preco_unit: i.preco_unit,
        valor: arred(i.quantidade * i.preco_unit)
      }));
      const pagamentos = MOD_ORDEM
        .filter((m) => (Number(venda.pagamentos[m]) || 0) > 0)
        .map((m) => ({
          modalidade: m, valor: arred(venda.pagamentos[m]),
          vencimento: m === 'boleto' && venda.boletoVenc ? venda.boletoVenc : null
        }));

      // Gravação ATÔMICA no servidor (pedido + itens + pagamentos numa transação).
      // Os triggers recalculam total e saldo; aqui só lemos o resultado.
      const { data, error } = await db.rpc('salvar_venda', {
        p_pedido_id: venda.editId,         // null = nova venda
        p_vendedor_id: venda.vendedor_id,
        p_cliente_id: cliente_id,
        p_observacao: venda.observacao || null,
        p_itens: itens,
        p_pagamentos: pagamentos
      });
      if (error) throw error;

      if (cliente_id && data.saldo != null) {
        const cc = cache.clientes.find((x) => x.id === cliente_id);
        if (cc) cc.saldo_devedor = Number(data.saldo);
      }
      venda.resultado = {
        numero: data.numero, total: Number(data.total), data: data.data,
        saldo: data.saldo != null ? Number(data.saldo) : null, editado: editando
      };
      venda.step = 'ok';
      pintar();
    } catch (err) {
      UI().erro('Não foi possível gravar a venda', err);
      btn.disabled = false;
    }
  }

  // ===================== PASSO 3: CONFIRMAÇÃO ========================
  function pintarOk() {
    const r = venda.resultado;
    const cliente = clienteAtual();
    const pago = totalPago();
    const aberto = arred(r.total - pago);
    main.innerHTML = `
      <div class="fluxo">
        <div class="ok-box card">
          <div class="ok-check">✓</div>
          <h2>Venda nº ${r.numero} ${r.editado ? 'atualizada' : 'registrada'}</h2>
          <div class="ok-total">${UI().money(r.total)}</div>
          <div class="ok-detalhes">
            <div class="cp-row"><span>Cliente</span><span>${UI().esc(cliente ? cliente.nome : 'Avulso')}</span></div>
            <div class="cp-row"><span>Pago</span><span>${UI().money(pago)}</span></div>
            ${aberto > 0.005 ? `<div class="cp-row cp-aberto"><span>Parcial em aberto</span><span>${UI().money(aberto)}</span></div>` : ''}
            ${r.saldo != null ? `<div class="cp-row cp-saldo"><span>Saldo devedor atualizado</span><span>${saldoBadge(r.saldo)}</span></div>` : ''}
          </div>
          <div class="ok-acoes">
            <button id="imprimir" class="btn btn-primary btn-grande">🖨 Imprimir cupom</button>
            <button id="nova" class="btn btn-ghost btn-grande">Nova venda</button>
          </div>
        </div>
      </div>`;
    main.querySelector('#imprimir').onclick = () => AGB.cupom.imprimir(dadosCupom());
    main.querySelector('#nova').onclick = () => { novaVenda(); pintar(); };
  }

  function dadosCupom() {
    const r = venda.resultado;
    const cliente = clienteAtual();
    const pago = totalPago();
    return {
      tipo: 'VENDA',
      numero: r.numero, data: r.data,
      contraparteLabel: 'Cliente',
      contraparteNome: cliente ? cliente.nome : 'Avulso',
      vendedor: (cache.vendedores.find((v) => v.id === venda.vendedor_id) || {}).nome,
      itens: venda.itens.map((i) => ({ ...i, valor: arred(i.quantidade * i.preco_unit) })),
      total: r.total,
      pagamentos: MOD_ORDEM.map((m) => ({
        modalidade: m, valor: venda.pagamentos[m],
        vencimento: m === 'boleto' && venda.boletoVenc ? venda.boletoVenc : null
      })),
      emAberto: arred(r.total - pago),
      saldoLabel: 'Saldo devedor',
      saldo: r.saldo,
      observacao: venda.observacao
    };
  }

  // ---- Helpers -------------------------------------------------------
  function clienteAtual() {
    if (!venda || venda.cliente_id === '' || venda.cliente_id === 'AVULSO') return null;
    return cache.clientes.find((c) => c.id === venda.cliente_id) || null;
  }
  function saldoBadge(v) {
    v = Number(v) || 0;
    if (Math.abs(v) < 0.005) return '<span class="saldo saldo-zero">Em dia</span>';
    if (v > 0) return `<span class="saldo saldo-deve">Deve ${UI().money(v)}</span>`;
    return `<span class="saldo saldo-credito">Crédito ${UI().money(-v)}</span>`;
  }
  function etapasHTML(n) {
    const passos = ['Itens', 'Pagamento', 'Pronto'];
    return `<div class="passos">${passos.map((p, i) =>
      `<span class="passo ${i + 1 === n ? 'ativo' : ''} ${i + 1 < n ? 'feito' : ''}">${i + 1}. ${p}</span>`).join('')}</div>`;
  }

  // Recarrega cadastros ao reentrar na tela (clientes/produtos podem ter mudado)
  window.addEventListener('hashchange', () => {
    if ((location.hash || '').includes('vendas')) cache.carregado = false;
  });

  window.AGB.registerView('vendas', render);
})();
