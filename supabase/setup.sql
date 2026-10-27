-- Maher Market System: database setup for Supabase.
-- Paste all of this into Supabase > SQL Editor > New query, then press Run.
-- Safe to run again: it never deletes your data.

-- Every record (product, sale, customer, supplier, payment, settings) is one row.
-- "path" is like "products/abc123"; "col" is the part before the last slash.
create table if not exists public.docs (
  path       text primary key,
  col        text not null,
  data       jsonb not null default '{}'::jsonb,
  version    bigint not null,
  deleted    boolean not null default false,
  updated_at timestamptz not null default now()
);
create sequence if not exists public.docs_version_seq;
create index if not exists docs_col_idx on public.docs (col);

-- Who may open the store data: logins listed here.
create table if not exists public.staff (
  user_id  uuid primary key references auth.users (id) on delete cascade,
  added_at timestamptz not null default now()
);

create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.staff where user_id = auth.uid());
$$;

-- Merge b into a, going into nested objects, so two tills that change
-- different parts of the same record never overwrite each other.
create or replace function public.jsonb_deep_merge(a jsonb, b jsonb) returns jsonb
language sql immutable set search_path = public as $$
  select case
    when jsonb_typeof(a) = 'object' and jsonb_typeof(b) = 'object' then coalesce((
      select jsonb_object_agg(k,
        case when jsonb_typeof(a -> k) = 'object' and jsonb_typeof(b -> k) = 'object' then public.jsonb_deep_merge(a -> k, b -> k)
             when b ? k then b -> k
             else a -> k end)
      from (select jsonb_object_keys(a) as k union select jsonb_object_keys(b)) keys), '{}'::jsonb)
    else b end;
$$;

create or replace function public.doc_row(r public.docs) returns jsonb
language sql immutable as $$
  select jsonb_build_object('path', r.path, 'data', r.data, 'version', r.version, 'deleted', r.deleted);
$$;

-- Write a whole record (creates it, or replaces it).
create or replace function public.set_doc(p_path text, p_data jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r public.docs;
begin
  if not public.is_staff() then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_path !~ '^[^/]+(/[^/]+)*/[^/]+$' then raise exception 'bad path %', p_path using errcode = '22023'; end if;
  insert into public.docs (path, col, data, version, deleted, updated_at)
  values (p_path, regexp_replace(p_path, '/[^/]*$', ''), coalesce(p_data, '{}'::jsonb), nextval('public.docs_version_seq'), false, now())
  on conflict (path) do update set data = excluded.data, version = excluded.version, deleted = false, updated_at = now()
  returning * into r;
  return public.doc_row(r);
end $$;

-- Change some fields of an existing record (fails if it does not exist).
create or replace function public.merge_doc(p_path text, p_data jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r public.docs;
begin
  if not public.is_staff() then raise exception 'not allowed' using errcode = '42501'; end if;
  update public.docs set data = public.jsonb_deep_merge(data, coalesce(p_data, '{}'::jsonb)),
         version = nextval('public.docs_version_seq'), updated_at = now()
   where path = p_path and not deleted
  returning * into r;
  if not found then raise exception 'no record %', p_path using errcode = 'P0002'; end if;
  return public.doc_row(r);
end $$;

-- Remove a record. The row stays as a marker so every till hears about it.
create or replace function public.delete_doc(p_path text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r public.docs;
begin
  if not public.is_staff() then raise exception 'not allowed' using errcode = '42501'; end if;
  update public.docs set data = '{}'::jsonb, deleted = true, version = nextval('public.docs_version_seq'), updated_at = now()
   where path = p_path
  returning * into r;
  if not found then return jsonb_build_object('path', p_path, 'data', '{}'::jsonb, 'version', 0, 'deleted', true); end if;
  return public.doc_row(r);
end $$;

-- Only store logins can read; all changes go through the functions above.
alter table public.docs enable row level security;
alter table public.staff enable row level security;
drop policy if exists "staff read docs" on public.docs;
create policy "staff read docs" on public.docs for select to authenticated using (public.is_staff());
drop policy if exists "see own staff row" on public.staff;
create policy "see own staff row" on public.staff for select to authenticated using (user_id = auth.uid());

revoke all on public.docs, public.staff from anon, authenticated;
grant select on public.docs, public.staff to authenticated;
revoke execute on function public.set_doc(text, jsonb), public.merge_doc(text, jsonb), public.delete_doc(text), public.is_staff() from public, anon;
grant execute on function public.set_doc(text, jsonb), public.merge_doc(text, jsonb), public.delete_doc(text), public.is_staff() to authenticated;

-- Live updates: every till sees changes from the others within a second.
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'docs') then
    alter publication supabase_realtime add table public.docs;
  end if;
end $$;

-- Give every login that exists right now access to the store.
-- (Create the login first: Authentication > Users > Add user.)
insert into public.staff (user_id) select id from auth.users on conflict do nothing;
