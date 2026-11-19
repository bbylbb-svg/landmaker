-- Additive document attachment schema. Apply only after production approval.
begin;
create table public.lm_document_files (
 id uuid primary key default gen_random_uuid(), property_id text not null check(length(property_id) between 1 and 200),
 hash text not null check(hash ~ '^[a-f0-9]{64}$'), file_name text not null check(length(file_name) between 1 and 200),
 extension text not null check(extension in ('xlsx','xls','pdf','docx','doc','pptx','ppt','hwp','hwpx')),
 bytes bigint not null check(bytes between 1 and 31457280), object_key text not null unique,
 state text not null default 'pending' check(state in ('pending','ready')), lease uuid not null default gen_random_uuid(), leased_at timestamptz not null default now(),
 created_by uuid not null references public.lm_staff(id),created_at timestamptz not null default now(),deleted_at timestamptz,
 unique(property_id,hash)
);
create index lm_document_property_date on public.lm_document_files(property_id,created_at desc);
alter table public.lm_document_files enable row level security;
revoke all on public.lm_document_files from public,anon,authenticated;
grant all on public.lm_document_files to service_role;
create function public.lm_document_dispatch(p_user uuid,p_action text,p_args jsonb default '{}') returns jsonb
language plpgsql security invoker set search_path='' as $$
declare s uuid; permission public.lm_photo_permissions; d public.lm_document_files;
 pid text:=p_args->>'propertyId'; aid uuid; result jsonb; used bigint; mid date:=date_trunc('month',now())::date;
 lim public.lm_photo_limits; met public.lm_photo_meter;
begin
 select st.id into s from public.lm_staff st where st.auth_user_id=p_user;
 select * into permission from public.lm_photo_permissions where staff_id=s;
 if s is null or permission.staff_id is null or not permission.can_read then raise exception 'document permission denied' using errcode='42501';end if;
 if p_action='authorize' then return to_jsonb(permission)-'staff_id';end if;
 if p_action not in ('list','usage','checkDownload','download','reserve','complete','delete','restore') then raise exception 'unsupported document action';end if;
 if p_action in ('reserve','complete','delete','restore') and not permission.can_edit then raise exception 'edit denied' using errcode='42501';end if;
 if p_action<>'usage' and (pid is null or not public.lm_photo_property_exists(pid)) then raise exception 'property not found' using errcode='P0002';end if;
 -- Shared request counters and lock with photographs. Document storage has a separate 1GB application cap.
 perform pg_advisory_xact_lock(794615302);
 insert into public.lm_photo_meter(month) values(mid) on conflict do nothing;
 select * into lim from public.lm_photo_limits where id=1;
 select * into met from public.lm_photo_meter where month=mid;
 if lim.id is null then raise exception 'limits missing' using errcode='42501';end if;
 if p_args ? 'fileId' then aid:=(p_args->>'fileId')::uuid;end if;
 if p_action='usage' then
  select coalesce(sum(bytes),0) into used from public.lm_document_files;
  result:=jsonb_build_object('bytes',used,'limitBytes',1000000000,'count',(select count(*) from public.lm_document_files where state='ready'),'classA',met.class_a,'classB',met.class_b,'scope','문서 1GB는 앱 제한이며 무료 용량이 아닙니다. 보관·예약 포함. 읽기·쓰기 횟수는 사진과 공동 집계.');
 elsif p_action='list' then
  select jsonb_build_object('permissions',to_jsonb(permission)-'staff_id','files',coalesce(jsonb_agg(jsonb_build_object('id',x.id,'file_name',x.file_name,'extension',x.extension,'bytes',x.bytes,'created_at',x.created_at,'deleted_at',x.deleted_at) order by x.created_at desc),'[]')) into result from public.lm_document_files x where property_id=pid and state='ready' and (x.deleted_at is null or coalesce((p_args->>'trash')::boolean,false));
 elsif p_action='reserve' then
  if not(p_args->>'hash' ~ '^[a-f0-9]{64}$') then raise exception 'invalid hash';end if;
  select * into d from public.lm_document_files where property_id=pid and hash=p_args->>'hash';
  if d.id is not null and d.state='ready' then
   if d.deleted_at is not null then raise exception 'restore deleted document first' using errcode='40001';end if;
   result:=jsonb_build_object('ready',true,'fileId',d.id,'deduplicated',true);
  else
   if d.id is not null and d.leased_at>now()-interval '2 minutes' then raise exception 'upload in progress' using errcode='40001';end if;
   if met.class_a+1>lim.max_class_a then raise exception 'request cap' using errcode='54000';end if;
   if d.id is null then
    select coalesce(sum(bytes),0) into used from public.lm_document_files;
    if used+(p_args->>'bytes')::bigint>1000000000 then raise exception 'document storage cap' using errcode='54000';end if;
    aid:=gen_random_uuid();
    insert into public.lm_document_files(id,property_id,hash,file_name,extension,bytes,object_key,created_by)
    values(aid,pid,p_args->>'hash',p_args->>'fileName',p_args->>'extension',(p_args->>'bytes')::bigint,'documents/'||aid||'/original.'||(p_args->>'extension'),s) returning * into d;
   else
    if d.bytes<>(p_args->>'bytes')::bigint or d.extension<>p_args->>'extension' then raise exception 'pending content mismatch' using errcode='40001';end if;
    update public.lm_document_files set lease=gen_random_uuid(),leased_at=now() where id=d.id returning * into d;
   end if;
   update public.lm_photo_meter set class_a=class_a+1 where month=mid;
   result:=jsonb_build_object('ready',false,'fileId',d.id,'lease',d.lease,'object_key',d.object_key);
  end if;
 else
  select * into d from public.lm_document_files where id=aid and property_id=pid;
  if d.id is null then raise exception 'document not found' using errcode='P0002';end if;
  if p_action='complete' then
   if d.lease<>(p_args->>'lease')::uuid or p_args->>'lease' is null then raise exception 'stale upload lease' using errcode='40001';end if;
   update public.lm_document_files set state='ready' where id=aid;
  else
   if d.state<>'ready' or (d.deleted_at is not null and p_action<>'restore') then raise exception 'document not found' using errcode='P0002';end if;
   if p_action in ('checkDownload','download') then
    if p_action='download' then
     if met.class_b+1>lim.max_class_b then raise exception 'read cap' using errcode='54000';end if;
     update public.lm_photo_meter set class_b=class_b+1 where month=mid;
    end if;
    result:=jsonb_build_object('object_key',d.object_key,'file_name',d.file_name,'bytes',d.bytes);
   elsif p_action='delete' then update public.lm_document_files set deleted_at=now() where id=aid;
   elsif p_action='restore' then update public.lm_document_files set deleted_at=null where id=aid;
   end if;
  end if;
  result:=coalesce(result,'{"ok":true}'::jsonb);
 end if;
 if p_action<>'checkDownload' then insert into public.lm_photo_audit(staff_id,action,property_id,asset_id) values(s,'document:'||p_action,pid,coalesce(aid,d.id));end if;
 return result;
end;$$;
revoke all on function public.lm_document_dispatch(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.lm_document_dispatch(uuid,text,jsonb) to service_role;
commit;
