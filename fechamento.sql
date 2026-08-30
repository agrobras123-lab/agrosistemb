-- =====================================================================
-- Agro Bras Hortifruti — FECHAMENTO EM BOLETO (semana do cliente)
-- ---------------------------------------------------------------------
-- PARA QUE SERVE: durante a semana o cliente vai levando mercadoria e as
-- vendas ficam em aberto (viram saldo devedor). No fim da semana o dono
-- escolhe QUAIS vendas entram, escolhe a data de vencimento e fecha tudo
-- num boleto só. Cada venda escolhida recebe um pagamento 'boleto' no
-- valor QUE FALTAVA — os triggers já existentes zeram o saldo sozinhos.
--
-- O agrupamento (o "boleto da semana") vive em `fechamentos_boleto`, e
-- cada pagamento gerado aponta para ele por `pagamentos_venda.fechamento_id`.
-- Assim dá para reimprimir, trocar o vencimento, somar mais vendas depois
-- ou desfazer o fechamento inteiro sem mexer venda por venda.
--
-- Rode este arquivo INTEIRO no SQL Editor do Supabase. É idempotente
-- (pode rodar de novo). Já está incluído no final de schema.sql também.
-- =====================================================================

-- ------------------------- ESTRUTURA ---------------------------------

create sequence if not exists seq_fechamento start 1;

create table if not exists fechamentos_boleto (
  id         uuid primary key default gen_random_uuid(),
  numero     integer not null unique default nextval('seq_fechamento'),
  cliente_id uuid not null references clientes(id),
  vencimento date not null,
  total      numeric(14,2) not null default 0,   -- mantido por trigger
  observacao text,
  criado_em  timestamptz not null default now()
);

-- Liga o pagamento de boleto ao fechamento que o gerou. NULL = boleto
-- avulso, lançado direto na venda (comportamento antigo, segue valendo).
alter table pagamentos_venda
  add column if not exists fechamento_id uuid references fechamentos_boleto(id) on delete set null;

create index if not exists idx_gv_fech    on pagamentos_venda(fechamento_id);
create index if not exists idx_fb_cliente on fechamentos_boleto(cliente_id);
create index if not exists idx_fb_venc    on fechamentos_boleto(vencimento);

-- --------------------- TOTAL DO FECHAMENTO ---------------------------
-- Mesma filosofia do resto do banco: o total é do SERVIDOR, recalculado
-- por inteiro a cada mudança (volume pequeno, à prova de drift).

create or replace function recalc_total_fechamento(p_fech uuid)
returns void language plpgsql as $$
begin
  if p_fech is null then return; end if;
  update fechamentos_boleto set total =
    coalesce((select sum(valor) from pagamentos_venda where fechamento_id = p_fech), 0)
  where id = p_fech;
end; $$;

create or replace function trg_pagamentos_venda_fech() returns trigger language plpgsql as $$
begin
  if tg_op in ('UPDATE','DELETE') then perform recalc_total_fechamento(old.fechamento_id); end if;
  if tg_op in ('INSERT','UPDATE') then perform recalc_total_fechamento(new.fechamento_id); end if;
  return null;
end; $$;
create or replace trigger t_pagamentos_venda_fech
after insert or update or delete on pagamentos_venda
for each row execute function trg_pagamentos_venda_fech();

-- ================== RPC 1: VENDAS EM ABERTO ==========================
-- Lista as vendas do cliente que ainda têm saldo a pagar (total − pagos).
-- É a lista que o app mostra com caixinha de marcar: o dono escolhe quais
-- entram no boleto da semana.
create or replace function vendas_em_aberto(
  p_cliente uuid,
  p_ini     timestamptz default null,
  p_fim     timestamptz default null,   -- exclusivo
  p_limit   int default 400
) returns jsonb
language sql stable
set search_path = public
as $$
  with base as (
    select p.id, p.numero, p.data, p.total, p.observacao,
           coalesce((select sum(g.valor) from pagamentos_venda g where g.pedido_id = p.id), 0) as pago
    from pedidos_venda p
    where p.cliente_id = p_cliente
      and (p_ini is null or p.data >= p_ini)
      and (p_fim is null or p.data <  p_fim)
  ),
  abertos as (
    select id, numero, data, total, observacao, pago, round(total - pago, 2) as aberto
    from base
    where total - pago > 0.004
    order by data asc
    limit p_limit
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', id, 'numero', numero, 'data', data, 'total', total,
           'pago', pago, 'aberto', aberto, 'observacao', observacao) order by data asc), '[]'::jsonb)
  from abertos;
