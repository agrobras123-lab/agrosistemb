-- =====================================================================
-- Agro Bras Hortifruti — Schema Supabase (Postgres)
-- Online-only. Numeração de pedidos e saldos garantidos pelo servidor.
-- Cole tudo no SQL Editor do Supabase e execute de uma vez.
-- =====================================================================

create extension if not exists "pgcrypto";  -- gen_random_uuid()

-- =========================== CADASTROS ===============================

create table vendedores (
  id        uuid primary key default gen_random_uuid(),
  nome      text not null,
  ativo     boolean not null default true,
  criado_em timestamptz not null default now()
);

create table clientes (
  id            uuid primary key default gen_random_uuid(),
  nome          text not null,
  cnpj          text,
  endereco      text,
  telefone      text,
  observacoes   text,
  ativo         boolean not null default true,       -- inativar em vez de apagar (preserva histórico)
  saldo_devedor numeric(14,2) not null default 0,   -- mantido por trigger
  criado_em     timestamptz not null default now()
);

create table fornecedores (
  id           uuid primary key default gen_random_uuid(),
  nome         text not null,
  cnpj         text,
  endereco     text,
  telefone     text,
  observacoes  text,
  ativo        boolean not null default true,        -- inativar em vez de apagar (preserva histórico)
  saldo_aberto numeric(14,2) not null default 0,     -- mantido por trigger
  criado_em    timestamptz not null default now()
);

create sequence if not exists seq_produto_codigo start 1;
create table produtos (
  id        uuid primary key default gen_random_uuid(),
  codigo    integer not null unique default nextval('seq_produto_codigo'),
  nome      text not null,
  unidade   text not null,            -- UN, SC, CX, BD, PC, KG... texto livre
  ativo     boolean not null default true,
  criado_em timestamptz not null default now()
);

-- ======================== TRANSAÇÕES: VENDAS =========================

create sequence if not exists seq_pedido_venda start 1;
create table pedidos_venda (
  id            uuid primary key default gen_random_uuid(),
  numero        integer not null unique default nextval('seq_pedido_venda'),
  data          timestamptz not null default now(),
  vendedor_id   uuid references vendedores(id),
  cliente_id    uuid references clientes(id),   -- NULL = venda avulsa
  observacao    text,
  total         numeric(14,2) not null default 0,  -- mantido por trigger (soma dos itens)
  atualizado_em timestamptz not null default now() -- bump por trigger (trava otimista de edição)
);

create table itens_venda (
  id         uuid primary key default gen_random_uuid(),
  pedido_id  uuid not null references pedidos_venda(id) on delete cascade,
  produto_id uuid not null references produtos(id),
  quantidade numeric(14,3) not null,
  preco_unit numeric(14,2) not null,    -- preço livre por item
  valor      numeric(14,2) not null     -- quantidade * preco_unit (gravado pelo app)
);

create table pagamentos_venda (
  id         uuid primary key default gen_random_uuid(),
  pedido_id  uuid not null references pedidos_venda(id) on delete cascade,
  modalidade text not null check (modalidade in ('dinheiro','pix','cartao','boleto')),
  valor      numeric(14,2) not null,
  vencimento date    -- opcional, usado em boleto
);

-- ======================= TRANSAÇÕES: COMPRAS =========================
-- (espelho exato de vendas, trocando cliente por fornecedor)

create sequence if not exists seq_pedido_compra start 1;
create table pedidos_compra (
  id            uuid primary key default gen_random_uuid(),
  numero        integer not null unique default nextval('seq_pedido_compra'),
  data          timestamptz not null default now(),
  vendedor_id   uuid references vendedores(id),
  fornecedor_id uuid references fornecedores(id),
  observacao    text,
  total         numeric(14,2) not null default 0,
  atualizado_em timestamptz not null default now() -- bump por trigger (trava otimista de edição)
);

create table itens_compra (
  id         uuid primary key default gen_random_uuid(),
  pedido_id  uuid not null references pedidos_compra(id) on delete cascade,
  produto_id uuid not null references produtos(id),
  quantidade numeric(14,3) not null,
  preco_unit numeric(14,2) not null,
  valor      numeric(14,2) not null
);

create table pagamentos_compra (
  id         uuid primary key default gen_random_uuid(),
  pedido_id  uuid not null references pedidos_compra(id) on delete cascade,
  modalidade text not null check (modalidade in ('dinheiro','pix','cartao','boleto')),
  valor      numeric(14,2) not null,
  vencimento date
);

