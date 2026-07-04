-- =====================================================================
-- Agro Bras Hortifruti — RPC de RELATÓRIOS (agregação no SERVIDOR)
-- ---------------------------------------------------------------------
-- POR QUE: o PostgREST/Supabase corta toda consulta em 1000 linhas
-- (config padrao "max-rows"). Os relatorios antigos baixavam as linhas
-- e somavam no navegador -> a partir de ~1000 pedidos (≈ 4 dias a 250/dia)
-- os totais vinham SILENCIOSAMENTE menores que o real.
--
-- Estas funcoes somam DENTRO do Postgres e devolvem UM jsonb compacto
-- (uma unica linha -> NAO sofre o limite de 1000). Resolve de uma vez a
-- correcao dos numeros E a banda do plano gratis.
--
-- Rode este arquivo INTEIRO no SQL Editor do Supabase. E idempotente.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) VENDAS / COMPRAS  (período + filtros opcionais)
--    p_tipo: 'venda' | 'compra'
--    Devolve: { qtd, total, mods:{dinheiro,pix,cartao,boleto}, aberto, pedidos:[...] }
--    'aberto' (parcial em aberto) = total - soma(pagamentos)  [categoria calculada]
--    A LISTA de pedidos vem limitada (p_lista_limit) só para exibição;
--    os TOTAIS acima sempre consideram TODOS os pedidos do período.
-- ---------------------------------------------------------------------
create or replace function rel_transacao(
  p_tipo        text,
  p_ini         timestamptz,
  p_fim         timestamptz,         -- exclusivo
  p_contra      uuid default null,   -- cliente_id / fornecedor_id
  p_vend        uuid default null,
  p_forma       text default null,   -- pedidos que usaram essa modalidade
  p_lista_limit int  default 2000    -- 0 = não devolve a lista (só totais)
) returns jsonb
language plpgsql stable
set search_path = public
as $func$
declare
  t_ped text; t_pag text; c_contra text; t_emb text;
  v jsonb;
begin
  if p_tipo = 'venda' then
    t_ped := 'pedidos_venda';  t_pag := 'pagamentos_venda';
    c_contra := 'cliente_id';  t_emb := 'clientes';
  elsif p_tipo = 'compra' then
    t_ped := 'pedidos_compra'; t_pag := 'pagamentos_compra';
    c_contra := 'fornecedor_id'; t_emb := 'fornecedores';
  else
    raise exception 'rel_transacao: tipo invalido %', p_tipo;
  end if;

  execute format($q$
    with ped as (
      select p.id, p.numero, p.data, p.total,
             e.nome as contra_nome, v.nome as vend_nome
      from %1$I p
      left join %4$I e on e.id = p.%3$I
      left join vendedores v on v.id = p.vendedor_id
      where p.data >= $1 and p.data < $2
        and ($3 is null or p.%3$I = $3)
        and ($4 is null or p.vendedor_id = $4)
        and ($5 is null or exists (
              select 1 from %2$I g
              where g.pedido_id = p.id and g.modalidade = $5))
    ),
    pg as (
      select g.modalidade, sum(g.valor) as v
      from %2$I g join ped on ped.id = g.pedido_id
      group by g.modalidade
    )
    select jsonb_build_object(
      'qtd',    (select count(*) from ped),
      'total',  coalesce((select sum(total) from ped), 0),
      'mods',   jsonb_build_object(
                  'dinheiro', coalesce((select v from pg where modalidade='dinheiro'),0),
                  'pix',      coalesce((select v from pg where modalidade='pix'),0),
                  'cartao',   coalesce((select v from pg where modalidade='cartao'),0),
                  'boleto',   coalesce((select v from pg where modalidade='boleto'),0)
                ),
      'aberto', coalesce((select sum(total) from ped),0) - coalesce((select sum(v) from pg),0),
      'pedidos', coalesce((
                  select jsonb_agg(jsonb_build_object(
                           'numero', numero, 'data', data, 'total', total,
                           'contra', contra_nome, 'vendedor', vend_nome) order by data asc)
                  from (select * from ped order by data asc limit $6) z
                ), '[]'::jsonb)
    )
  $q$, t_ped, t_pag, c_contra, t_emb)
  into v
  using p_ini, p_fim, p_contra, p_vend, p_forma, p_lista_limit;

  return v;
end;
$func$;

-- ---------------------------------------------------------------------
-- 2) PRODUTOS mais vendidos (sem período). Top N por qtd e por valor,
--    apurado sobre TODOS os itens_venda no servidor (antes baixava a
--    tabela inteira e capava em 1000 itens).
-- ---------------------------------------------------------------------
create or replace function rel_produtos(p_limit int default 30)
returns jsonb
language sql stable
set search_path = public
as $$
  with agg as (
    select i.produto_id, pr.nome, pr.unidade,
           sum(i.quantidade) as qtd, sum(i.valor) as valor
    from itens_venda i
    left join produtos pr on pr.id = i.produto_id
    group by i.produto_id, pr.nome, pr.unidade
  )
  select jsonb_build_object(
    'total_produtos', (select count(*) from agg),
    'por_qtd', coalesce((
        select jsonb_agg(jsonb_build_object('nome',nome,'unidade',unidade,'qtd',qtd,'valor',valor) order by qtd desc)
        from (select * from agg order by qtd desc limit p_limit) a), '[]'::jsonb),
    'por_valor', coalesce((
        select jsonb_agg(jsonb_build_object('nome',nome,'unidade',unidade,'qtd',qtd,'valor',valor) order by valor desc)
        from (select * from agg order by valor desc limit p_limit) b), '[]'::jsonb)
  );