$$;

-- ================== RPC 2: FECHAR EM BOLETO ==========================
-- Cria o fechamento e gera UM pagamento 'boleto' por venda escolhida, no
-- valor que faltava — calculado AQUI, no servidor (o app nunca manda valor).
-- Vendas de outro cliente ou já quitadas são simplesmente ignoradas.
create or replace function fechar_boleto(
  p_cliente_id uuid,
  p_vencimento date,
  p_pedidos    jsonb,               -- ["uuid","uuid",...]
  p_observacao text default null
) returns jsonb
language plpgsql
set search_path = public
as $$
declare v_id uuid; v_numero int; v_qtd int; v_total numeric(14,2); v_saldo numeric(14,2);
begin
  if p_cliente_id is null then raise exception 'Selecione o cliente do fechamento.'; end if;
  if p_vencimento is null then raise exception 'Informe a data de vencimento do boleto.'; end if;
  if p_pedidos is null or jsonb_array_length(p_pedidos) = 0 then
    raise exception 'Selecione ao menos uma venda para fechar.';
  end if;

  insert into fechamentos_boleto (cliente_id, vencimento, observacao)
  values (p_cliente_id, p_vencimento, nullif(btrim(coalesce(p_observacao, '')), ''))
  returning id, numero into v_id, v_numero;

  insert into pagamentos_venda (pedido_id, modalidade, valor, vencimento, fechamento_id)
  select p.id, 'boleto', round(p.total - coalesce(g.pago, 0), 2), p_vencimento, v_id
  from pedidos_venda p
  left join lateral (select sum(valor) as pago from pagamentos_venda where pedido_id = p.id) g on true
  where p.cliente_id = p_cliente_id
    and p.id in (select value::uuid from jsonb_array_elements_text(p_pedidos))
    and p.total - coalesce(g.pago, 0) > 0.004;
  get diagnostics v_qtd = row_count;

  if v_qtd = 0 then
    delete from fechamentos_boleto where id = v_id;
    raise exception 'Nenhuma das vendas escolhidas tem valor em aberto.';
  end if;

  select total into v_total from fechamentos_boleto where id = v_id;
  select saldo_devedor into v_saldo from clientes where id = p_cliente_id;
  return jsonb_build_object('id', v_id, 'numero', v_numero, 'qtd', v_qtd,
                            'total', v_total, 'vencimento', p_vencimento, 'saldo', v_saldo);
end; $$;

-- ============ RPC 3: SOMAR MAIS VENDAS A UM FECHAMENTO ===============
-- Fechou na sexta e entrou venda no sábado? Soma no mesmo boleto, com o
-- mesmo vencimento — sem precisar desfazer e refazer.
create or replace function adicionar_ao_fechamento(p_id uuid, p_pedidos jsonb)
returns jsonb
language plpgsql
set search_path = public
as $$
declare v_cli uuid; v_venc date; v_qtd int; v_total numeric(14,2); v_saldo numeric(14,2);
begin
  select cliente_id, vencimento into v_cli, v_venc from fechamentos_boleto where id = p_id;
  if v_cli is null then raise exception 'Fechamento nao encontrado.'; end if;
  if p_pedidos is null or jsonb_array_length(p_pedidos) = 0 then
    raise exception 'Selecione ao menos uma venda.';
  end if;

  insert into pagamentos_venda (pedido_id, modalidade, valor, vencimento, fechamento_id)
  select p.id, 'boleto', round(p.total - coalesce(g.pago, 0), 2), v_venc, p_id
  from pedidos_venda p
  left join lateral (select sum(valor) as pago from pagamentos_venda where pedido_id = p.id) g on true
  where p.cliente_id = v_cli
    and p.id in (select value::uuid from jsonb_array_elements_text(p_pedidos))
    and p.total - coalesce(g.pago, 0) > 0.004;
  get diagnostics v_qtd = row_count;

  select total into v_total from fechamentos_boleto where id = p_id;
  select saldo_devedor into v_saldo from clientes where id = v_cli;
  return jsonb_build_object('id', p_id, 'qtd', v_qtd, 'total', v_total, 'saldo', v_saldo);
