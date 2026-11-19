-- REVIEW ONLY. Not applied to production. Apply first in an isolated test database.
-- Additive tables; no existing table, function, property ID or owner link is modified.
begin;
create table public.lm_photo_permissions (
 staff_id uuid primary key references public.lm_staff(id),
 can_read boolean not null default false,
 can_edit boolean not null default false,
 can_approve boolean not null default false
);
create table public.lm_photo_assets (
 id uuid primary key default gen_random_uuid(), thumb_hash text not null check(thumb_hash ~ '^[a-f0-9]{64}$'), hash text not null unique check(hash ~ '^[a-f0-9]{64}$'),
 object_key text not null unique, thumb_key text not null unique,
 bytes bigint not null check(bytes between 1 and 737280), thumb_bytes bigint not null check(thumb_bytes between 1 and 81920),
 width integer not null check(width between 1 and 1920), height integer not null check(height between 1 and 1920),
 state text not null default 'pending' check(state in ('pending','ready')),
 lease uuid not null default gen_random_uuid(), leased_at timestamptz not null default now(),
 created_by uuid not null references public.lm_staff(id), created_at timestamptz not null default now()
);
create table public.lm_photo_links (
 property_id text not null check(length(property_id) between 1 and 200), asset_id uuid not null references public.lm_photo_assets(id),
 position integer not null default 0, is_cover boolean not null default false,
 ad_approved boolean not null default false, approved_by uuid references public.lm_staff(id), approved_at timestamptz,
 deleted_at timestamptz, updated_at timestamptz not null default now(), primary key(property_id,asset_id)
);
create unique index lm_photo_one_cover on public.lm_photo_links(property_id) where is_cover and deleted_at is null;
create index lm_photo_property_order on public.lm_photo_links(property_id,position) where deleted_at is null;
create table public.lm_photo_audit (
 id bigint generated always as identity primary key, staff_id uuid not null references public.lm_staff(id),
 action text not null, property_id text, asset_id uuid, occurred_at timestamptz not null default now(), detail jsonb not null default '{}'
);
create index lm_photo_audit_date on public.lm_photo_audit(occurred_at);
create table public.lm_photo_meter (
 month date primary key, class_a bigint not null default 0, class_b bigint not null default 0
);
create table public.lm_photo_limits (
 id integer primary key check(id=1), max_bytes bigint not null check(max_bytes>0), max_class_a bigint not null, max_class_b bigint not null
);
-- Initial application usage guardrails; NAVER storage is paid by usage, not a free tier.
insert into public.lm_photo_limits values(1,8000000000,900000,9000000);
-- No implicit photo permissions for any existing employee. Explicitly enable after review.
insert into public.lm_photo_permissions(staff_id) select id from public.lm_staff;
alter table public.lm_photo_permissions enable row level security;
alter table public.lm_photo_assets enable row level security;
alter table public.lm_photo_links enable row level security;
alter table public.lm_photo_audit enable row level security;
alter table public.lm_photo_meter enable row level security;
alter table public.lm_photo_limits enable row level security;
revoke all on public.lm_photo_permissions,public.lm_photo_assets,public.lm_photo_links,public.lm_photo_audit,public.lm_photo_meter,public.lm_photo_limits from public,anon,authenticated;
grant all on public.lm_photo_permissions,public.lm_photo_assets,public.lm_photo_links,public.lm_photo_audit,public.lm_photo_meter,public.lm_photo_limits to service_role;
grant usage,select on sequence public.lm_photo_audit_id_seq to service_role;
-- Existing app tables may revoke service_role's default SELECT privileges.
-- Photo authorization and property validation only need read access.
grant select on public.lm_staff,public.lm_cloud_workspace,public.lm_new_properties,public.lm_import_rows,public.lm_access_property_edits to service_role;

