-- Holiday Wiring Diagram Builder: end-to-end encrypted sync between a person's devices.
--
-- Only scrambled data is stored: each device encrypts its plans and photos with a key derived
-- from a secret sync code that never leaves the devices. The server sees a 64-hex lookup id
-- (also derived from the code) and ciphertext, nothing else.
--
-- Access: both tables have row level security on and no policies, and no table privileges
-- for anon/authenticated, so the Data API cannot read or list them. The only way in is the
-- functions below, which need the lookup id. Prefix hwd_ keeps this apart from the other
-- apps in the project (gw_, hdb_, hpp_); nothing else is touched.
--
-- Limits: the public key can call these functions, so hard caps keep anyone from filling the
-- shared database: at most 100 sync codes, 2 MB of plans and 100 photos per code, and 200 MB of photos in all
-- (400 MB at the very most). Raise them here if the project has room.

create table if not exists public.hwd_vaults (
  lookup text primary key check (lookup ~ '^[0-9a-f]{64}$'),
  rev bigint not null default 1,
  doc text not null check (length(doc) <= 2000000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.hwd_vaults is 'Holiday Wiring Diagram Builder: end-to-end encrypted plans, one row per sync code. Reached only through the hwd_ functions.';

create table if not exists public.hwd_photos (
  lookup text not null references public.hwd_vaults (lookup) on delete cascade,
  photo_id text not null check (photo_id ~ '^[A-Za-z0-9_-]{1,80}$'),
  data text not null check (length(data) <= 6000000),
  created_at timestamptz not null default now(),
  primary key (lookup, photo_id)
);
comment on table public.hwd_photos is 'Holiday Wiring Diagram Builder: end-to-end encrypted house photos. Reached only through the hwd_ functions.';

alter table public.hwd_vaults enable row level security;
alter table public.hwd_photos enable row level security;
revoke all on table public.hwd_vaults from anon, authenticated;
revoke all on table public.hwd_photos from anon, authenticated;

-- The cloud copy for a lookup id (no row when there is none yet).
create or replace function public.hwd_pull(p_lookup text)
returns table (rev bigint, doc text)
language sql
stable
security definer
set search_path = ''
as $$
  select v.rev, v.doc from public.hwd_vaults v where v.lookup = p_lookup;
$$;

-- Write a new cloud copy over p_base_rev (0 = the first one). Returns the new rev, or 0 when
-- another device wrote first (the caller pulls, merges and tries again).
create or replace function public.hwd_push(p_lookup text, p_base_rev bigint, p_doc text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_rev bigint;
begin
  if p_lookup !~ '^[0-9a-f]{64}$' or p_doc is null then
    raise exception 'bad request';
  end if;
  if p_base_rev = 0 then
    if (select count(*) from public.hwd_vaults) >= 100 then
      raise exception 'sync is full';
    end if;
    insert into public.hwd_vaults (lookup, doc) values (p_lookup, p_doc)
    on conflict (lookup) do nothing
    returning rev into new_rev;
  else
    update public.hwd_vaults
    set doc = p_doc, rev = rev + 1, updated_at = now()
    where lookup = p_lookup and rev = p_base_rev
    returning rev into new_rev;
  end if;
  return coalesce(new_rev, 0);
end;
$$;

-- Photo ids stored for a lookup id.
create or replace function public.hwd_photo_ids(p_lookup text)
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  select p.photo_id from public.hwd_photos p where p.lookup = p_lookup;
$$;

-- Store a photo (once; photos never change). At most 100 per lookup id, 200 MB in all.
create or replace function public.hwd_photo_put(p_lookup text, p_photo_id text, p_data text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.hwd_vaults v where v.lookup = p_lookup) then
    raise exception 'no such vault';
  end if;
  if (select count(*) from public.hwd_photos p where p.lookup = p_lookup) >= 100 then
    raise exception 'too many photos';
  end if;
  if (select coalesce(sum(length(p.data)), 0) from public.hwd_photos p) + length(p_data) > 200000000 then
    raise exception 'sync is full';
  end if;
  insert into public.hwd_photos (lookup, photo_id, data) values (p_lookup, p_photo_id, p_data)
  on conflict (lookup, photo_id) do nothing;
end;
$$;

create or replace function public.hwd_photo_get(p_lookup text, p_photo_id text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select p.data from public.hwd_photos p where p.lookup = p_lookup and p.photo_id = p_photo_id;
$$;

-- Delete the cloud copy and its photos (each device keeps its own plans).
create or replace function public.hwd_forget(p_lookup text)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.hwd_vaults v where v.lookup = p_lookup;
$$;

revoke all on function public.hwd_pull(text) from public;
revoke all on function public.hwd_push(text, bigint, text) from public;
revoke all on function public.hwd_photo_ids(text) from public;
revoke all on function public.hwd_photo_put(text, text, text) from public;
revoke all on function public.hwd_photo_get(text, text) from public;
revoke all on function public.hwd_forget(text) from public;
grant execute on function public.hwd_pull(text) to anon, authenticated;
grant execute on function public.hwd_push(text, bigint, text) to anon, authenticated;
grant execute on function public.hwd_photo_ids(text) to anon, authenticated;
grant execute on function public.hwd_photo_put(text, text, text) to anon, authenticated;
grant execute on function public.hwd_photo_get(text, text) to anon, authenticated;
grant execute on function public.hwd_forget(text) to anon, authenticated;