end; $$;

-- ================== RPC 4: DETALHE DO FECHAMENTO =====================
create or replace function fechamento_detalhe(p_id uuid)
returns jsonb
language sql stable
set search_path = public
as $$
  select jsonb_build_object(
    'id', f.id, 'numero', f.numero, 'vencimento', f.vencimento, 'total', f.total,
    'observacao', f.observacao, 'criado_em', f.criado_em,
    'cliente_id', f.cliente_id, 'cliente', c.nome, 'saldo', c.saldo_devedor,
    'vendas', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'pedido_id', p.id, 'numero', p.numero, 'data', p.data,
                 'total', p.total, 'valor', g.valor) order by p.data asc)
        from pagamentos_venda g
        join pedidos_venda p on p.id = g.pedido_id
        where g.fechamento_id = f.id), '[]'::jsonb))
  from fechamentos_boleto f
  left join clientes c on c.id = f.cliente_id
  where f.id = p_id;
$$;

-- ================== RPC 5: LISTA DE FECHAMENTOS ======================
create or replace function listar_fechamentos(
  p_cliente uuid default null,
  p_ini     date default null,      -- por vencimento
  p_fim     date default null,
  p_limit   int  default 100
) returns jsonb
language sql stable
set search_path = public
as $$
  select coalesce(jsonb_agg(m order by ord desc, num desc), '[]'::jsonb) from (
    select f.vencimento as ord, f.numero as num, jsonb_build_object(
             'id', f.id, 'numero', f.numero, 'vencimento', f.vencimento,
             'total', f.total, 'criado_em', f.criado_em, 'observacao', f.observacao,
             'cliente_id', f.cliente_id, 'cliente', c.nome,
             'qtd', (select count(*) from pagamentos_venda g where g.fechamento_id = f.id)) as m
    from fechamentos_boleto f
    left join clientes c on c.id = f.cliente_id
    where (p_cliente is null or f.cliente_id = p_cliente)
      and (p_ini is null or f.vencimento >= p_ini)
      and (p_fim is null or f.vencimento <= p_fim)
    order by f.vencimento desc, f.numero desc
    limit p_limit
  ) z;
$$;

-- ============ RPC 6: TROCAR VENCIMENTO / OBSERVAÇÃO ==================
-- Muda a data em todos os boletos do fechamento de uma vez.
create or replace function atualizar_fechamento(
  p_id uuid, p_vencimento date default null, p_observacao text default null
) returns jsonb
language plpgsql
set search_path = public
as $$
declare v_num int; v_venc date;
begin
  update fechamentos_boleto
     set vencimento = coalesce(p_vencimento, vencimento),
         observacao = case when p_observacao is null then observacao
                           else nullif(btrim(p_observacao), '') end
   where id = p_id
   returning numero, vencimento into v_num, v_venc;
  if v_num is null then raise exception 'Fechamento nao encontrado.'; end if;
  update pagamentos_venda set vencimento = v_venc where fechamento_id = p_id;
  return jsonb_build_object('id', p_id, 'numero', v_num, 'vencimento', v_venc);
end; $$;

-- =================== RPC 7: DESFAZER FECHAMENTO ======================
-- Apaga os boletos gerados; as vendas voltam a ficar em aberto e o saldo
-- do cliente volta sozinho (triggers).
create or replace function cancelar_fechamento(p_id uuid)
returns jsonb
language plpgsql
set search_path = public
as $$
declare v_cli uuid; v_num int; v_saldo numeric(14,2);
begin
  select cliente_id, numero into v_cli, v_num from fechamentos_boleto where id = p_id;
  if v_num is null then raise exception 'Fechamento nao encontrado.'; end if;
  delete from pagamentos_venda where fechamento_id = p_id;
  delete from fechamentos_boleto where id = p_id;
  select saldo_devedor into v_saldo from clientes where id = v_cli;
  return jsonb_build_object('numero', v_num, 'cliente_id', v_cli, 'saldo', v_saldo);
