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

  // Data local no formato YYYY-MM-DD (dia do negócio). Precisa bater com as
  // chaves do rel_fluxo, que agora agrupa em America/Sao_Paulo — usar
  // toISOString() aqui jogaria as vendas da noite para o dia seguinte (UTC).
  function ymdLocal(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  // "R$ 1.234,56" → "R$ 1.234<span class="dk-cents">,56</span>"
  function moneyHTML(n) {
    const s = UI().money(n);
    const i = s.lastIndexOf(',');
    if (i < 0) return UI().esc(s);
    return UI().esc(s.slice(0, i)) + '<span class="dk-cents">' + UI().esc(s.slice(i)) + '</span>';
  }

  async function carregarLado(tipo, { ini, fim }) {
    // Agregação no servidor (RPC rel_transacao, sem lista) — imune ao limite
    // de 1000 linhas do PostgREST mesmo num dia de movimento pesado.
    const { data, error } = await UI().db().rpc('rel_transacao', {
      p_tipo: tipo, p_ini: ini, p_fim: fim,
      p_contra: null, p_vend: null, p_forma: null, p_lista_limit: 0
    });
    if (error) throw error;
    const r = data || {}; const m = r.mods || {};
    return {
      qtd: Number(r.qtd) || 0,
      total: Number(r.total) || 0,
      mods: {
        dinheiro: Number(m.dinheiro) || 0, pix: Number(m.pix) || 0,
        cartao: Number(m.cartao) || 0, boleto: Number(m.boleto) || 0
      },
      aberto: Number(r.aberto) || 0
    };
  }

  async function carregarSaldos() {
    const db = UI().db();
    const { data, error } = await db.from('clientes').select('nome,saldo_devedor');
    if (error) throw error;
    const devedores = (data || [])
      .map(x => ({ nome: x.nome, saldo: Math.max(0, Number(x.saldo_devedor) || 0) }))
      .filter(x => x.saldo > 0.005)
      .sort((a, b) => b.saldo - a.saldo);
    const aReceber = devedores.reduce((s, x) => s + x.saldo, 0);
    return { aReceber, qtdDevedores: devedores.length, maior: devedores[0] || null };
  }

  // Fiado recebido no dia (crédito COM forma de pagamento). Só dinheiro/pix/
  // cartão contam como caixa (boleto não é caixa imediato). Best-effort: se a
  // coluna `modalidade` ainda não existe (pré-migração), devolve 0.
  async function carregarRecebidoFiado({ ini, fim }) {
    try {
      const { data, error } = await UI().db().from('ajustes_saldo')
        .select('valor,modalidade')
        .eq('tipo_entidade', 'cliente').eq('tipo', 'credito')
        .in('modalidade', ['dinheiro', 'pix', 'cartao'])
        .gte('data', ini).lt('data', fim);
      if (error) throw error;
      return { total: (data || []).reduce((s, x) => s + (Number(x.valor) || 0), 0) };
    } catch (_) {
      return { total: 0 };
    }
  }

  async function carregarUltimos() {
    const db = UI().db();
    const { data, error } = await db.from('pedidos_venda')
      .select('numero,data,total,clientes(nome)').order('data', { ascending: false }).limit(7);
    if (error) throw error;
    return (data || []).map(p => ({
      numero: p.numero, data: p.data, total: p.total,
      nome: (p.clientes && p.clientes.nome) || 'Avulso'
    }));
  }

  async function carregarFluxo7Dias() {
    const hoje = new Date();
    const sete = new Date(hoje); sete.setDate(hoje.getDate() - 6); sete.setHours(0, 0, 0, 0);
    const fim = new Date(hoje); fim.setDate(hoje.getDate() + 1); fim.setHours(0, 0, 0, 0);
    // Soma por dia no servidor (RPC rel_fluxo) — antes baixava 7 dias de
    // pedidos (1750+ no volume pesado) e capava em 1000 linhas.
    const { data, error } = await UI().db().rpc('rel_fluxo', {
      p_ini: sete.toISOString(), p_fim: fim.toISOString()
    });
    if (error) throw error;
    const vMap = (data && data.vendas) || {};
    const cMap = (data && data.compras) || {};
    const dias = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(hoje); d.setDate(hoje.getDate() - i);
      dias.push(ymdLocal(d));
    }
    const vendas = dias.map(d => Number(vMap[d]) || 0);
    const compras = dias.map(d => Number(cMap[d]) || 0);
    return { dias, vendas, compras, totalVendas: vendas.reduce((s, v) => s + v, 0) };
  }

  function svgLine(vals, W, H, padT) {
    padT = padT || 6;
    if (!vals || vals.length < 2) return '';
    const max = Math.max.apply(null, vals.concat([0.01]));
    return vals.map(function (v, i) {
      const x = Math.round((i / (vals.length - 1)) * W);
      const y = Math.round(padT + (1 - v / max) * (H - padT));
      return (i === 0 ? 'M' : 'L') + x + ',' + y;
    }).join(' ');
  }
  function svgArea(vals, W, H, padT) {
    const l = svgLine(vals, W, H, padT);
    return l ? l + ' L' + W + ',' + H + ' L0,' + H + ' Z' : '';
  }

  function etiquetas7() {
    const nomes = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
    const h = new Date().getDay();
    const r = [];
    for (let i = 6; i > 0; i--) r.push(nomes[(h - i + 7) % 7]);
    r.push('Hoje');
    return r;
  }

  function iniciais(nome) {
    const p = (nome || '').trim().split(/\s+/);
    if (!p.length || !p[0]) return '?';
    if (p.length === 1) return p[0].slice(0, 2).toUpperCase();
    return (p[0][0] + p[p.length - 1][0]).toUpperCase();
  }

  function pct(a, b) { return b > 0 ? Math.round(a / b * 100) : 0; }

  function blocoModal(dados, cor) {
    const tot = dados.total || 0.001;
    const rows = MOD_ORDEM.map(function (m) {
      return '<div class="dk-mrow">' +
        '<span class="dk-mname">' + MOD_LABEL[m] + '</span>' +
        '<div class="dk-bar"><span style="width:' + pct(dados.mods[m], tot) + '%;background:' + cor + '"></span></div>' +
        '<span class="dk-mval num">' + UI().money(dados.mods[m]) + '</span>' +
        '</div>';
    }).join('');
    const abertoZero = Math.abs(dados.aberto) < 0.005;
    const abertoRow = '<div class="dk-mrow">' +
      '<span class="dk-mname">Parcial</span>' +
      '<div class="dk-bar"></div>' +
      '<span class="dk-mval num"' + (abertoZero ? '' : ' style="color:var(--negative)"') + '>' + UI().money(dados.aberto) + '</span>' +
      '</div>';
    return rows + abertoRow;
  }

  async function render(el) {
    main = el;
    main.innerHTML = '<div style="padding:20px" class="muted">Carregando...</div>';
    let v, c, saldos, ultimos, fluxo, recebido;
    try {
      const hoje = intervaloHoje();
      [v, c, saldos, ultimos, fluxo, recebido] = await Promise.all([
        carregarLado('venda', hoje),
        carregarLado('compra', hoje),
        carregarSaldos(),
        carregarUltimos(),
        carregarFluxo7Dias(),
        carregarRecebidoFiado(hoje)
      ]);
    } catch (err) {
      console.error('[Agro Bras] Falha ao carregar o resumo do dia', err);
      UI().errorCard(main, 'Não foi possível carregar o resumo do dia. Verifique a conexão e tente de novo.', () => render(main));
      return;
    }

    const saldoDia = v.total - c.total;
    const caixaVendas = v.mods.dinheiro + v.mods.pix + v.mods.cartao;
    const recebidoFiado = recebido.total;
    const caixaHoje = caixaVendas + recebidoFiado;  // dinheiro que entrou hoje
    const agora = new Date();
    const horaAtual = agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const dataHoje = UI().dataCurta(new Date().toISOString());
    const W = 300, H = 118;
    const lV = svgLine(fluxo.vendas, W, H), aV = svgArea(fluxo.vendas, W, H);
    const lC = svgLine(fluxo.compras, W, H);
    const spV = svgLine(fluxo.vendas, 108, 46, 6);
    const spC = svgLine(fluxo.compras, 108, 46, 6);
    const labels = etiquetas7();
    const pctCaixa = pct(caixaVendas, v.total);  // liquidação das vendas do dia (sem o fiado)

    const filasUltimos = ultimos.length
      ? ultimos.map(function (p) {
        return '<a class="dk-orow" href="#/vendas">' +
          '<span class="dk-tag venda">Venda</span>' +
          '<span class="dk-onum num">Nº ' + p.numero + '</span>' +
          '<div class="dk-oclient"><span class="dk-oav">' + iniciais(p.nome) + '</span>' +
            '<span class="dk-oname">' + UI().esc(p.nome) + '</span></div>' +
          '<span class="dk-odate">' + UI().dataCurta(p.data) + '</span>' +
          '<span class="dk-oval num">' + UI().money(p.total) + '</span>' +
          '<span class="dk-ochev"><i data-lucide="chevron-right"></i></span>' +
          '</a>';
      }).join('')
      : '<div class="empty">Nenhuma venda registrada ainda.</div>';

    // "a receber" — barra = participação do maior devedor no total
    const pctMaior = saldos.maior ? pct(saldos.maior.saldo, saldos.aReceber) : 0;

    main.innerHTML = `
<div class="dk-wrap">
  <div class="dk-sec-head">
    <h2>Resumo de hoje</h2>
    <div class="dk-sec-meta">
      <span class="dk-pulse"></span>
      <span>${dataHoje} · atualizado às ${horaAtual}</span>
      <button class="dk-refresh" id="dash-refresh" title="Atualizar"><i data-lucide="rotate-cw"></i></button>
    </div>
  </div>

  <div class="dk-grid">
    <div class="dk-main">

      <div class="dk-kpi-grid">
        <div class="dk-card dk-kpi dk-hero dk-t-green">
          <div class="dk-top"><div class="dk-ico"><i data-lucide="trending-up"></i></div><span class="dk-kpi-label">Vendas do dia</span></div>
          <div class="dk-kpi-val num">${moneyHTML(v.total)}</div>
          <div class="dk-kpi-foot">${v.qtd} pedido${v.qtd === 1 ? '' : 's'} hoje</div>
          ${spV ? `<svg class="dk-spark" viewBox="0 0 108 46" preserveAspectRatio="none"><path d="${spV}" fill="none" stroke="rgba(255,255,255,.55)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>` : ''}
        </div>
        <div class="dk-card dk-kpi dk-t-blue">
          <div class="dk-top"><div class="dk-ico"><i data-lucide="truck"></i></div><span class="dk-kpi-label">Compras do dia</span></div>
          <div class="dk-kpi-val num">${moneyHTML(c.total)}</div>
          <div class="dk-kpi-foot">${c.qtd} pedido${c.qtd === 1 ? '' : 's'} hoje</div>
          ${spC ? `<svg class="dk-spark" viewBox="0 0 108 46" preserveAspectRatio="none"><path d="${spC}" fill="none" stroke="rgba(42,111,184,.4)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>` : ''}
        </div>
        <div class="dk-card dk-kpi dk-t-slate">
          <div class="dk-top"><div class="dk-ico"><i data-lucide="scale"></i></div><span class="dk-kpi-label">Saldo do dia</span></div>
          <div class="dk-kpi-val num" style="color:${saldoDia >= 0 ? 'var(--positive)' : 'var(--negative)'}">${moneyHTML(saldoDia)}</div>
          <div class="dk-kpi-foot">vendas − compras</div>
        </div>
      </div>

      <div class="dk-mod-grid">
        <div class="dk-card dk-panel">
          <div class="dk-panel-head">
            <div class="dk-pico" style="background:var(--brand-soft);color:var(--brand-600)"><i data-lucide="arrow-down-left"></i></div>
            <h3>Vendas por modalidade</h3>
            <span class="dk-panel-tot num">${UI().money(v.total)}</span>
          </div>
          ${blocoModal(v, 'var(--brand)')}
          <div class="dk-mtotal"><span class="dk-mt-l">Total</span><span class="dk-mt-v num">${UI().money(v.total)}</span></div>
        </div>
        <div class="dk-card dk-panel">
          <div class="dk-panel-head">
            <div class="dk-pico" style="background:var(--info-soft);color:var(--info)"><i data-lucide="arrow-up-right"></i></div>
            <h3>Compras por modalidade</h3>
            <span class="dk-panel-tot num">${UI().money(c.total)}</span>
          </div>
          ${blocoModal(c, 'var(--info)')}
          <div class="dk-mtotal"><span class="dk-mt-l">Total</span><span class="dk-mt-v num">${UI().money(c.total)}</span></div>
        </div>
      </div>

      <div class="dk-card dk-orders">
        <div class="dk-ohead"><h3>Últimas vendas</h3></div>
        ${filasUltimos}
        <div class="dk-ofoot"><a href="#/relatorios">Ver relatório completo <i data-lucide="arrow-right"></i></a></div>
      </div>

    </div>

    <aside class="dk-rail">
      <div class="dk-card dk-fin">
        <div class="dk-fin-top">
          <div class="dk-fin-ico" style="background:var(--brand-soft);color:var(--brand-600)"><i data-lucide="wallet"></i></div>
          <div><div class="dk-fin-lbl">Caixa recebido hoje</div><div class="dk-fin-sub">vendas à vista + fiado recebido</div></div>
        </div>
        <div class="dk-fin-val num" style="color:var(--brand-600)">${UI().money(caixaHoje)}</div>
        ${recebidoFiado > 0.005 ? `<div class="dk-fin-meta" style="margin-top:6px"><span>Vendas à vista</span><span class="num">${UI().money(caixaVendas)}</span></div>
        <div class="dk-fin-meta"><span style="color:var(--brand-600)">Fiado recebido hoje</span><span class="num" style="color:var(--brand-600)">${UI().money(recebidoFiado)}</span></div>` : ''}
        ${v.total > 0 ? `<div class="dk-fin-bar"><span style="width:${pctCaixa}%;background:var(--brand)"></span></div>
        <div class="dk-fin-meta"><span>${pctCaixa}% das vendas liquidadas</span></div>` : ''}
      </div>

      <div class="dk-card dk-fin">
        <div class="dk-fin-top">
          <div class="dk-fin-ico" style="background:var(--warn-soft);color:var(--warn2)"><i data-lucide="hand-coins"></i></div>
          <div><div class="dk-fin-lbl">A receber (fiado)</div><div class="dk-fin-sub">saldo devedor de clientes</div></div>
        </div>
        <div class="dk-fin-val num" style="color:var(--warn2)">${UI().money(saldos.aReceber)}</div>
        ${saldos.qtdDevedores > 0 ? `<div class="dk-fin-bar"><span style="width:${pctMaior}%;background:var(--warn2)"></span></div>
        <div class="dk-fin-meta"><span>${saldos.qtdDevedores} cliente${saldos.qtdDevedores === 1 ? '' : 's'} em aberto</span><span style="color:var(--warn2)">${saldos.maior ? UI().esc(saldos.maior.nome) + ' · maior' : ''}</span></div>` : ''}
      </div>

      <div class="dk-card dk-flow">
        <div class="dk-flow-head"><h3>Fluxo de caixa</h3><span class="dk-flow-sub">últimos 7 dias</span></div>
        <div class="dk-flow-big num">${UI().money(fluxo.totalVendas)}</div>
        <svg class="dk-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
          <defs><linearGradient id="dkGv" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="#16864A" stop-opacity=".28"/>
            <stop offset="1" stop-color="#16864A" stop-opacity="0"/>
          </linearGradient></defs>
          ${aV ? `<path d="${aV}" fill="url(#dkGv)"/>` : ''}
          ${lV ? `<path d="${lV}" fill="none" stroke="#16864A" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>` : ''}
          ${lC ? `<path d="${lC}" fill="none" stroke="#2A6FB8" stroke-width="2" stroke-dasharray="4 4" stroke-linecap="round" stroke-linejoin="round" opacity=".75"/>` : ''}
        </svg>
        <div class="dk-chart-x">${labels.map(l => `<span>${l}</span>`).join('')}</div>
        <div class="dk-legend">
          <span class="dk-li"><span class="dk-sw" style="background:var(--brand)"></span> Vendas</span>
          <span class="dk-li"><span class="dk-sw" style="background:var(--info)"></span> Compras</span>
        </div>
      </div>

      <div class="dk-card dk-quick">
        <a class="dk-qrow" href="#/vendas">
          <div class="dk-qico" style="background:var(--brand-soft);color:var(--brand-600)"><i data-lucide="plus"></i></div>
          <div><div class="dk-qt">Nova venda</div><div class="dk-qd">Registrar pedido de cliente</div></div>
          <span class="dk-qchev"><i data-lucide="chevron-right"></i></span>
        </a>
        <a class="dk-qrow dono-only" href="#/compras">
          <div class="dk-qico" style="background:var(--info-soft);color:var(--info)"><i data-lucide="truck"></i></div>
          <div><div class="dk-qt">Nova compra</div><div class="dk-qd">Entrada de fornecedor</div></div>
          <span class="dk-qchev"><i data-lucide="chevron-right"></i></span>
        </a>
        <a class="dk-qrow dono-only" href="#/cadastros">
          <div class="dk-qico" style="background:var(--warn-soft);color:var(--warn2)"><i data-lucide="hand-coins"></i></div>
          <div><div class="dk-qt">Receber fiado</div><div class="dk-qd">Baixar saldo de cliente</div></div>
          <span class="dk-qchev"><i data-lucide="chevron-right"></i></span>
        </a>
      </div>
    </aside>
  </div>
</div>`;

    const rb = main.querySelector('#dash-refresh');
    rb.onclick = () => { rb.classList.add('spin'); render(main); };
    if (window.AGB && AGB.refreshIcons) AGB.refreshIcons();
  }

  // ---- Backup (chamado pelo botão da sidebar) ---------------------------
  const TABELAS_BACKUP = [
    'clientes', 'fornecedores', 'vendedores', 'produtos',
    'pedidos_venda', 'itens_venda', 'pagamentos_venda',
    'pedidos_compra', 'itens_compra', 'pagamentos_compra', 'ajustes_saldo'
  ];

  async function exportarBackup(btn) {
    const original = btn ? btn.innerHTML : '';
    if (btn) { btn.disabled = true; btn.textContent = 'Exportando...'; }
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
      if (btn) { btn.disabled = false; btn.innerHTML = original; if (window.AGB && AGB.refreshIcons) AGB.refreshIcons(); }
    }
  }

  // ---- Restaurar backup (importar .json exportado acima) ----------------
  // Faz upsert por id, na MESMA ordem de TABELAS_BACKUP (pais antes dos
  // filhos → respeita as FKs). Registros com id igual são sobrescritos; o
  // que já existe e não está no arquivo permanece. Indicado para recuperação.
  async function importarBackup(btn) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.onchange = async () => {
      const file = input.files && input.files[0];
      if (!file) return;
      let dump;
      try { dump = JSON.parse(await file.text()); }
      catch (e) { UI().erro('Arquivo inválido (não é JSON)', e); return; }

      const tabelas = dump && dump.tabelas;
      if (!tabelas || typeof tabelas !== 'object') {
        UI().toast('Este arquivo não parece um backup do Agro Bras.', 'erro');
        return;
      }
      const totalLinhas = Object.values(tabelas).reduce((s, a) => s + (Array.isArray(a) ? a.length : 0), 0);
      const quando = dump.exportado_em ? UI().dataCurta(dump.exportado_em) : 'data desconhecida';
      const ok = await UI().confirm(
        `Restaurar backup de ${quando}?\n\nVai inserir/atualizar ${totalLinhas} registro(s). ` +
        `Registros com o mesmo id são sobrescritos; o que já existe e não está no arquivo é mantido. ` +
        `Use apenas para recuperação.`,
        { okLabel: 'Restaurar', perigo: true }
      );
      if (!ok) return;

      const original = btn ? btn.innerHTML : '';
      if (btn) { btn.disabled = true; btn.textContent = 'Restaurando...'; }
      try {
        const db = UI().db();
        let gravados = 0;
        for (const t of TABELAS_BACKUP) {          // ordem FK-safe (pais primeiro)
          const rows = tabelas[t];
          if (!Array.isArray(rows) || !rows.length) continue;
          for (let i = 0; i < rows.length; i += 500) {  // em lotes p/ não estourar payload
            const chunk = rows.slice(i, i + 500);
            const { error } = await db.from(t).upsert(chunk, { onConflict: 'id' });
            if (error) throw error;
            gravados += chunk.length;
          }
        }
        UI().toast(`Backup restaurado (${gravados} registros).`);
        if ((location.hash || '').includes('inicio') && main) render(main);
      } catch (err) {
        UI().erro('Falha ao restaurar backup', err);
      } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = original; if (window.AGB && AGB.refreshIcons) AGB.refreshIcons(); }
      }
    };
    input.click();
  }

  window.AGB = window.AGB || {};
  window.AGB.exportarBackup = exportarBackup;
  window.AGB.importarBackup = importarBackup;
  window.AGB.registerView('inicio', render);
})();