-- ===================== AJUSTE MANUAL DE SALDO ========================
-- tipo='debito' soma ao saldo, 'credito' subtrai.
-- "Zeramento" é feito pelo APP criando um 'credito' igual ao saldo atual.
create table ajustes_saldo (
  id            uuid primary key default gen_random_uuid(),
  tipo_entidade text not null check (tipo_entidade in ('cliente','fornecedor')),
  entidade_id   uuid not null,
  tipo          text not null check (tipo in ('debito','credito')),
  valor         numeric(14,2) not null,
  -- forma de pagamento QUANDO o ajuste é um recebimento de fiado (credito
  -- com modalidade). NULL = ajuste/correção manual (não entra no caixa do dia).
  modalidade    text check (modalidade in ('dinheiro','pix','cartao','boleto')),
  observacao    text,
  data          timestamptz not null default now()
);

-- ========================= ÍNDICES (relatórios) ======================
create index idx_pv_cliente  on pedidos_venda(cliente_id);
create index idx_pv_data     on pedidos_venda(data);
create index idx_pv_vendedor on pedidos_venda(vendedor_id);
create index idx_iv_pedido   on itens_venda(pedido_id);
create index idx_iv_produto  on itens_venda(produto_id);
create index idx_gv_pedido   on pagamentos_venda(pedido_id);
create index idx_pc_forn     on pedidos_compra(fornecedor_id);
create index idx_pc_data     on pedidos_compra(data);
create index idx_pc_vendedor on pedidos_compra(vendedor_id);
create index idx_ic_pedido   on itens_compra(pedido_id);
create index idx_ic_produto  on itens_compra(produto_id);
create index idx_gc_pedido   on pagamentos_compra(pedido_id);
create index idx_aj_ent      on ajustes_saldo(tipo_entidade, entidade_id);

-- ===================== FUNÇÕES DE RECÁLCULO ==========================
-- Recálculo completo por entidade afetada (volume pequeno → simples e à prova de drift)

create or replace function recalc_total_pedido_venda(p_pedido uuid)
returns void language plpgsql as $$
begin
  update pedidos_venda set total =
    coalesce((select sum(valor) from itens_venda where pedido_id = p_pedido), 0)
  where id = p_pedido;
end; $$;

create or replace function recalc_total_pedido_compra(p_pedido uuid)
returns void language plpgsql as $$
begin
  update pedidos_compra set total =
    coalesce((select sum(valor) from itens_compra where pedido_id = p_pedido), 0)
  where id = p_pedido;
end; $$;

create or replace function recalc_saldo_cliente(p_cliente uuid)
returns void language plpgsql as $$
begin
  if p_cliente is null then return; end if;
  update clientes set saldo_devedor =
      coalesce((select sum(total) from pedidos_venda where cliente_id = p_cliente), 0)
    - coalesce((select sum(g.valor) from pagamentos_venda g
                join pedidos_venda p on p.id = g.pedido_id
                where p.cliente_id = p_cliente), 0)
    + coalesce((select sum(case when tipo='debito' then valor else -valor end)
                from ajustes_saldo
                where tipo_entidade='cliente' and entidade_id = p_cliente), 0)
  where id = p_cliente;
end; $$;

create or replace function recalc_saldo_fornecedor(p_forn uuid)
returns void language plpgsql as $$
begin
  if p_forn is null then return; end if;
  update fornecedores set saldo_aberto =
      coalesce((select sum(total) from pedidos_compra where fornecedor_id = p_forn), 0)
    - coalesce((select sum(g.valor) from pagamentos_compra g
                join pedidos_compra p on p.id = g.pedido_id
                where p.fornecedor_id = p_forn), 0)
    + coalesce((select sum(case when tipo='debito' then valor else -valor end)
                from ajustes_saldo
                where tipo_entidade='fornecedor' and entidade_id = p_forn), 0)
  where id = p_forn;
end; $$;

-- ========================= TRIGGERS: VENDAS ==========================

create or replace function trg_itens_venda() returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' and new.pedido_id <> old.pedido_id then
    perform recalc_total_pedido_venda(old.pedido_id);
    perform recalc_total_pedido_venda(new.pedido_id);
  else
    perform recalc_total_pedido_venda(coalesce(new.pedido_id, old.pedido_id));
  end if;
  return null;
end; $$;
create trigger t_itens_venda after insert or update or delete on itens_venda
for each row execute function trg_itens_venda();

create or replace function trg_pedidos_venda() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    perform recalc_saldo_cliente(old.cliente_id);
  elsif tg_op = 'UPDATE' then
    perform recalc_saldo_cliente(old.cliente_id);
    if new.cliente_id is distinct from old.cliente_id then
      perform recalc_saldo_cliente(new.cliente_id);
    end if;
  else
    perform recalc_saldo_cliente(new.cliente_id);
  end if;
  return null;
end; $$;
create trigger t_pedidos_venda after insert or update or delete on pedidos_venda
for each row execute function trg_pedidos_venda();

create or replace function trg_pagamentos_venda() returns trigger language plpgsql as $$
declare v_cliente uuid;
begin
  select cliente_id into v_cliente from pedidos_venda
    where id = coalesce(new.pedido_id, old.pedido_id);
  perform recalc_saldo_cliente(v_cliente);
  return null;
