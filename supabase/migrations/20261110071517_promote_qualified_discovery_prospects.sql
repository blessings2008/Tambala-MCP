create unique index if not exists leads_discovery_queue_source_uidx
  on public.leads (source)
  where source like 'lead_discovery_queue:%';

create or replace function public.promote_qualified_discovery_prospect(p_queue_id uuid)
returns table(outcome text, lead_id uuid)
language plpgsql
security invoker
set search_path = public
as $function$
declare
  v_queue public.lead_discovery_queue%rowtype;
  v_lead_id uuid;
  v_client_id uuid;
  v_source text;
begin
  select * into v_queue
  from public.lead_discovery_queue
  where id = p_queue_id
  for update;

  if not found then
    raise exception 'Discovery queue record % does not exist', p_queue_id;
  end if;

  if v_queue.processing_status = 'promoted' and v_queue.crm_lead_id is not null then
    return query select 'promoted'::text, v_queue.crm_lead_id;
    return;
  end if;

  if v_queue.processing_status = 'duplicate' then
    return query select 'duplicate'::text, v_queue.crm_lead_id;
    return;
  end if;

  if v_queue.processing_status <> 'qualified' then
    raise exception 'Discovery queue record % is not qualified (status: %)', p_queue_id, v_queue.processing_status;
  end if;

  if v_queue.verification_status <> 'verified' then
    raise exception 'Discovery queue record % is not verified', p_queue_id;
  end if;

  if nullif(btrim(v_queue.public_email), '') is null
     and nullif(btrim(v_queue.public_phone), '') is null then
    raise exception 'Discovery queue record % has no public organisation contact', p_queue_id;
  end if;

  select l.id into v_lead_id
  from public.leads l
  where lower(btrim(coalesce(nullif(btrim(l.business_name), ''), l.name))) = lower(btrim(v_queue.organisation_name))
  order by l.created_at asc
  limit 1;

  if v_lead_id is not null then
    update public.lead_discovery_queue
    set processing_status = 'duplicate',
        crm_lead_id = v_lead_id,
        research_notes = concat_ws(E'\n', research_notes, 'Matched an existing CRM lead; no new lead was created.'),
        updated_at = now()
    where id = p_queue_id;
    return query select 'duplicate'::text, v_lead_id;
    return;
  end if;

  select c.id into v_client_id
  from public.clients c
  where c.status in ('lead', 'active')
    and lower(btrim(coalesce(nullif(btrim(c.business_name), ''), c.name))) = lower(btrim(v_queue.organisation_name))
  order by c.created_at asc
  limit 1;

  if v_client_id is not null then
    update public.lead_discovery_queue
    set processing_status = 'duplicate',
        research_notes = concat_ws(E'\n', research_notes, 'Matched an existing CRM client; no new lead was created.'),
        updated_at = now()
    where id = p_queue_id;
    return query select 'duplicate'::text, null::uuid;
    return;
  end if;

  v_source := 'lead_discovery_queue:' || p_queue_id::text;

  insert into public.leads (name, business_name, email, phone, source, status, notes)
  values (
    coalesce(nullif(btrim(v_queue.decision_maker_name), ''), v_queue.organisation_name),
    v_queue.organisation_name,
    nullif(btrim(v_queue.public_email), ''),
    nullif(btrim(v_queue.public_phone), ''),
    v_source,
    'new',
    concat_ws(E'\n',
      'Imported from verified Tambala prospect research.',
      'Queue record: ' || p_queue_id::text,
      'Sector: ' || coalesce(v_queue.sector, 'Not supplied'),
      'Service fit: ' || coalesce(array_to_string(v_queue.service_fit, ', '), 'Not supplied'),
      'Reason for fit: ' || coalesce(v_queue.reason_for_fit, 'Not supplied'),
      'Website: ' || coalesce(v_queue.website, 'Not supplied'),
      'Source evidence: ' || coalesce(v_queue.source_urls::text, '[]')
    )
  )
  on conflict (source) where source like 'lead_discovery_queue:%'
  do nothing
  returning id into v_lead_id;

  if v_lead_id is null then
    select l.id into v_lead_id
    from public.leads l
    where l.source = v_source
    limit 1;
  end if;

  if v_lead_id is null then
    raise exception 'CRM lead creation did not return an ID for queue record %', p_queue_id;
  end if;

  update public.lead_discovery_queue
  set processing_status = 'promoted',
      crm_lead_id = v_lead_id,
      updated_at = now()
  where id = p_queue_id;

  return query select 'promoted'::text, v_lead_id;
end;
$function$;

revoke all on function public.promote_qualified_discovery_prospect(uuid) from public, anon, authenticated;
grant execute on function public.promote_qualified_discovery_prospect(uuid) to service_role;