end; $$;

-- ============ SALVAR_VENDA CIENTE DO FECHAMENTO ======================
-- A edição de venda apagava TODOS os pagamentos e regravava. Isso levaria
-- junto o boleto do fechamento (o boleto da semana perderia essa venda em
-- silêncio). Agora o boleto do fechamento é preservado e, no fim, reajustado
-- para o que sobrou depois da edição (ou removido, se não sobrou nada).
create or replace function salvar_venda(
  p_pedido_id uuid, p_vendedor_id uuid, p_cliente_id uuid,
  p_observacao text, p_itens jsonb, p_pagamentos jsonb
) returns jsonb language plpgsql as $$
declare
  v_id uuid; v_numero int; v_total numeric(14,2); v_data timestamptz; v_saldo numeric(14,2);
  v_pag_fech uuid; v_fech uuid; v_resto numeric(14,2);
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
    delete from pagamentos_venda where pedido_id=v_id and fechamento_id is null;
  end if;

  insert into itens_venda (pedido_id, produto_id, quantidade, preco_unit, valor)
  select v_id, (e->>'produto_id')::uuid, (e->>'quantidade')::numeric, (e->>'preco_unit')::numeric, (e->>'valor')::numeric
  from jsonb_array_elements(coalesce(p_itens,'[]'::jsonb)) e;

  insert into pagamentos_venda (pedido_id, modalidade, valor, vencimento)
  select v_id, e->>'modalidade', (e->>'valor')::numeric, nullif(e->>'vencimento','')::date
  from jsonb_array_elements(coalesce(p_pagamentos,'[]'::jsonb)) e;

  -- reajuste do boleto do fechamento (se esta venda estiver em um)
  select id, fechamento_id into v_pag_fech, v_fech
    from pagamentos_venda where pedido_id = v_id and fechamento_id is not null limit 1;
  if v_fech is not null then
    select total into v_total from pedidos_venda where id = v_id;
    v_resto := round(v_total - coalesce((select sum(valor) from pagamentos_venda
                 where pedido_id = v_id and fechamento_id is null), 0), 2);
    if v_resto > 0.004 then
      update pagamentos_venda
         set valor = v_resto, vencimento = (select vencimento from fechamentos_boleto where id = v_fech)
       where id = v_pag_fech;
    else
      delete from pagamentos_venda where id = v_pag_fech;
    end if;
  end if;

  select total, data into v_total, v_data from pedidos_venda where id=v_id;
  if p_cliente_id is not null then select saldo_devedor into v_saldo from clientes where id=p_cliente_id; end if;
  return jsonb_build_object('id',v_id,'numero',v_numero,'total',v_total,'data',v_data,'saldo',v_saldo);
end; $$;

-- ---------------------------- RLS ------------------------------------
-- Mesma política aberta das outras tabelas (ver aviso em schema.sql).
alter table fechamentos_boleto enable row level security;
drop policy if exists p_all on fechamentos_boleto;
create policy p_all on fechamentos_boleto for all to anon, authenticated using (true) with check (true);

-- ------------------------- PERMISSÕES --------------------------------
grant execute on function vendas_em_aberto(uuid,timestamptz,timestamptz,int) to anon, authenticated;
grant execute on function fechar_boleto(uuid,date,jsonb,text)                to anon, authenticated;
grant execute on function adicionar_ao_fechamento(uuid,jsonb)               to anon, authenticated;
grant execute on function fechamento_detalhe(uuid)                          to anon, authenticated;
grant execute on function listar_fechamentos(uuid,date,date,int)            to anon, authenticated;
grant execute on function atualizar_fechamento(uuid,date,text)              to anon, authenticated;
grant execute on function cancelar_fechamento(uuid)                         to anon, authenticated;

notify pgrst, 'reload schema';