end; $$;
create trigger t_pagamentos_venda after insert or update or delete on pagamentos_venda
for each row execute function trg_pagamentos_venda();

-- ========================= TRIGGERS: COMPRAS =========================

create or replace function trg_itens_compra() returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' and new.pedido_id <> old.pedido_id then
    perform recalc_total_pedido_compra(old.pedido_id);
    perform recalc_total_pedido_compra(new.pedido_id);
  else
    perform recalc_total_pedido_compra(coalesce(new.pedido_id, old.pedido_id));
  end if;
  return null;
end; $$;
create trigger t_itens_compra after insert or update or delete on itens_compra
for each row execute function trg_itens_compra();

create or replace function trg_pedidos_compra() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    perform recalc_saldo_fornecedor(old.fornecedor_id);
  elsif tg_op = 'UPDATE' then
    perform recalc_saldo_fornecedor(old.fornecedor_id);
    if new.fornecedor_id is distinct from old.fornecedor_id then
      perform recalc_saldo_fornecedor(new.fornecedor_id);
    end if;
  else
    perform recalc_saldo_fornecedor(new.fornecedor_id);
  end if;
  return null;
end; $$;
create trigger t_pedidos_compra after insert or update or delete on pedidos_compra
for each row execute function trg_pedidos_compra();

create or replace function trg_pagamentos_compra() returns trigger language plpgsql as $$
declare v_forn uuid;
begin
  select fornecedor_id into v_forn from pedidos_compra
    where id = coalesce(new.pedido_id, old.pedido_id);
  perform recalc_saldo_fornecedor(v_forn);
  return null;
end; $$;
create trigger t_pagamentos_compra after insert or update or delete on pagamentos_compra
for each row execute function trg_pagamentos_compra();

-- ========================= TRIGGER: AJUSTES ==========================

create or replace function trg_ajustes_saldo() returns trigger language plpgsql as $$
declare v_tipo text; v_ent uuid;
begin
  v_tipo := coalesce(new.tipo_entidade, old.tipo_entidade);
  v_ent  := coalesce(new.entidade_id,  old.entidade_id);
  if v_tipo = 'cliente' then perform recalc_saldo_cliente(v_ent);
  else perform recalc_saldo_fornecedor(v_ent); end if;
  if tg_op = 'UPDATE' and (old.entidade_id <> new.entidade_id
                           or old.tipo_entidade <> new.tipo_entidade) then
    if old.tipo_entidade = 'cliente' then perform recalc_saldo_cliente(old.entidade_id);
    else perform recalc_saldo_fornecedor(old.entidade_id); end if;
  end if;
  return null;
end; $$;
create trigger t_ajustes_saldo after insert or update or delete on ajustes_saldo
for each row execute function trg_ajustes_saldo();

-- ============ MIGRAÇÃO (bancos que já rodaram versão anterior) ========
-- Idempotente. Em instalação nova não faz nada além de confirmar o que já
-- existe; em banco antigo, adiciona as colunas novas sem perder dados.
alter table clientes       add column if not exists ativo boolean not null default true;
alter table fornecedores   add column if not exists ativo boolean not null default true;
alter table pedidos_venda  add column if not exists atualizado_em timestamptz not null default now();
alter table pedidos_compra add column if not exists atualizado_em timestamptz not null default now();
-- recebimento de fiado com forma de pagamento (entra no caixa do dia)
alter table ajustes_saldo  add column if not exists modalidade text
  check (modalidade in ('dinheiro','pix','cartao','boleto'));
-- agenda de boletos (acelera a busca por vencimento)
create index if not exists idx_gv_venc on pagamentos_venda(vencimento)  where modalidade = 'boleto';
create index if not exists idx_gc_venc on pagamentos_compra(vencimento) where modalidade = 'boleto';

-- ===== TOUCH: bump de atualizado_em em toda alteração do pedido =======
-- Serve de "carimbo" para a trava otimista: o app lê atualizado_em ao abrir
-- o pedido e, antes de salvar a edição, confere se ninguém mexeu no meio.
create or replace function trg_touch_pedido() returns trigger language plpgsql as $$
begin
  new.atualizado_em := now();
  return new;
end; $$;
create or replace trigger t_touch_pedido_venda before update on pedidos_venda
  for each row execute function trg_touch_pedido();
create or replace trigger t_touch_pedido_compra before update on pedidos_compra
  for each row execute function trg_touch_pedido();

