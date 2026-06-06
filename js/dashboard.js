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
    let v, c, saldos, ultimos;
    try {
      const hoje = intervaloHoje();
      [v, c, saldos, ultimos] = await Promise.all([
        carregarLado('pedidos_venda', 'pagamentos_venda', hoje),
        carregarLado('pedidos_compra', 'pagamentos_compra', hoje),
        carregarSaldos(),
        carregarUltimos()
      ]);
    } catch (err) {
      console.error('[Agro Bras] Falha ao carregar o resumo do dia', err);
      UI().errorCard(main, 'Não foi possível carregar o resumo do dia. Verifique a conexão e tente de novo.', () => render(main));
      return;
    }

    const saldoDia = v.total - c.total;
    // Caixa recebido hoje = só o que entrou de fato (dinheiro+pix+cartão); boleto e parcial em aberto NÃO entram.
    const caixaHoje = v.mods.dinheiro + v.mods.pix + v.mods.cartao;
    const agora = new Date();
    const atualizadoEm = agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    main.innerHTML = `
      <div class="dash">
        <div class="dash-head">
          <h2>Resumo de hoje</h2>
          <div class="dash-data">${UI().dataCurta(new Date().toISOString())}
            <span class="dash-atualizado">· atualizado às ${atualizadoEm}</span>
            <button id="dash-refresh" class="btn btn-sm btn-ghost" title="Atualizar" aria-label="Atualizar resumo">↻</button></div>
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

        <div class="fin-row">
          <div class="fin-card fin-caixa">
            <div class="stat-rotulo">Caixa recebido hoje</div>
            <div class="fin-valor">${UI().money(caixaHoje)}</div>
            <div class="stat-sub">dinheiro + pix + cartão</div>
          </div>
          <div class="fin-card fin-receber">
            <div class="stat-rotulo">A receber (fiado)</div>
            <div class="fin-valor">${UI().money(saldos.aReceber)}</div>
            <div class="stat-sub">saldo devedor de clientes</div>
          </div>
          <div class="fin-card fin-pagar">
            <div class="stat-rotulo">A pagar (fornecedores)</div>
            <div class="fin-valor">${UI().money(saldos.aPagar)}</div>
            <div class="stat-sub">saldo em aberto</div>
          </div>
        </div>

        <div class="dash-cols">
          ${blocoModalidade('Vendas por modalidade', v)}
          ${blocoModalidade('Compras por modalidade', c)}
        </div>

        ${blocoUltimos(ultimos)}

        <div class="dash-atalhos">
          <a class="btn btn-primary btn-grande" href="#/vendas">+ Nova venda</a>
          <a class="btn btn-ghost btn-grande" href="#/compras">+ Nova compra</a>
        </div>

        <div class="dash-foot">
          <button id="dash-backup" class="dash-foot-link">⬇ Exportar backup (.json)</button>
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
      btn.disabled = false; btn.textContent = '⬇ Exportar backup (.json)';
    }
  }

  // ---- A receber (clientes) / A pagar (fornecedores) ----------------
  async function carregarSaldos() {
    const db = UI().db();
    const [cl, fo] = await Promise.all([
      db.from('clientes').select('saldo_devedor'),
      db.from('fornecedores').select('saldo_aberto')
    ]);
    if (cl.error) throw cl.error;
    if (fo.error) throw fo.error;
    const aReceber = (cl.data || []).reduce((s, x) => s + Math.max(0, Number(x.saldo_devedor) || 0), 0);
    const aPagar   = (fo.data || []).reduce((s, x) => s + Math.max(0, Number(x.saldo_aberto) || 0), 0);
    return { aReceber, aPagar };
  }

  // ---- Últimas vendas (mais recentes) -------------------------------
  async function carregarUltimos() {
    const db = UI().db();
    const v = await db.from('pedidos_venda')
      .select('numero,data,total,clientes(nome)').order('data', { ascending: false }).limit(6);
    if (v.error) throw v.error;
    return (v.data || []).map((p) => ({
      tipo: 'venda', numero: p.numero, data: p.data, total: p.total,
      nome: (p.clientes && p.clientes.nome) || 'Avulso'
    }));
  }

  function blocoUltimos(lista) {
    if (!lista || !lista.length) {
      return `<section class="card bloco"><h3 class="bloco-titulo">Últimas vendas</h3>
        <div class="empty-sm">Nenhuma venda registrada ainda.</div></section>`;
    }
    const linhas = lista.map((p) => `
      <a class="ult-linha" href="#/vendas">
        <span class="ult-tag-wrap"><span class="ult-num">Nº ${p.numero}</span></span>
        <span class="ult-nome">${UI().esc(p.nome)}</span>
        <span class="ult-data muted">${UI().dataCurta(p.data)}</span>
        <span class="ult-valor">${UI().money(p.total)}</span>
      </a>`).join('');
    return `<section class="card bloco">
      <h3 class="bloco-titulo">Últimas vendas</h3>
      <div class="ult-lista">${linhas}</div>
    </section>`;
  }

  function blocoModalidade(titulo, dados) {
    const linhas = MOD_ORDEM.map((m) => `
      <div class="cp-row mod-linha"><span>${MOD_LABEL[m]}</span><span>${UI().money(dados.mods[m])}</span></div>`).join('');
    const abertoZero = Math.abs(dados.aberto) < 0.005;
    const abertoLinha = `
      <div class="cp-row mod-linha ${abertoZero ? '' : 'mod-aberto'}"><span>Parcial em aberto</span><span>${UI().money(dados.aberto)}</span></div>`;
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
