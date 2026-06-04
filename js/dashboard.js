/* =====================================================================
 * Agro Bras Hortifruti — Tela inicial / Dashboard (Etapa 4)
 * Totais do DIA:
 *  - Vendas por modalidade (+ parcial em aberto calculado)
 *  - Compras por modalidade (+ parcial em aberto calculado)
 *  - Saldo do dia (total de vendas − total de compras)
 *  - Quantidade de pedidos de venda e de compra
 *
 * "Parcial em aberto" é categoria CALCULADA (total − pagamentos),
 * nunca uma linha de pagamento — conforme regra do projeto.
 * ===================================================================== */
(function () {
  const UI = () => window.AGB.ui;
  const MOD_ORDEM = ['dinheiro', 'pix', 'cartao', 'boleto'];
  const MOD_LABEL = { dinheiro: 'Dinheiro', pix: 'Pix', cartao: 'Cartão', boleto: 'Boleto' };

  let main = null;

  function intervaloHoje() {
    const n = new Date();
    const ini = new Date(n.getFullYear(), n.getMonth(), n.getDate());
    const fim = new Date(n.getFullYear(), n.getMonth(), n.getDate() + 1);
    return { ini: ini.toISOString(), fim: fim.toISOString() };
  }

  async function carregarLado(tabelaPedido, tabelaPag, { ini, fim }) {
    const db = UI().db();
    const { data: pedidos, error } = await db.from(tabelaPedido)
      .select('id,total').gte('data', ini).lt('data', fim);
    if (error) throw error;
    const total = (pedidos || []).reduce((s, p) => s + Number(p.total), 0);
    const ids = (pedidos || []).map((p) => p.id);

    const mods = { dinheiro: 0, pix: 0, cartao: 0, boleto: 0 };
    if (ids.length) {
      const { data: pags, error: e2 } = await db.from(tabelaPag)
        .select('modalidade,valor').in('pedido_id', ids);
      if (e2) throw e2;
      (pags || []).forEach((p) => { mods[p.modalidade] = (mods[p.modalidade] || 0) + Number(p.valor); });
    }
    const pago = MOD_ORDEM.reduce((s, m) => s + mods[m], 0);
    const aberto = total - pago;
    return { qtd: (pedidos || []).length, total, mods, aberto };
  }

  async function render(el) {
    main = el;
    main.innerHTML = `<div class="muted" style="padding:18px">Carregando totais do dia...</div>`;
    let v, c;
    try {
      const hoje = intervaloHoje();
      [v, c] = await Promise.all([
        carregarLado('pedidos_venda', 'pagamentos_venda', hoje),
        carregarLado('pedidos_compra', 'pagamentos_compra', hoje)
      ]);
    } catch (err) { UI().erro('Falha ao carregar o resumo do dia', err); return; }

    const saldoDia = v.total - c.total;
    main.innerHTML = `
      <div class="dash">
        <div class="dash-head">
          <h2>Resumo de hoje</h2>
          <div class="dash-data">${UI().dataCurta(new Date().toISOString())}
            <button id="dash-refresh" class="btn btn-sm btn-ghost" title="Atualizar">↻</button></div>
        </div>

        <div class="stat-row">
          <div class="stat-card stat-venda">
            <div class="stat-rotulo">Vendas do dia</div>
            <div class="stat-valor">${UI().money(v.total)}</div>
            <div class="stat-sub">${v.qtd} pedido${v.qtd === 1 ? '' : 's'}</div>
          </div>
          <div class="stat-card stat-compra">
            <div class="stat-rotulo">Compras do dia</div>
            <div class="stat-valor">${UI().money(c.total)}</div>
            <div class="stat-sub">${c.qtd} pedido${c.qtd === 1 ? '' : 's'}</div>
          </div>
          <div class="stat-card ${saldoDia >= 0 ? 'stat-saldo-pos' : 'stat-saldo-neg'}">
            <div class="stat-rotulo">Saldo do dia</div>
            <div class="stat-valor">${UI().money(saldoDia)}</div>
            <div class="stat-sub">vendas − compras</div>
          </div>
        </div>

        <div class="dash-cols">
          ${blocoModalidade('Vendas por modalidade', v)}
          ${blocoModalidade('Compras por modalidade', c)}
        </div>

        <div class="dash-atalhos">
          <a class="btn btn-primary btn-grande" href="#/vendas">+ Nova venda</a>
          <a class="btn btn-ghost btn-grande" href="#/compras">+ Nova compra</a>
          <button id="dash-backup" class="btn btn-ghost btn-grande">⬇ Exportar backup</button>
        </div>
      </div>`;

    main.querySelector('#dash-refresh').onclick = () => render(main);
    main.querySelector('#dash-backup').onclick = exportarBackup;
  }

  // ---- Backup: baixa todos os dados em um arquivo JSON ---------------
  const TABELAS_BACKUP = [
    'clientes', 'fornecedores', 'vendedores', 'produtos',
    'pedidos_venda', 'itens_venda', 'pagamentos_venda',
    'pedidos_compra', 'itens_compra', 'pagamentos_compra', 'ajustes_saldo'
  ];

  async function exportarBackup() {
    const btn = main.querySelector('#dash-backup');
    btn.disabled = true; btn.textContent = 'Exportando...';
    try {
      const db = UI().db();
      const dump = { app: 'Agro Bras Hortifruti', exportado_em: new Date().toISOString(), tabelas: {} };
      for (const t of TABELAS_BACKUP) {
        const { data, error } = await db.from(t).select('*');
        if (error) throw error;
        dump.tabelas[t] = data || [];
      }
      const totalLinhas = Object.values(dump.tabelas).reduce((s, a) => s + a.length, 0);
      const blob = new Blob([JSON.stringify(dump, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const d = new Date();
      const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}_${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
      a.href = url; a.download = `agrobras-backup-${stamp}.json`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      UI().toast(`Backup gerado (${totalLinhas} registros).`);
    } catch (err) {
      UI().erro('Falha ao exportar backup', err);
    } finally {
      btn.disabled = false; btn.textContent = '⬇ Exportar backup';
    }
  }

  function blocoModalidade(titulo, dados) {
    const linhas = MOD_ORDEM.map((m) => `
      <div class="cp-row mod-linha"><span>${MOD_LABEL[m]}</span><span>${UI().money(dados.mods[m])}</span></div>`).join('');
    const abertoLinha = `
      <div class="cp-row mod-linha mod-aberto"><span>Parcial em aberto</span><span>${UI().money(dados.aberto)}</span></div>`;
    return `
      <section class="card bloco">
        <h3 class="bloco-titulo">${titulo}</h3>
        ${linhas}
        ${abertoLinha}
        <div class="cp-row mod-total"><span>Total</span><span>${UI().money(dados.total)}</span></div>
      </section>`;
  }

  window.AGB.registerView('inicio', render);
})();