-- ============================== RLS ==================================
-- ATENÇÃO: política aberta. Com a chave anon embutida num app estático,
-- qualquer um com a URL acessa os dados. Aceitável para ferramenta
-- interna de poucos usuários; trocar por RLS real + auth se precisar
-- de proteção de verdade (ver "Solução C" do plano).
do $$ declare t text;
begin
  foreach t in array array[
    'vendedores','clientes','fornecedores','produtos',
    'pedidos_venda','itens_venda','pagamentos_venda',
    'pedidos_compra','itens_compra','pagamentos_compra','ajustes_saldo']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists p_all on %I', t);
    execute format('create policy p_all on %I for all to anon, authenticated using (true) with check (true)', t);
  end loop;
end $$;

-- ============= RPC: GRAVAÇÃO ATÔMICA DE VENDA / COMPRA ===============
-- Criar/editar um pedido (pedido + itens + pagamentos) numa transação só.
-- Edição é "tudo ou nada": queda de conexão não deixa pedido pela metade.

create or replace function salvar_venda(
  p_pedido_id uuid, p_vendedor_id uuid, p_cliente_id uuid,
  p_observacao text, p_itens jsonb, p_pagamentos jsonb
) returns jsonb language plpgsql as $$
declare v_id uuid; v_numero int; v_total numeric(14,2); v_data timestamptz; v_saldo numeric(14,2);
begin
  if p_pedido_id is null then
    insert into pedidos_venda (vendedor_id, cliente_id, observacao)
    values (p_vendedor_id, p_cliente_id, p_observacao) returning id, numero into v_id, v_numero;
  else
    v_id := p_pedido_id;
    update pedidos_venda set vendedor_id=p_vendedor_id, cliente_id=p_cliente_id, observacao=p_observacao
     where id=v_id returning numero into v_numero;
    if v_numero is null then raise exception 'Venda % nao encontrada', p_pedido_id; end if;
    delete from itens_venda where pedido_id=v_id;
    delete from pagamentos_venda where pedido_id=v_id;
  end if;
  insert into itens_venda (pedido_id, produto_id, quantidade, preco_unit, valor)
  select v_id, (e->>'produto_id')::uuid, (e->>'quantidade')::numeric, (e->>'preco_unit')::numeric, (e->>'valor')::numeric
  from jsonb_array_elements(coalesce(p_itens,'[]'::jsonb)) e;
  insert into pagamentos_venda (pedido_id, modalidade, valor, vencimento)
  select v_id, e->>'modalidade', (e->>'valor')::numeric, nullif(e->>'vencimento','')::date
  from jsonb_array_elements(coalesce(p_pagamentos,'[]'::jsonb)) e;
  select total, data into v_total, v_data from pedidos_venda where id=v_id;
  if p_cliente_id is not null then select saldo_devedor into v_saldo from clientes where id=p_cliente_id; end if;
  return jsonb_build_object('id',v_id,'numero',v_numero,'total',v_total,'data',v_data,'saldo',v_saldo);
end; $$;

create or replace function salvar_compra(
  p_pedido_id uuid, p_vendedor_id uuid, p_fornecedor_id uuid,
  p_observacao text, p_itens jsonb, p_pagamentos jsonb
) returns jsonb language plpgsql as $$
declare v_id uuid; v_numero int; v_total numeric(14,2); v_data timestamptz; v_saldo numeric(14,2);
begin
  if p_pedido_id is null then
    insert into pedidos_compra (vendedor_id, fornecedor_id, observacao)
    values (p_vendedor_id, p_fornecedor_id, p_observacao) returning id, numero into v_id, v_numero;
  else
    v_id := p_pedido_id;
    update pedidos_compra set vendedor_id=p_vendedor_id, fornecedor_id=p_fornecedor_id, observacao=p_observacao
     where id=v_id returning numero into v_numero;
    if v_numero is null then raise exception 'Compra % nao encontrada', p_pedido_id; end if;
    delete from itens_compra where pedido_id=v_id;
    delete from pagamentos_compra where pedido_id=v_id;
  end if;
  insert into itens_compra (pedido_id, produto_id, quantidade, preco_unit, valor)
  select v_id, (e->>'produto_id')::uuid, (e->>'quantidade')::numeric, (e->>'preco_unit')::numeric, (e->>'valor')::numeric
  from jsonb_array_elements(coalesce(p_itens,'[]'::jsonb)) e;
  insert into pagamentos_compra (pedido_id, modalidade, valor, vencimento)
  select v_id, e->>'modalidade', (e->>'valor')::numeric, nullif(e->>'vencimento','')::date
  from jsonb_array_elements(coalesce(p_pagamentos,'[]'::jsonb)) e;
  select total, data into v_total, v_data from pedidos_compra where id=v_id;
  if p_fornecedor_id is not null then select saldo_aberto into v_saldo from fornecedores where id=p_fornecedor_id; end if;
  return jsonb_build_object('id',v_id,'numero',v_numero,'total',v_total,'data',v_data,'saldo',v_saldo);
end; $$;

-- ============================== FIM ==================================
