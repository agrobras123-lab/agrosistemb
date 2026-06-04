# Agro Bras Hortifruti — ERP

ERP de vendas, compras e financeiro para distribuidora de hortifruti
(Largo do Pari, São Paulo). PWA estático (HTML + JS puro) com Supabase.

## Como funciona

- **App:** site estático hospedado no GitHub Pages.
- **Dados:** Supabase (Postgres). O GitHub guarda apenas o app, nunca os dados.
- **Acesso:** PIN único de 4 dígitos (trava de balcão).

## Configuração (uma vez)

1. No Supabase, rode o conteúdo de [`schema.sql`](schema.sql) no **SQL Editor**.
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
schema.sql        schema do banco (rodar no Supabase)
js/
  supabase.js     config (URL, KEY, PIN) + cliente
  ui.js           helpers (formatação, modal, toast)
  cupom.js        cupom térmico 80mm
  app.js          shell, roteamento, PWA install
  pin.js          tela de PIN
  cadastros.js    clientes, fornecedores, produtos, vendedores, ajuste de saldo
  vendas.js       fluxo de venda + edição
  compras.js      fluxo de compra + edição
  dashboard.js    totais do dia
  relatorios.js   5 relatórios imprimíveis
css/style.css     tema branco/cinza/verde, responsivo
assets/           logo e ícone
```

## Fora de escopo

Cupom fiscal / NFC-e / SAT. Maquininha. Login individual. Offline.
