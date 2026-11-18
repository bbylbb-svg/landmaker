import {PGlite} from '@electric-sql/pglite';
import fs from 'node:fs/promises';
export const USERS=['00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000004'];
export async function database(){
 const db=new PGlite();await db.exec(`
 create role anon; create role authenticated; create role service_role bypassrls;
 create table public.lm_staff(id uuid primary key,auth_user_id uuid,name text);
 create table public.lm_cloud_workspace(id integer primary key,data jsonb);
 create table public.lm_new_properties(id uuid primary key,original_data jsonb);
 create table public.lm_import_rows(id uuid primary key,source_table text,original_data jsonb);
 create table public.lm_access_property_edits(source_id uuid primary key,edited_data jsonb);
 grant usage on schema public to service_role,anon,authenticated;
 grant select on public.lm_staff,public.lm_cloud_workspace,public.lm_new_properties,public.lm_import_rows,public.lm_access_property_edits to service_role;
 insert into public.lm_cloud_workspace values(1,'{"properties":[{"id":"p1","address":"same address"},{"id":"p2","address":"same address"}]}');`);
 for(let i=0;i<4;i++)await db.query('insert into lm_staff values($1,$1,$2)',[USERS[i],'staff '+i]);
 await db.exec(await fs.readFile(new URL('../schema-proposal.sql',import.meta.url),'utf8'));
 await db.query('update lm_photo_permissions set can_read=true,can_edit=true,can_approve=(staff_id=$1) where staff_id in ($1,$2,$3)',USERS.slice(0,3));
 const call=async(uid,action,args={})=>(await db.query('select public.lm_photo_dispatch($1::uuid,$2,$3::jsonb) as result',[uid,action,JSON.stringify(args)])).rows[0].result;
 return {db,call};
}
