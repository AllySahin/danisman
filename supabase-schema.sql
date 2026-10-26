create table if not exists public.workspace_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  version integer not null default 1 check (version > 0),
  payload jsonb not null default '{"clients":[],"sessions":[]}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.workspace_state enable row level security;

drop policy if exists "Users can read their workspace" on public.workspace_state;
create policy "Users can read their workspace"
  on public.workspace_state for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can create their workspace" on public.workspace_state;
create policy "Users can create their workspace"
  on public.workspace_state for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users can update their workspace" on public.workspace_state;
create policy "Users can update their workspace"
  on public.workspace_state for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant select, insert, update on public.workspace_state to authenticated;
revoke all on public.workspace_state from anon, public;

create or replace function public.save_workspace_state(
  p_expected_version integer,
  p_payload jsonb
)
returns integer
language plpgsql
set search_path = public
as $$
declare
  current_version integer;
  next_version integer;
  workspace_user_id uuid := auth.uid();
begin
  if workspace_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select version into current_version
  from public.workspace_state
  where user_id = workspace_user_id
  for update;

  if not found then
    if p_expected_version <> 0 then
      raise exception 'VERSION_CONFLICT';
    end if;
    insert into public.workspace_state (user_id, version, payload)
    values (workspace_user_id, 1, p_payload);
    return 1;
  end if;

  if current_version <> p_expected_version then
    raise exception 'VERSION_CONFLICT';
  end if;

  next_version := current_version + 1;
  update public.workspace_state
  set version = next_version,
      payload = p_payload,
      updated_at = now()
  where user_id = workspace_user_id;
  return next_version;
end;
$$;

revoke all on function public.save_workspace_state(integer, jsonb) from public, anon;
grant execute on function public.save_workspace_state(integer, jsonb) to authenticated;
