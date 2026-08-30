# Agro Bras Hortifruti — ERP

ERP de vendas, compras e financeiro para distribuidora de hortifruti
(Largo do Pari, São Paulo). PWA estático (HTML + JS puro) com Supabase.

## Como funciona

- **App:** site estático hospedado no GitHub Pages.
- **Dados:** Supabase (Postgres). O GitHub guarda apenas o app, nunca os dados.
- **Acesso:** PIN único de 4 dígitos (trava de balcão).

## Configuração (uma vez)

1. No Supabase, rode o conteúdo de [`schema.sql`](schema.sql) no **SQL Editor**.
   (Banco que já existia? Rode também [`fechamento.sql`](fechamento.sql) — é a
   parte nova do fechamento em boleto, e é idempotente.)
2. Em [`js/supabase.js`](js/supabase.js), preencha no topo:
   - `SUPABASE_URL` e `SUPABASE_ANON_KEY` (painel Supabase → Project Settings → API)
   - `APP_PIN` (PIN de acesso de 4 dígitos)
3. Sempre que alterar qualquer arquivo do app, suba a versão do cache em
   [`sw.js`](sw.js) (`const CACHE = 'agrobras-shell-vN'`) para o navegador
   pegar a versão nova.

## Deploy (GitHub Pages)

Repositório → **Settings → Pages** → *Build and deployment*:
- **Source:** Deploy from a branch
- **Branch:** `main` / `/ (root)`

O app fica em `https://SEU_USUARIO.github.io/NOME_DO_REPO/`.

## Estrutura

```
index.html        shell + roteamento + tela de PIN
manifest.json     PWA
sw.js             service worker (cacheia só o shell; dados sempre da rede)
schema.sql        schema do banco (rodar no Supabase — já inclui tudo abaixo)
rpc.sql           gravação atômica de venda/compra
relatorios_rpc.sql  agregações dos relatórios no servidor
fechamento.sql    fechamento em boleto (semana do cliente)
js/
  supabase.js     config (URL, KEY, PIN) + cliente
  ui.js           helpers (formatação, modal, toast)
  cupom.js        cupom térmico 80mm
  app.js          shell, roteamento, PWA install
  pin.js          tela de PIN
  cadastros.js    clientes, fornecedores, produtos, vendedores, ajuste de saldo
  vendas.js       fluxo de venda + edição + clonagem
  compras.js      fluxo de compra + edição
  fechamento.js   fecha as vendas em aberto de um cliente num boleto só
  dashboard.js    totais do dia
  relatorios.js   5 relatórios imprimíveis
css/style.css     tema branco/cinza/verde, responsivo
assets/           logo e ícone
```

## Fechamento em boleto (semana do cliente)

O cliente leva mercadoria a semana toda no fiado. No fim da semana, em
**Fechamento → Fechar semana**: escolha o cliente, marque **quais vendas**
entram, escolha a **data de vencimento** e confirme. Cada venda marcada recebe
um boleto no valor que faltava e o saldo do cliente zera — tudo calculado no
servidor. Depois dá para reimprimir, somar vendas que entraram atrasadas,
trocar o vencimento de todos de uma vez ou desfazer o fechamento inteiro
(as vendas voltam a ficar em aberto).

Na agenda de **Relatórios → Boletos**, um fechamento aparece como uma linha só
("Fech. nº 7 · 6 vendas"), não como seis boletos soltos.

## Atalhos de teclado (PC)

`F2` nova venda/compra · `F3` buscar/editar · `F4` clonar venda ·
`F7` reimprimir cupom. No celular os atalhos somem e a navegação é pela barra
de baixo.

## Fora de escopo

Cupom fiscal / NFC-e / SAT. Maquininha. Login individual. Offline.
