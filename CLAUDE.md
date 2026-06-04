# Agro Bras Hortifruti — ERP (especificação para o Claude Code)

Você vai construir um ERP de vendas, compras e financeiro para uma distribuidora
de hortifruti (box no Largo do Pari, São Paulo). Leia este arquivo inteiro antes
de começar e siga o roadmap por etapas. **Pare ao fim de cada etapa e aguarde
revisão** antes de seguir para a próxima.

## Stack e decisões já fechadas (não reabrir)

- **Banco:** Supabase (Postgres). Schema completo em `schema.sql` — rode antes de tudo.
- **Modo:** ONLINE-ONLY. Sem PouchDB, sem offline-first na v1.
- **Front:** PWA instalável e **responsivo** (PC e celular). HTML + JS puro,
  cliente Supabase via CDN. Sem framework pesado.
- **Hospedagem:** GitHub Pages (estático). GitHub guarda só o app, nunca os dados.
- **Resiliência a queda de energia:** o celular (bateria + 4G) é o no-break.
  Por isso o app precisa funcionar bem no celular. Não implemente offline.
- **Acesso:** PIN único de 4 dígitos compartilhado (trava de tela). Sem login individual.

## Estrutura de arquivos sugerida

```
/index.html        → shell do app, menu lateral, roteamento simples
/manifest.json     → PWA instalável
/sw.js             → service worker (cache do shell apenas; dados sempre da rede)
/js/supabase.js    → init do cliente + URL e ANON KEY (ver "Configuração")
/js/pin.js         → tela de PIN
/js/cadastros.js   → clientes, fornecedores, produtos, vendedores, ajuste de saldo
/js/vendas.js      → fluxo de venda + fechamento + cupom
/js/compras.js     → fluxo de compra + fechamento + cupom
/js/dashboard.js   → tela inicial (totais do dia)
/js/relatorios.js  → 5 relatórios
/js/cupom.js       → geração do cupom térmico 80mm (compartilhado)
/css/style.css     → tema branco/cinza/verde, responsivo
```

## Configuração (o usuário preenche)

Em `js/supabase.js`, deixe duas constantes no topo bem visíveis:
`SUPABASE_URL` e `SUPABASE_ANON_KEY`. O usuário cola os valores do painel do
Supabase (Project Settings → API).

## Regras de negócio CRÍTICAS (o servidor manda)

1. **Numeração de pedidos:** NUNCA gere o número no cliente. O `numero` sai da
   sequência do Postgres automaticamente no INSERT. Leia o número retornado.
2. **Saldo:** NUNCA calcule saldo no cliente para gravar. Os triggers do banco
   mantêm `clientes.saldo_devedor` e `fornecedores.saldo_aberto`. O app só LÊ.
3. **Item:** `valor = quantidade * preco_unit`. Grave `valor` calculado; o total
   do pedido é mantido por trigger.
4. **Pagamento misto:** um pedido pode ter vários registros em `pagamentos_*`
   (dinheiro/pix/cartao/boleto). Boleto pode ter `vencimento`.
5. **"Parcial em aberto" NÃO é pagamento:** é o resto.
   `em_aberto = total - soma(pagamentos)`. Esse resto é o que vira saldo
   automaticamente. Em relatórios, mostre "parcial/em aberto" como categoria
   calculada — não como linha de pagamento.
6. **Venda avulsa:** `cliente_id = NULL`. Identifique como "Avulso".
7. **Zeramento de saldo:** o app cria um ajuste `credito` com valor = saldo atual.
8. **Edição livre:** pedidos fechados podem ser reabertos e alterados; sem log de
   auditoria. Ao salvar, os triggers recalculam os saldos sozinhos.

## Identidade visual

Nome: **Agro Bras Hortifruti**. Paleta: branco, cinza e verde — visual claro,
limpo, sofisticado. Logo Agro Bras centralizado na tela de PIN e no cabeçalho dos
cupons. Menu lateral fixo no PC; navegação adaptada no celular.

## Impressão térmica (80mm) — botão manual, não automático

Cabeçalho fixo em todo cupom: logo, "Largo do Pari 330 Box 57-62 J Brás São Paulo",
WhatsApp 11 93311-2643, Instagram agroo_bras.
- **Cupom de venda:** "VENDA" em destaque, data, cliente (ou Avulso), nº do pedido,
  vendedor, itens (qtd / descrição / unidade / preço unit / valor), total,
  formas de pagamento com valores, saldo devedor atualizado do cliente, observação.
- **Cupom de compra:** idêntico, "COMPRA" em destaque, fornecedor no lugar de cliente.
- Relatórios também imprimíveis na mesma impressora.

## Roadmap de construção (PARE ao fim de cada etapa)

**Etapa 0 — Fundação.** Estrutura de arquivos, PWA (manifest + sw), cliente
Supabase, tela de PIN, shell com menu lateral (Vendas, Compras, Cadastros,
Relatórios) e roteamento. Deploy no GitHub Pages só com o esqueleto abrindo.

**Etapa 1 — Cadastros.** CRUD de clientes, fornecedores, produtos (código
sequencial automático, unidade livre, sem preço base) e vendedores. Ajuste manual
de saldo (débito/crédito/zeramento) no cadastro de cliente e fornecedor, mostrando
o saldo atual em tempo real. É a base — vendas/compras dependem disto.

**Etapa 2 — Vendas.** Fluxo: vendedor seleciona o nome → seleciona cliente
(saldo aparece) ou Avulso → adiciona itens (qtd + preço livre, ilimitados) →
observação → tela de pagamento com distribuição livre entre modalidades →
confirma. Mostra saldo atualizado na confirmação. Cupom de venda 80mm.

**Etapa 3 — Compras.** Espelho da Etapa 2 com fornecedor. Cupom de compra 80mm.

**Etapa 4 — Tela inicial.** Totais do dia: vendas por modalidade, compras por
modalidade, saldo do dia (vendas − compras), qtd de pedidos de venda e de compra.

**Etapa 5 — Relatórios.** Os 5: Vendas (período/cliente/forma/vendedor, total geral
+ por modalidade, avulsas identificadas), Compras (idem com fornecedor), Clientes
(lista + saldo + total de fiado + histórico), Fornecedores (idem), Produtos
(mais vendidos por qtd e por valor, sem filtro de período). Todos imprimíveis.

**Etapa 6 — Edição + polimento.** Reabrir/editar pedidos (busca por número ou
nome), recálculo automático de saldo. Refino de responsividade no celular,
PWA instalável nos dois, ajustes finais de visual.

## Fora de escopo

Cupom fiscal / NFC-e / SAT / SEFAZ. Integração com maquininha. Log de auditoria.
Offline. Login individual.

---
Comece pela **Etapa 0**. Ao terminar, mostre o que foi feito e espere o "ok"
antes de seguir para a Etapa 1.
