/* =====================================================================
 * Agro Bras Hortifruti — Cadastros (Etapa 1)
 * Clientes, Fornecedores, Produtos, Vendedores.
 * + Ajuste manual de saldo (débito / crédito / zeramento) para
 *   clientes e fornecedores, com saldo atualizado em tempo real.
 *
 * Regras respeitadas:
 *  - Produto: código sai da sequência do Postgres (não geramos no app).
 *  - Saldo: o app só LÊ saldo_devedor / saldo_aberto (triggers mantêm).
 *  - Zeramento: cria um ajuste que leva o saldo a zero (crédito se deve,
 *    débito se tem crédito a favor).
 * ===================================================================== */
(function () {
  const UI = () => window.AGB.ui;

  // ---- Definição de cada aba ----------------------------------------
  const ABAS = {
    clientes: {
      label: 'Clientes', tabela: 'clientes', ordem: 'nome',
      temSaldo: true, saldoCol: 'saldo_devedor', tipoEntidade: 'cliente',
      campos: [
        { key: 'nome',        label: 'Nome',        tipo: 'text',     req: true },
        { key: 'cnpj',        label: 'CNPJ / CPF',  tipo: 'text' },
        { key: 'telefone',    label: 'Telefone',    tipo: 'text' },
        { key: 'endereco',    label: 'Endereço',    tipo: 'text' },
        { key: 'observacoes', label: 'Observações', tipo: 'textarea' }
      ]
    },
    fornecedores: {
      label: 'Fornecedores', tabela: 'fornecedores', ordem: 'nome',
      temSaldo: true, saldoCol: 'saldo_aberto', tipoEntidade: 'fornecedor',
      campos: [
        { key: 'nome',        label: 'Nome',        tipo: 'text',     req: true },
        { key: 'cnpj',        label: 'CNPJ / CPF',  tipo: 'text' },
        { key: 'telefone',    label: 'Telefone',    tipo: 'text' },
        { key: 'endereco',    label: 'Endereço',    tipo: 'text' },
        { key: 'observacoes', label: 'Observações', tipo: 'textarea' }
      ]
    },
    produtos: {
      label: 'Produtos', tabela: 'produtos', ordem: 'codigo',
      temSaldo: false,
      campos: [
        { key: 'nome',    label: 'Nome',    tipo: 'text', req: true },
        { key: 'unidade', label: 'Unidade', tipo: 'text', req: true, placeholder: 'UN, KG, CX, SC, BD, PC...' },
        { key: 'ativo',   label: 'Ativo',   tipo: 'checkbox', padrao: true }
      ]
    },
    vendedores: {
      label: 'Vendedores', tabela: 'vendedores', ordem: 'nome',
      temSaldo: false,
      campos: [
        { key: 'nome',  label: 'Nome',  tipo: 'text', req: true },
        { key: 'ativo', label: 'Ativo', tipo: 'checkbox', padrao: true }
      ]
    }
  };

  const estado = { aba: 'clientes', termo: '' };
  let containerEl = null;

  // ---- Saldo (formatação/semântica) ----------------------------------
  function saldoHTML(valor) {
    const v = Number(valor) || 0;
    if (Math.abs(v) < 0.005) return `<span class="saldo saldo-zero">Em dia</span>`;
    if (v > 0) return `<span class="saldo saldo-deve">Deve ${UI().money(v)}</span>`;
    return `<span class="saldo saldo-credito">Crédito ${UI().money(-v)}</span>`;
  }

  // ---- Render da tela -----------------------------------------------
  function render(main) {
    containerEl = main;
    main.innerHTML = `
      <div class="cad">
        <nav class="subnav">
          ${Object.entries(ABAS).map(([k, a]) =>
            `<button class="subnav-tab${k === estado.aba ? ' active' : ''}" data-aba="${k}">${a.label}</button>`
          ).join('')}
        </nav>
        <div class="cad-toolbar">
          <input id="cad-busca" class="input" type="search" placeholder="Buscar..." value="${UI().esc(estado.termo)}" />
          <button id="cad-novo" class="btn btn-primary">+ Novo</button>
        </div>
        <div id="cad-lista" class="cad-lista"></div>
      </div>`;

    main.querySelectorAll('.subnav-tab').forEach((b) =>
      b.addEventListener('click', () => { estado.aba = b.dataset.aba; estado.termo = ''; render(main); }));
    const busca = main.querySelector('#cad-busca');
    busca.addEventListener('input', () => { estado.termo = busca.value; carregar(); });
    main.querySelector('#cad-novo').addEventListener('click', () => abrirForm(null));

    carregar();
  }

  // ---- Carrega e lista ----------------------------------------------
  async function carregar() {
    const aba = ABAS[estado.aba];
    const lista = containerEl.querySelector('#cad-lista');
    lista.innerHTML = `<div class="muted" style="padding:18px">Carregando...</div>`;
    let q = UI().db().from(aba.tabela).select('*').order(aba.ordem, { ascending: true });
    const { data, error } = await q;
    if (error) {
      console.error('[Agro Bras] Falha ao carregar ' + aba.label, error);
      UI().errorCard(lista, 'Não foi possível carregar ' + aba.label.toLowerCase() + '. Tente novamente.', carregar);
      return;
    }

    const termo = estado.termo.trim().toLowerCase();
    const linhas = (data || []).filter((r) => {
      if (!termo) return true;
      return (r.nome || '').toLowerCase().includes(termo) ||
             (aba.tabela === 'produtos' && String(r.codigo).includes(termo));
    });

    if (!linhas.length) {
      lista.innerHTML = `<div class="empty">Nenhum ${aba.label.toLowerCase().replace(/s$/, '')} ${termo ? 'encontrado' : 'cadastrado'}.</div>`;
      return;
    }
    lista.innerHTML = renderTabela(aba, linhas);
    lista.querySelectorAll('[data-edit]').forEach((b) =>
      b.addEventListener('click', () => abrirForm(linhas.find((x) => x.id === b.dataset.edit))));
    lista.querySelectorAll('[data-saldo]').forEach((b) =>
      b.addEventListener('click', () => abrirSaldo(linhas.find((x) => x.id === b.dataset.saldo))));
    lista.querySelectorAll('[data-del]').forEach((b) =>
      b.addEventListener('click', () => excluir(aba, linhas.find((x) => x.id === b.dataset.del))));
  }

  function renderTabela(aba, linhas) {
    const cab = [];
    if (aba.tabela === 'produtos') cab.push('Código');
    cab.push('Nome');
    if (aba.tabela === 'produtos') cab.push('Unidade');
    if (aba.temSaldo) cab.push('Telefone', 'Saldo');
    if (aba.campos.some((c) => c.key === 'ativo')) cab.push('Ativo');
    cab.push('');

    const linhasHTML = linhas.map((r) => {
      const cels = [];
      if (aba.tabela === 'produtos') cels.push(`<td class="td-codigo" data-label="Código">${r.codigo}</td>`);
      cels.push(`<td class="td-nome" data-label="Nome">${UI().esc(r.nome)}</td>`);
      if (aba.tabela === 'produtos') cels.push(`<td data-label="Unidade">${UI().esc(r.unidade)}</td>`);
      if (aba.temSaldo) {
        cels.push(`<td data-label="Telefone">${UI().esc(r.telefone || '—')}</td>`);
        cels.push(`<td data-label="Saldo">${saldoHTML(r[aba.saldoCol])}</td>`);
      }
      if (aba.campos.some((c) => c.key === 'ativo'))
        cels.push(`<td data-label="Status">${r.ativo ? '<span class="badge badge-on">Ativo</span>' : '<span class="badge badge-off">Inativo</span>'}</td>`);
      const acoes = [
        `<button class="btn btn-sm btn-ghost" data-edit="${r.id}">Editar</button>`,
        aba.temSaldo ? `<button class="btn btn-sm btn-ghost" data-saldo="${r.id}">Saldo</button>` : '',
        `<button class="btn btn-sm btn-ghost btn-del" data-del="${r.id}">Excluir</button>`
      ].join('');
      cels.push(`<td class="td-acoes">${acoes}</td>`);
      return `<tr>${cels.join('')}</tr>`;
    }).join('');

    return `<table class="tabela">
      <thead><tr>${cab.map((c) => `<th>${c}</th>`).join('')}</tr></thead>
      <tbody>${linhasHTML}</tbody>
    </table>`;
  }

  // ---- Form de criação / edição -------------------------------------
  function abrirForm(reg) {
    const aba = ABAS[estado.aba];
    const editando = !!reg;
    const campos = aba.campos.map((c) => {
      const val = editando ? reg[c.key] : (c.padrao !== undefined ? c.padrao : '');
      if (c.tipo === 'textarea')
        return `<label class="campo"><span>${c.label}</span>
          <textarea name="${c.key}" rows="2">${UI().esc(val || '')}</textarea></label>`;
      if (c.tipo === 'checkbox')
        return `<label class="campo campo-check">
          <input type="checkbox" name="${c.key}" ${val ? 'checked' : ''}/> <span>${c.label}</span></label>`;
      return `<label class="campo"><span>${c.label}${c.req ? ' *' : ''}</span>
        <input class="input" name="${c.key}" type="text" value="${UI().esc(val || '')}"
          ${c.placeholder ? `placeholder="${c.placeholder}"` : ''} ${c.req ? 'required' : ''}/></label>`;
    }).join('');

    const infoCodigo = (aba.tabela === 'produtos' && editando)
      ? `<p class="muted" style="margin:0 0 4px">Código <strong>${reg.codigo}</strong> (gerado pelo sistema)</p>` : '';

    const m = UI().openModal({
      titulo: (editando ? 'Editar ' : 'Novo ') + aba.label.replace(/s$/, '').toLowerCase(),
      largura: '460px',
      corpo: `<form id="cad-form">${infoCodigo}${campos}
        <div class="form-actions">
          <button type="button" class="btn btn-ghost" data-cancel>Cancelar</button>
          <button type="submit" class="btn btn-primary">Salvar</button>
        </div></form>`
    });

    const form = m.body.querySelector('#cad-form');
    form.querySelector('[data-cancel]').onclick = m.close;
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const payload = {};
      for (const c of aba.campos) {
        if (c.tipo === 'checkbox') payload[c.key] = form.elements[c.key].checked;
        else {
          const v = form.elements[c.key].value.trim();
          if (c.req && !v) { UI().toast(c.label + ' é obrigatório.', 'erro'); return; }
          payload[c.key] = v || null;
        }
      }
      const btn = form.querySelector('[type="submit"]');
      btn.disabled = true;
      try {
        const db = UI().db();
        const resp = editando
          ? await db.from(aba.tabela).update(payload).eq('id', reg.id)
          : await db.from(aba.tabela).insert(payload);
        if (resp.error) throw resp.error;
        UI().toast(editando ? 'Atualizado.' : 'Cadastrado.');
        m.close();
        carregar();
      } catch (err) { UI().erro('Não foi possível salvar', err); btn.disabled = false; }
    });
    setTimeout(() => form.querySelector('input,textarea')?.focus(), 50);
  }

  // ---- Excluir -------------------------------------------------------
  // Mapeamento tabela → tabela de pedidos + coluna FK
  const PEDIDOS_FK = {
    clientes:      { tabela: 'pedidos_venda',   coluna: 'cliente_id' },
    fornecedores:  { tabela: 'pedidos_compra',  coluna: 'fornecedor_id' },
  };

  async function excluir(aba, reg) {
    const ok = await UI().confirm(`Excluir "${reg.nome}"? Esta ação não pode ser desfeita.`,
      { okLabel: 'Excluir', perigo: true });
    if (!ok) return;

    const { error } = await UI().db().from(aba.tabela).delete().eq('id', reg.id);
    if (!error) { UI().toast('Excluído.'); carregar(); return; }

    const fk = error.code === '23503' || (error.message || '').includes('violates foreign key');
    if (!fk) { UI().erro('Não foi possível excluir', error); return; }

    // Verificar se há mapeamento de pedidos para este cadastro
    const mapa = PEDIDOS_FK[aba.tabela];
    if (!mapa) {
      UI().toast(`"${reg.nome}" está em uso e não pode ser excluído.`, 'erro');
      return;
    }

    // Contar quantos pedidos serão apagados junto
    const db = UI().db();
    const { count } = await db.from(mapa.tabela).select('id', { count: 'exact', head: true }).eq(mapa.coluna, reg.id);
    const qtd = count || 0;

    const forcar = await UI().confirm(
      `"${reg.nome}" possui ${qtd} pedido${qtd !== 1 ? 's' : ''} vinculado${qtd !== 1 ? 's' : ''}.\n\nAo confirmar, TODOS os pedidos e pagamentos deste cadastro serão apagados permanentemente. Esta ação não tem volta.`,
      { okLabel: `Apagar tudo (${qtd} pedido${qtd !== 1 ? 's' : ''})`, perigo: true }
    );
    if (!forcar) return;

    // Excluir pedidos (itens e pagamentos cascadeiam no banco)
    const { error: ePed } = await db.from(mapa.tabela).delete().eq(mapa.coluna, reg.id);
    if (ePed) { UI().erro('Falha ao apagar pedidos vinculados', ePed); return; }

    // Agora excluir o cadastro
    const { error: eReg } = await db.from(aba.tabela).delete().eq('id', reg.id);
    if (eReg) { UI().erro('Pedidos apagados, mas falha ao excluir cadastro', eReg); return; }

    UI().toast(`"${reg.nome}" e ${qtd} pedido${qtd !== 1 ? 's' : ''} excluídos.`);
    carregar();
  }

  // ---- Ajuste de saldo (cliente / fornecedor) -----------------------
  async function abrirSaldo(reg) {
    const aba = ABAS[estado.aba];
    const m = UI().openModal({
      titulo: 'Saldo — ' + reg.nome,
      largura: '440px',
      corpo: `
        <div class="saldo-atual">
          <span class="muted">Saldo atual</span>
          <div id="saldo-display">${saldoHTML(reg[aba.saldoCol])}</div>
        </div>
        <form id="saldo-form">
          <label class="campo"><span>Valor (R$)</span>
            <input class="input" name="valor" type="number" step="0.01" min="0.01" inputmode="decimal" required/></label>
          <label class="campo"><span>Observação</span>
            <input class="input" name="obs" type="text" placeholder="opcional"/></label>
          <div class="form-actions form-actions-3">
            <button type="button" class="btn btn-danger-soft" data-tipo="debito">+ Débito</button>
            <button type="button" class="btn btn-success-soft" data-tipo="credito">− Crédito</button>
          </div>
        </form>
        <div class="zerar-box">
          <button type="button" class="btn btn-ghost" id="btn-zerar">Zerar saldo</button>
          <span class="muted">leva o saldo a R$ 0,00</span>
        </div>
        <div class="hist-ajustes" id="hist-ajustes"></div>`
    });

    const form = m.body.querySelector('#saldo-form');
    const display = m.body.querySelector('#saldo-display');
    let saldoCorrente = Number(reg[aba.saldoCol]) || 0;

    async function refrescarSaldo() {
      const { data, error } = await UI().db().from(aba.tabela)
        .select(aba.saldoCol).eq('id', reg.id).single();
      if (!error && data) {
        saldoCorrente = Number(data[aba.saldoCol]) || 0;
        display.innerHTML = saldoHTML(saldoCorrente);
      }
      carregarHist();
      carregar(); // atualiza a lista por trás
    }

    async function carregarHist() {
      const box = m.body.querySelector('#hist-ajustes');
      const { data } = await UI().db().from('ajustes_saldo')
        .select('*').eq('tipo_entidade', aba.tipoEntidade).eq('entidade_id', reg.id)
        .order('data', { ascending: false }).limit(5);
      if (!data || !data.length) { box.innerHTML = ''; return; }
      box.innerHTML = `<div class="hist-titulo">Últimos ajustes</div>` +
        data.map((a) => `<div class="hist-linha">
          <span class="${a.tipo === 'debito' ? 'saldo-deve' : 'saldo-credito'}">
            ${a.tipo === 'debito' ? '+' : '−'} ${UI().money(a.valor)}</span>
          <span class="muted">${UI().dataCurta(a.data)}${a.observacao ? ' · ' + UI().esc(a.observacao) : ''}</span>
        </div>`).join('');
    }

    async function lancar(tipo, valor, obs) {
      if (!(valor > 0)) { UI().toast('Informe um valor maior que zero.', 'erro'); return; }
      const { error } = await UI().db().from('ajustes_saldo').insert({
        tipo_entidade: aba.tipoEntidade, entidade_id: reg.id, tipo, valor, observacao: obs || null
      });
      if (error) { UI().erro('Falha no lançamento', error); return; }
      UI().toast('Lançamento registrado.');
      form.reset();
      refrescarSaldo();
    }

    form.querySelectorAll('[data-tipo]').forEach((b) => b.onclick = () => {
      const valor = parseFloat(form.elements.valor.value);
      lancar(b.dataset.tipo, valor, form.elements.obs.value.trim());
    });

    m.body.querySelector('#btn-zerar').onclick = async () => {
      if (Math.abs(saldoCorrente) < 0.005) { UI().toast('Saldo já está zerado.'); return; }
      const ok = await UI().confirm(`Zerar o saldo de "${reg.nome}" (${UI().money(saldoCorrente)})?`,
        { okLabel: 'Zerar' });
      if (!ok) return;
      // saldo > 0 (deve) → crédito; saldo < 0 (crédito a favor) → débito
      const tipo = saldoCorrente > 0 ? 'credito' : 'debito';
      lancar(tipo, Math.abs(saldoCorrente), 'Zeramento de saldo');
    };

    carregarHist();
  }

  // ---- Registro da tela ---------------------------------------------
  window.AGB.registerView('cadastros', render);
})();