create function public.lm_photo_property_exists(p_id text) returns boolean language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.lm_cloud_workspace w, jsonb_array_elements(w.data->'properties') p where w.id=1 and p->>'id'=p_id and coalesce(p->>'__lm_deleted','false')<>'true')
 or exists(select 1 from public.lm_new_properties p where p.id::text=p_id and coalesce(p.original_data->>'__lm_deleted','false')<>'true')
 or exists(select 1 from public.lm_import_rows p left join public.lm_access_property_edits e on e.source_id=p.id where p.id::text=p_id and p.source_table in ('기본자료','기본자료1') and coalesce(e.edited_data->>'__lm_deleted','false')<>'true');
$$;
revoke all on function public.lm_photo_property_exists(text) from public,anon,authenticated;
grant execute on function public.lm_photo_property_exists(text) to service_role;

create function public.lm_photo_dispatch(p_user uuid,p_action text,p_args jsonb default '{}') returns jsonb
language plpgsql security invoker set search_path='' as $$
declare
 s uuid; permission public.lm_photo_permissions; a public.lm_photo_assets; l public.lm_photo_links;
 pid text := p_args->>'propertyId'; aid uuid; source_pid text; result jsonb; mid date := date_trunc('month',now())::date;
 lim public.lm_photo_limits; met public.lm_photo_meter; used bigint; lease_id uuid; ids jsonb;
