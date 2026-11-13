-- Additive synchronization journal. Existing workspace rows are never initialized.
create table if not exists lm_private.sync_operations_v1 (
 scope text not null, operation_id uuid not null, actor_id uuid not null,
 device_id text not null, request jsonb not null, result jsonb not null,
 received_at timestamptz not null default clock_timestamp(),
 primary key(scope,operation_id)
);
create table if not exists lm_private.sync_test_workspaces_v1 (
 id uuid primary key, version bigint not null default 0,
 data jsonb not null default '{}'::jsonb
);
revoke all on lm_private.sync_operations_v1,lm_private.sync_test_workspaces_v1 from public,anon,authenticated;

create or replace function lm_private.sync_merge_v1(b jsonb,l jsonb,r jsonb,path text default '')
returns jsonb language plpgsql immutable set search_path='' as $$
declare k text; m jsonb; v jsonb; cs jsonb='[]'::jsonb; obj jsonb='{}'::jsonb;
begin
 if l is not distinct from b then v=r;
 elsif r is not distinct from b or l is not distinct from r then v=l;
 elsif jsonb_typeof(b)='object' and jsonb_typeof(l)='object' and jsonb_typeof(r)='object' then
  for k in select distinct x from (select jsonb_object_keys(b) x union select jsonb_object_keys(l) union select jsonb_object_keys(r)) q loop
   if k in ('updatedAt','updatedBy','updated_at','updated_by') then
    if l ? k then obj=obj||jsonb_build_object(k,l->k); elsif r ? k then obj=obj||jsonb_build_object(k,r->k); end if;
   else
    m=lm_private.sync_merge_v1(b->k,l->k,r->k,path||'/'||k);
    cs=cs||(m->'conflicts');
    if (m->>'present')::boolean then obj=obj||jsonb_build_object(k,m->'value'); end if;
   end if;
  end loop;
  return jsonb_build_object('present',true,'value',obj,'conflicts',cs);
 else return jsonb_build_object('present',r is not null,'value',r,'conflicts',jsonb_build_array(path));
 end if;
 return jsonb_build_object('present',v is not null,'value',v,'conflicts','[]'::jsonb);
end $$;
revoke all on function lm_private.sync_merge_v1(jsonb,jsonb,jsonb,text) from public,anon,authenticated;