$$;

-- ---------------------------------------------------------------------
-- 3) HISTÓRICO de um cliente/fornecedor (modal). Pedidos + ajustes,
--    ordenado do mais recente, limitado (antes capava em 1000 sem aviso).
-- ---------------------------------------------------------------------
create or replace function rel_historico(p_tipo text, p_id uuid, p_limit int default 500)
returns jsonb
language plpgsql stable
set search_path = public
as $func$
declare
  t_ped text; c_contra text; lbl text; v jsonb;
begin
  if p_tipo = 'cliente' then
    t_ped := 'pedidos_venda';  c_contra := 'cliente_id';   lbl := 'Venda';
  elsif p_tipo = 'fornecedor' then
    t_ped := 'pedidos_compra'; c_contra := 'fornecedor_id'; lbl := 'Compra';
  else
    raise exception 'rel_historico: tipo invalido %', p_tipo;
  end if;

  execute format($q$
    select coalesce(jsonb_agg(m order by ord desc), '[]'::jsonb) from (
      select data as ord,
             jsonb_build_object('data', data, 'txt', %3$L || ' #' || numero,
                                'valor', total, 'tipo', 'pedido') as m
      from %1$I where %2$I = $1
      union all
      select data as ord,
             jsonb_build_object('data', data,
                                'txt', 'Ajuste ' || tipo || coalesce(' · ' || observacao, ''),
                                'valor', case when tipo='debito' then valor else -valor end,
                                'tipo', 'ajuste') as m
      from ajustes_saldo where tipo_entidade = $2 and entidade_id = $1
      order by ord desc
      limit $3
    ) s
  $q$, t_ped, c_contra, lbl)
  into v
  using p_id, p_tipo, p_limit;

  return v;
end;
$func$;

-- ---------------------------------------------------------------------
-- 4) FLUXO por dia (dashboard, 7 dias). Soma vendas e compras por dia
--    no servidor (antes baixava 7 dias de pedidos e capava em 1000).
--    Chaves de data no fuso America/Sao_Paulo (YYYY-MM-DD) — o "dia do
--    negócio" é o dia local, para bater com o KPI "vendas do dia".
--    (Antes agrupava em UTC: uma venda das 22h caía no dia seguinte.)
-- ---------------------------------------------------------------------
create or replace function rel_fluxo(p_ini timestamptz, p_fim timestamptz)
returns jsonb
language sql stable
set search_path = public
as $$
  select jsonb_build_object(
    'vendas', coalesce((
       select jsonb_object_agg(d, s) from (
         select to_char(data at time zone 'America/Sao_Paulo','YYYY-MM-DD') d, sum(total) s
         from pedidos_venda where data >= p_ini and data < p_fim group by 1) a), '{}'::jsonb),
    'compras', coalesce((
       select jsonb_object_agg(d, s) from (
         select to_char(data at time zone 'America/Sao_Paulo','YYYY-MM-DD') d, sum(total) s
         from pedidos_compra where data >= p_ini and data < p_fim group by 1) b), '{}'::jsonb)
  );
$$;

-- ---------------------------------------------------------------------
-- 5) ÚLTIMO PREÇO praticado por produto (venda ou compra). Uma linha por
--    produto (o preço do lançamento mais recente) num JSON só. O app
--    carrega isso 1x ao abrir a tela e mostra "último: R$ X" ao lançar o
--    item — sem consulta por tecla. p_tipo: 'venda' | 'compra'.
--    Formato: { "<produto_id>": { "preco": n, "data": iso }, ... }
-- ---------------------------------------------------------------------
create or replace function rel_ultimo_preco(p_tipo text)
returns jsonb
language plpgsql stable
set search_path = public
as $func$
declare t_item text; t_ped text; v jsonb;
begin
  if p_tipo = 'venda' then
    t_item := 'itens_venda';  t_ped := 'pedidos_venda';
  elsif p_tipo = 'compra' then
    t_item := 'itens_compra'; t_ped := 'pedidos_compra';
  else
    raise exception 'rel_ultimo_preco: tipo invalido %', p_tipo;
  end if;

  execute format($q$
    select coalesce(jsonb_object_agg(produto_id::text,
             jsonb_build_object('preco', preco_unit, 'data', data)), '{}'::jsonb)
    from (
      select distinct on (i.produto_id) i.produto_id, i.preco_unit, p.data
      from %1$I i join %2$I p on p.id = i.pedido_id
      order by i.produto_id, p.data desc
    ) z
  $q$, t_item, t_ped)
  into v;

  return v;
end;
$func$;

-- ---------------------------------------------------------------------
-- Permissões (a app usa a anon key)
-- ---------------------------------------------------------------------
grant execute on function rel_transacao(text,timestamptz,timestamptz,uuid,uuid,text,int) to anon, authenticated;
grant execute on function rel_produtos(int)                                              to anon, authenticated;
grant execute on function rel_historico(text,uuid,int)                                   to anon, authenticated;
grant execute on function rel_fluxo(timestamptz,timestamptz)                             to anon, authenticated;
grant execute on function rel_ultimo_preco(text)                                         to anon, authenticated;

-- Recarrega o cache de schema do PostgREST (pra a app enxergar as funcoes na hora)
notify pgrst, 'reload schema';
