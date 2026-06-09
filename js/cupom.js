/* =====================================================================
 * Agro Bras Hortifruti — Cupom térmico 80mm (compartilhado)
 * Usado por Vendas (Etapa 2) e Compras (Etapa 3), e relatórios.
 *
 * AGB.cupom.html(dados)        → string HTML do cupom
 * AGB.cupom.imprimir(dados)    → joga no #area-impressao e chama print()
 *
 * Impressão é SEMPRE manual (botão), nunca automática.
 * ===================================================================== */
(function () {
  const UI = () => window.AGB.ui;

  const LOJA = {
    nome: 'Agro Bras Hortifruti',
    endereco: 'Largo do Pari 330 · Box 57-62 · J Brás · São Paulo',
    whats: 'WhatsApp 11 93311-2643',
    insta: 'Instagram agroo_bras'
  };
  const MOD = { dinheiro: 'Dinheiro', pix: 'Pix', cartao: 'Cartão', boleto: 'Boleto' };

  function cabecalho() {
    return `
      <div class="cp-head">
        <img class="cp-logo" src="./assets/logo-cupom.png" alt="" />
        <div class="cp-loja">${LOJA.nome}</div>
        <div class="cp-info">${LOJA.endereco}</div>
        <div class="cp-info">${LOJA.whats}</div>
        <div class="cp-info">${LOJA.insta}</div>
      </div>`;
  }

  function saldoTexto(saldo) {
    const v = Number(saldo) || 0;
    if (Math.abs(v) < 0.005) return 'Em dia';
    if (v > 0) return 'Deve ' + UI().money(v);
    return 'Crédito a favor ' + UI().money(-v);
  }

  /* dados = {
   *   tipo: 'VENDA' | 'COMPRA',
   *   numero, data (iso),
   *   contraparteLabel: 'Cliente' | 'Fornecedor',
   *   contraparteNome,            // ou 'Avulso'
   *   vendedor,
   *   itens: [{descricao, unidade, quantidade, preco_unit, valor}],
   *   total,
   *   pagamentos: [{modalidade, valor, vencimento}],
   *   emAberto,
   *   saldoLabel,                 // 'Saldo devedor' | 'Saldo em aberto'
   *   saldo,                      // number | null (avulso)
   *   observacao
   * } */
  function html(d) {
    const itens = (d.itens || []).map((i) => `
      <div class="cp-item">
        <div class="cp-item-desc">${UI().esc(i.descricao)}</div>
        <div class="cp-item-calc">
          <span>${UI().qtd(i.quantidade)} ${UI().esc(i.unidade || '')} × ${UI().money(i.preco_unit)}</span>
          <span>${UI().money(i.valor)}</span>
        </div>
      </div>`).join('');

    const pags = (d.pagamentos || []).filter((p) => Number(p.valor) > 0).map((p) => `
      <div class="cp-row">
        <span>${MOD[p.modalidade] || p.modalidade}${p.vencimento ? ' (venc. ' + UI().dataCurta(p.vencimento) + ')' : ''}</span>
        <span>${UI().money(p.valor)}</span>
      </div>`).join('') || '<div class="cp-row"><span>—</span><span></span></div>';

    const emAberto = Number(d.emAberto) || 0;

    return `
    <div class="cupom">
      ${cabecalho()}

      <div class="cp-tipo">${d.tipo}</div>

      <div class="cp-meta">
        <div class="cp-row"><span>Nº</span><span>${d.numero != null ? d.numero : '—'}</span></div>
        <div class="cp-row"><span>Data</span><span>${UI().data(d.data)}</span></div>
        <div class="cp-row"><span>${d.contraparteLabel}</span><span>${UI().esc(d.contraparteNome)}</span></div>
        <div class="cp-row"><span>Vendedor</span><span>${UI().esc(d.vendedor || '—')}</span></div>
      </div>

      <div class="cp-sep"></div>
      <div class="cp-itens">${itens || '<div class="cp-info">Sem itens</div>'}</div>
      <div class="cp-sep"></div>

      <div class="cp-row cp-total"><span>TOTAL</span><span>${UI().money(d.total)}</span></div>

      <div class="cp-sub">Pagamentos</div>
      ${pags}
      ${emAberto > 0.005 ? `<div class="cp-row cp-aberto"><span>Parcial em aberto</span><span>${UI().money(emAberto)}</span></div>` : ''}

      ${d.saldo != null ? `<div class="cp-sep"></div>
        <div class="cp-row cp-saldo"><span>${d.saldoLabel}</span><span>${saldoTexto(d.saldo)}</span></div>` : ''}

      ${d.observacao ? `<div class="cp-sep"></div><div class="cp-obs"><strong>Obs:</strong> ${UI().esc(d.observacao)}</div>` : ''}

      <div class="cp-foot">Obrigado pela preferência!</div>
    </div>`;
  }

  function imprimirHTML(innerHTML) {
    let area = document.getElementById('area-impressao');
    if (!area) {
      area = document.createElement('div');
      area.id = 'area-impressao';
      document.body.appendChild(area);
    }
    area.innerHTML = innerHTML;
    // dá um tempinho pro layout/imagem antes de imprimir
    setTimeout(() => window.print(), 150);
  }

  function imprimir(d) { imprimirHTML(html(d)); }

  // Monta um "cupom de relatório" 80mm: cabeçalho da loja + título + conteúdo.
  // conteudoHTML deve usar as classes cp-* para ficar consistente.
  function relatorio(titulo, subtitulo, conteudoHTML) {
    return `
      <div class="cupom cupom-rel">
        ${cabecalho()}
        <div class="cp-tipo">${titulo}</div>
        ${subtitulo ? `<div class="cp-info" style="text-align:center;margin-bottom:6px">${subtitulo}</div>` : ''}
        ${conteudoHTML}
        <div class="cp-foot">Agro Bras Hortifruti</div>
      </div>`;
  }

  window.AGB = window.AGB || {};
  window.AGB.cupom = { html, imprimir, imprimirHTML, relatorio };
})();