create or replace function lm_private.sync_apply_v1(p_operation jsonb,p_test_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 opid uuid; scope_name text=coalesce(p_test_id::text,'live'); uid uuid=auth.uid();
 target text=p_operation->>'target'; col text=p_operation->>'collection'; rid text=p_operation->>'record_id';
 keycol text; state jsonb; current_row jsonb; before_row jsonb=nullif(p_operation->'before','null'::jsonb);
 after_row jsonb=nullif(p_operation->'after','null'::jsonb); merged jsonb; value jsonb; ver bigint;
 old_request jsonb; result jsonb; columns_sql text; values_sql text; set_sql text;
 allowed_cols text[];
begin
 if uid is null or not (select lm_private.is_staff()) then raise exception 'not authorized' using errcode='42501'; end if;
 if jsonb_typeof(p_operation)<>'object' or not(p_operation ?& array['id','device_id','target','collection','record_id','before','after']) then raise exception 'invalid operation'; end if;
 opid=(p_operation->>'id')::uuid;
 if coalesce(length(p_operation->>'device_id'),0)<1 or length(p_operation->>'device_id')>150 or coalesce(length(rid),0)=0 then raise exception 'invalid identity'; end if;
 if p_operation->>'actor_id' is distinct from uid::text then raise exception 'operation belongs to another staff account' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended('landmaker-sync-'||scope_name,0));
 select o.request,o.result into old_request,result from lm_private.sync_operations_v1 o where o.scope=scope_name and o.operation_id=opid;
 if found then
  if old_request is distinct from p_operation then raise exception 'operation id reused with different content'; end if;
  return result;
 end if;
 if p_test_id is null then
  select data,version into state,ver from public.lm_cloud_workspace where id=1 for update;
  if not found then raise exception 'workspace missing'; end if;
 else
  insert into lm_private.sync_test_workspaces_v1(id) values(p_test_id) on conflict do nothing;
  select data,version into state,ver from lm_private.sync_test_workspaces_v1 where id=p_test_id for update;
 end if;
 if target='core' then
  if col not in ('customers','properties','records','schedules','transactions','ownership','quick','auditLog','propertyGroups') then raise exception 'unsupported collection'; end if;
  if jsonb_typeof(coalesce(state->col,'[]'::jsonb))<>'array' then raise exception 'invalid workspace array'; end if;
  if (select count(*) from jsonb_array_elements(coalesce(state->col,'[]'::jsonb)) e where e->>'id'=rid)>1 then raise exception 'duplicate server record identity'; end if;
  select e into current_row from jsonb_array_elements(coalesce(state->col,'[]'::jsonb)) e where e->>'id'=rid;
  if after_row is not null and (jsonb_typeof(after_row)<>'object' or after_row->>'id' is distinct from rid) then raise exception 'record identity mismatch'; end if;
 elsif target='map' and col in ('customerCompletionOverrides','customerCategoryOverrides') then current_row=state->col->rid;
 elsif target='table' then
  keycol=case col when 'lm_access_customer_profiles' then 'import_row_id' when 'lm_access_property_edits' then 'source_id' when 'lm_onenote_customer_profiles' then 'source_page_id' when 'lm_onenote_edits' then 'source_page_id' when 'lm_access_customer_consultations' then 'id' when 'lm_new_properties' then 'id' else null end;
  if keycol is null then raise exception 'unsupported table'; end if;
  if after_row is null then raise exception 'offline table deletion is disabled'; end if;
  if after_row->>keycol is distinct from rid then raise exception 'table identity mismatch'; end if;
  if p_test_id is null then
   execute format('select to_jsonb(t) from public.%I t where %I::text=$1 for update',col,keycol) into current_row using rid;
  else current_row=state->'tables'->col->rid;
  end if;
  -- Audit identity and server timestamps are assigned on the server, not trusted from clients.
  before_row=before_row-array['created_at','created_by','updated_at','updated_by','serial_no'];
  after_row=after_row-array['created_at','created_by','updated_at','updated_by','serial_no'];
  current_row=current_row-array['created_at','created_by','updated_at','updated_by','serial_no'];
 else raise exception 'unsupported target';
 end if;
 merged=lm_private.sync_merge_v1(before_row,after_row,current_row,'');
 value=merged->'value';
 if jsonb_array_length(merged->'conflicts')>0 then
  result=jsonb_build_object('status','conflict','id',opid,'version',ver,'remote',current_row,'conflicts',merged->'conflicts');
 else
  if target='core' then
   select coalesce(jsonb_agg(e),'[]'::jsonb) into value from jsonb_array_elements(coalesce(state->col,'[]'::jsonb)) e where e->>'id' is distinct from rid;
   if (merged->>'present')::boolean then value=value||jsonb_build_array(merged->'value'); end if;
   state=jsonb_set(state,array[col],value,true);
  elsif target='map' then
   value=coalesce(state->col,'{}'::jsonb);
   if (merged->>'present')::boolean then value=value||jsonb_build_object(rid,merged->'value'); else value=value-rid; end if;
   state=jsonb_set(state,array[col],value,true);
  elsif p_test_id is not null then
   state=jsonb_set(state,array['tables'],coalesce(state->'tables','{}'::jsonb)||jsonb_build_object(col,coalesce(state->'tables'->col,'{}'::jsonb)||jsonb_build_object(rid,merged->'value')),true);
  else
   value=merged->'value';
   select array_agg(c.column_name) into allowed_cols from information_schema.columns c where c.table_schema='public' and c.table_name=col and c.column_name not in ('created_at','created_by','updated_at','updated_by','serial_no');
   if exists(select 1 from jsonb_object_keys(value) k where not(k=any(allowed_cols))) then raise exception 'unsupported table column'; end if;
   select string_agg(format('%I',k),','),string_agg(format('(jsonb_populate_record(null::public.%I,$1)).%I',col,k),','),string_agg(format('%I=excluded.%I',k,k),',') into columns_sql,values_sql,set_sql from jsonb_object_keys(value) k;
   set_sql=set_sql||',updated_at=clock_timestamp()';
   if col in ('lm_access_customer_profiles','lm_onenote_customer_profiles','lm_onenote_edits') then set_sql=set_sql||',updated_by=auth.uid()'; end if;
   execute format('insert into public.%I (%s) select %s on conflict (%I) do update set %s',col,columns_sql,values_sql,keycol,set_sql) using value;
  end if;
  if p_test_id is null then
   if target<>'table' then update public.lm_cloud_workspace set data=state,version=version+1,updated_at=now() where id=1 returning version into ver; end if;
  else update lm_private.sync_test_workspaces_v1 set data=state,version=version+1 where id=p_test_id returning version into ver;
  end if;
  result=jsonb_build_object('status','applied','id',opid,'version',ver,'value',merged->'value','remote',current_row);
 end if;
 insert into lm_private.sync_operations_v1(scope,operation_id,actor_id,device_id,request,result) values(scope_name,opid,uid,p_operation->>'device_id',p_operation,result);
 return result;
end $$;
revoke all on function lm_private.sync_apply_v1(jsonb,uuid) from public,anon;
grant execute on function lm_private.sync_apply_v1(jsonb,uuid) to authenticated;
create or replace function public.lm_sync_apply_v1(p_operation jsonb,p_test_id uuid default null)
returns jsonb language sql security invoker set search_path='' as $$ select lm_private.sync_apply_v1(p_operation,p_test_id) $$;
revoke all on function public.lm_sync_apply_v1(jsonb,uuid) from public,anon;
grant execute on function public.lm_sync_apply_v1(jsonb,uuid) to authenticated;
