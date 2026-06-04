-- =====================================================================
-- Agro Bras Hortifruti — Funções RPC para gravar venda/compra ATÔMICA
-- ---------------------------------------------------------------------
-- Rodam tudo numa única transação: criar ou editar um pedido (pedido +
-- itens + pagamentos) é "tudo ou nada". Se cair a conexão no meio de uma
-- edição, NADA é alterado — o pedido nunca fica pela metade.
--
-- Rode este arquivo no SQL Editor do Supabase. É idempotente (pode rodar
-- de novo sem problema). Já está incluído no final de schema.sql também.
-- =====================================================================

create or replace function salvar_venda(
  p_pedido_id   uuid,    -- null = nova venda; preenchido = edição
  p_vendedor_id uuid,
  p_cliente_id  uuid,    -- null = avulsa
  p_observacao  text,
  p_itens       jsonb,   -- [{produto_id, quantidade, preco_unit, valor}]
  p_pagamentos  jsonb    -- [{modalidade, valor, vencimento}]
) returns jsonb
language plpgsql
as $$
declare
  v_id uuid; v_numero int; v_total numeric(14,2); v_data timestamptz; v_saldo numeric(14,2);
begin
  if p_pedido_id is null then
    insert into pedidos_venda (vendedor_id, cliente_id, observacao)
    values (p_vendedor_id, p_cliente_id, p_observacao)
    returning id, numero into v_id, v_numero;
  else
    v_id := p_pedido_id;
    update pedidos_venda
       set vendedor_id = p_vendedor_id, cliente_id = p_cliente_id, observacao = p_observacao
     where id = v_id
     returning numero into v_numero;
    if v_numero is null then raise exception 'Venda % nao encontrada', p_pedido_id; end if;
    delete from itens_venda where pedido_id = v_id;
    delete from pagamentos_venda where pedido_id = v_id;
  end if;

  insert into itens_venda (pedido_id, produto_id, quantidade, preco_unit, valor)
  select v_id, (e->>'produto_id')::uuid, (e->>'quantidade')::numeric,
         (e->>'preco_unit')::numeric, (e->>'valor')::numeric
  from jsonb_array_elements(coalesce(p_itens, '[]'::jsonb)) e;

  insert into pagamentos_venda (pedido_id, modalidade, valor, vencimento)
  select v_id, e->>'modalidade', (e->>'valor')::numeric, nullif(e->>'vencimento','')::date
  from jsonb_array_elements(coalesce(p_pagamentos, '[]'::jsonb)) e;

  select total, data into v_total, v_data from pedidos_venda where id = v_id;
  if p_cliente_id is not null then
    select saldo_devedor into v_saldo from clientes where id = p_cliente_id;
  end if;

  return jsonb_build_object('id', v_id, 'numero', v_numero, 'total', v_total, 'data', v_data, 'saldo', v_saldo);
end; $$;

create or replace function salvar_compra(
  p_pedido_id     uuid,
  p_vendedor_id   uuid,
  p_fornecedor_id uuid,
  p_observacao    text,
  p_itens         jsonb,
  p_pagamentos    jsonb
) returns jsonb
language plpgsql
as $$
declare
  v_id uuid; v_numero int; v_total numeric(14,2); v_data timestamptz; v_saldo numeric(14,2);
begin
  if p_pedido_id is null then
    insert into pedidos_compra (vendedor_id, fornecedor_id, observacao)
    values (p_vendedor_id, p_fornecedor_id, p_observacao)
    returning id, numero into v_id, v_numero;
  else
    v_id := p_pedido_id;
    update pedidos_compra
       set vendedor_id = p_vendedor_id, fornecedor_id = p_fornecedor_id, observacao = p_observacao
     where id = v_id
     returning numero into v_numero;
    if v_numero is null then raise exception 'Compra % nao encontrada', p_pedido_id; end if;
    delete from itens_compra where pedido_id = v_id;
    delete from pagamentos_compra where pedido_id = v_id;
  end if;

  insert into itens_compra (pedido_id, produto_id, quantidade, preco_unit, valor)
  select v_id, (e->>'produto_id')::uuid, (e->>'quantidade')::numeric,
         (e->>'preco_unit')::numeric, (e->>'valor')::numeric
  from jsonb_array_elements(coalesce(p_itens, '[]'::jsonb)) e;

  insert into pagamentos_compra (pedido_id, modalidade, valor, vencimento)
  select v_id, e->>'modalidade', (e->>'valor')::numeric, nullif(e->>'vencimento','')::date
  from jsonb_array_elements(coalesce(p_pagamentos, '[]'::jsonb)) e;

  select total, data into v_total, v_data from pedidos_compra where id = v_id;
  if p_fornecedor_id is not null then
    select saldo_aberto into v_saldo from fornecedores where id = p_fornecedor_id;
  end if;

  return jsonb_build_object('id', v_id, 'numero', v_numero, 'total', v_total, 'data', v_data, 'saldo', v_saldo);
end; $$;