begin
 select st.id into s from public.lm_staff st where st.auth_user_id=p_user;
 select * into permission from public.lm_photo_permissions where staff_id=s;
 if s is null or permission.staff_id is null or not permission.can_read then raise exception 'photo permission denied' using errcode='42501'; end if;
 if p_action='authorize' then return to_jsonb(permission)-'staff_id'; end if;
 -- Serializes quota reservations, dedup leases and all link mutations across four employees.
 perform pg_advisory_xact_lock(794615302);
 if p_action not in ('list','usage','covers','checkMedia','media') and not permission.can_edit then raise exception 'edit denied' using errcode='42501'; end if;
 if pid is not null and not public.lm_photo_property_exists(pid) then raise exception 'property not found' using errcode='P0002'; end if;
 if p_action not in ('usage','covers') and pid is null then raise exception 'property required' using errcode='P0002'; end if;
 insert into public.lm_photo_meter(month) values(mid) on conflict do nothing;
 select * into lim from public.lm_photo_limits where id=1;
 select * into met from public.lm_photo_meter where month=mid;
 if lim.id is null then raise exception 'photo limits missing' using errcode='42501'; end if;
 if p_args ? 'assetId' then aid := (p_args->>'assetId')::uuid; end if;
 if p_action='usage' then
  select coalesce(sum(bytes+thumb_bytes),0) into used from public.lm_photo_assets;
  result := jsonb_build_object('count',(select count(*) from public.lm_photo_assets where state='ready'),'bytes',used,'pending',(select count(*) from public.lm_photo_assets where state='pending'),'classA',met.class_a,'classB',met.class_b,'limits',to_jsonb(lim),'scope','이 앱 전용 · 실제 저장·전송 요금은 네이버클라우드에서 확인');
 elsif p_action='covers' then
  if jsonb_typeof(p_args->'propertyIds')<>'array' or jsonb_array_length(p_args->'propertyIds')>100 then raise exception 'invalid cover batch'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('propertyId',q.property_id,'assetId',q.asset_id)),'[]') into result from
   (select distinct on(x.property_id) x.property_id,x.asset_id from public.lm_photo_links x join public.lm_photo_assets aa on aa.id=x.asset_id where x.deleted_at is null and aa.state='ready' and p_args->'propertyIds' ? x.property_id and public.lm_photo_property_exists(x.property_id) order by x.property_id,x.is_cover desc,x.position,x.asset_id) q;
 elsif p_action='list' then
  select jsonb_build_object('permissions',to_jsonb(permission)-'staff_id','photos',coalesce(jsonb_agg(to_jsonb(x)-'property_id'||jsonb_build_object('width',aa.width,'height',aa.height,'bytes',aa.bytes) order by x.position,x.asset_id),'[]')) into result
  from public.lm_photo_links x join public.lm_photo_assets aa on aa.id=x.asset_id where x.property_id=pid and aa.state='ready' and (x.deleted_at is null or coalesce((p_args->>'trash')::boolean,false)) and (not coalesce((p_args->>'adsOnly')::boolean,false) or x.ad_approved and x.deleted_at is null);
 elsif p_action='reserve' then
  if not (p_args->>'hash' ~ '^[a-f0-9]{64}$') then raise exception 'invalid hash'; end if;
  select * into a from public.lm_photo_assets where hash=p_args->>'hash';
  if a.id is not null and a.state='ready' then
   insert into public.lm_photo_links(property_id,asset_id,position) values(pid,a.id,(select coalesce(max(position)+1,0) from public.lm_photo_links where property_id=pid)) on conflict do nothing;
   select * into l from public.lm_photo_links where property_id=pid and asset_id=a.id;
   if l.deleted_at is not null then raise exception 'restore deleted photo first' using errcode='40001'; end if;
   result:=jsonb_build_object('ready',true,'assetId',a.id,'deduplicated',true);
  else
   if a.id is not null and a.leased_at>now()-interval '2 minutes' then raise exception 'upload in progress' using errcode='40001'; end if;
   if met.class_a+2>lim.max_class_a then raise exception 'request cap' using errcode='54000'; end if;
   update public.lm_photo_meter set class_a=class_a+2 where month=mid;
   if a.id is null then
    select coalesce(sum(bytes+thumb_bytes),0) into used from public.lm_photo_assets;
    if used+(p_args->>'bytes')::bigint+(p_args->>'thumbBytes')::bigint>lim.max_bytes then raise exception 'storage cap' using errcode='54000'; end if;
    aid:=gen_random_uuid();
    insert into public.lm_photo_assets(id,hash,thumb_hash,object_key,thumb_key,bytes,thumb_bytes,width,height,created_by)
    values(aid,p_args->>'hash',p_args->>'thumbHash','photos/'||aid||'/full.jpg','photos/'||aid||'/thumb.jpg',(p_args->>'bytes')::bigint,(p_args->>'thumbBytes')::bigint,(p_args->>'width')::int,(p_args->>'height')::int,s) returning * into a;
   else
    if a.thumb_hash<>p_args->>'thumbHash' or a.bytes<>(p_args->>'bytes')::bigint or a.thumb_bytes<>(p_args->>'thumbBytes')::bigint then raise exception 'pending upload content mismatch' using errcode='40001'; end if;
    update public.lm_photo_assets set lease=gen_random_uuid(),leased_at=now() where id=a.id returning * into a;
   end if;
   result:=jsonb_build_object('ready',false,'assetId',a.id,'lease',a.lease,'object_key',a.object_key,'thumb_key',a.thumb_key);
  end if;
 elsif p_action='complete' then
  select * into a from public.lm_photo_assets where id=aid and lease=(p_args->>'lease')::uuid;
  if a.id is null then raise exception 'stale upload lease' using errcode='40001'; end if;
  update public.lm_photo_assets set state='ready' where id=aid;
  insert into public.lm_photo_links(property_id,asset_id,position) values(pid,aid,(select coalesce(max(position)+1,0) from public.lm_photo_links where property_id=pid)) on conflict do nothing;
  result:=jsonb_build_object('ready',true,'assetId',aid);
 elsif p_action='reorder' then
  ids:=p_args->'assetIds';
  if jsonb_typeof(ids)<>'array' or jsonb_array_length(ids)>500 or jsonb_array_length(ids)<>(select count(distinct value) from jsonb_array_elements_text(ids)) or
    jsonb_array_length(ids)<>(select count(*) from public.lm_photo_links where property_id=pid and deleted_at is null) or
    exists(select 1 from jsonb_array_elements_text(ids) i where not exists(select 1 from public.lm_photo_links x where x.property_id=pid and x.asset_id::text=i.value and x.deleted_at is null)) then raise exception 'stale photo order' using errcode='40001'; end if;
  update public.lm_photo_links x set position=i.ordinality::int,updated_at=now() from jsonb_array_elements_text(ids) with ordinality i where x.property_id=pid and x.asset_id::text=i.value;
  result:='{"ok":true}';
 elsif p_action='link' then
  source_pid:=p_args->>'sourcePropertyId';
  if not public.lm_photo_property_exists(source_pid) or not exists(select 1 from public.lm_photo_links where property_id=source_pid and asset_id=aid and deleted_at is null) then raise exception 'source denied' using errcode='P0002'; end if;
  insert into public.lm_photo_links(property_id,asset_id,position) values(pid,aid,(select coalesce(max(position)+1,0) from public.lm_photo_links where property_id=pid)) on conflict do nothing;
  -- Advertising approval is intentionally NOT copied to another property.
  result:='{"ok":true}';
 else
  select * into l from public.lm_photo_links where property_id=pid and asset_id=aid;
  select * into a from public.lm_photo_assets where id=aid and state='ready';
  if l.asset_id is null or a.id is null or (l.deleted_at is not null and p_action<>'restore') then raise exception 'photo not found' using errcode='P0002'; end if;
  if p_action in ('checkMedia','media') then
   if p_args->>'purpose' not in ('view','download') or p_args->>'variant' not in ('full','thumb') then raise exception 'bad media'; end if;
   if p_args->>'purpose'='download' and not l.ad_approved then raise exception 'ad not approved' using errcode='42501'; end if;
   if p_action='media' then
    if met.class_b+1>lim.max_class_b then raise exception 'read cap' using errcode='54000'; end if;
    update public.lm_photo_meter set class_b=class_b+1 where month=mid;
   end if;
   result:=jsonb_build_object('object_key',a.object_key,'thumb_key',a.thumb_key);
  elsif p_action='update' then
   if p_args ? 'adApproved' then
    if not permission.can_approve then raise exception 'approval denied' using errcode='42501'; end if;
    update public.lm_photo_links set ad_approved=(p_args->>'adApproved')::boolean,approved_by=s,approved_at=now(),updated_at=now() where property_id=pid and asset_id=aid;
   end if;
   if coalesce((p_args->>'cover')::boolean,false) then
    update public.lm_photo_links set is_cover=false where property_id=pid and is_cover;
    update public.lm_photo_links set is_cover=true,updated_at=now() where property_id=pid and asset_id=aid;
   end if;
   result:='{"ok":true}';
  elsif p_action='unlink' then
   update public.lm_photo_links set deleted_at=now(),is_cover=false,ad_approved=false,approved_by=null,approved_at=null,updated_at=now() where property_id=pid and asset_id=aid;
   result:='{"ok":true}';
  elsif p_action='restore' then
   update public.lm_photo_links set deleted_at=null,is_cover=false,ad_approved=false,approved_by=null,approved_at=null,updated_at=now() where property_id=pid and asset_id=aid;
   result:='{"ok":true}';
  else raise exception 'unsupported action'; end if;
 end if;
 if p_action<>'checkMedia' then insert into public.lm_photo_audit(staff_id,action,property_id,asset_id,detail) values(s,p_action,pid,aid,jsonb_strip_nulls(jsonb_build_object('purpose',p_args->>'purpose','variant',p_args->>'variant','adApproved',p_args->'adApproved','cover',p_args->'cover','assetIds',p_args->'assetIds','sourcePropertyId',p_args->>'sourcePropertyId'))); end if;
 return result;
end;
$$;
revoke all on function public.lm_photo_dispatch(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.lm_photo_dispatch(uuid,text,jsonb) to service_role;
commit;
