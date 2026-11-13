create or replace function lm_private.sync_test_read_v1(p_test_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare d jsonb; v bigint;
begin
 if auth.uid() is null or not (select lm_private.is_staff()) then raise exception 'not authorized' using errcode='42501'; end if;
 select data,version into d,v from lm_private.sync_test_workspaces_v1 where id=p_test_id;
 return jsonb_build_object('version',coalesce(v,0),'data','{"customers":[],"properties":[],"records":[],"schedules":[],"transactions":[],"ownership":[],"quick":[],"auditLog":[],"propertyGroups":[],"customerCompletionOverrides":{},"customerCategoryOverrides":{}}'::jsonb||coalesce(d,'{}'::jsonb));
end $$;
revoke all on function lm_private.sync_test_read_v1(uuid) from public,anon;
grant execute on function lm_private.sync_test_read_v1(uuid) to authenticated;
create or replace function public.lm_sync_test_read_v1(p_test_id uuid)
returns jsonb language sql security invoker set search_path='' as $$ select lm_private.sync_test_read_v1(p_test_id) $$;
revoke all on function public.lm_sync_test_read_v1(uuid) from public,anon;
grant execute on function public.lm_sync_test_read_v1(uuid) to authenticated;
