-- Execute no Supabase: Dashboard > SQL Editor > New query.
-- Ative RLS e mantenha estas políticas para separar os dados por usuário.
create table if not exists public.clientes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  nome text not null,
  email text,
  telefone text,
  empresa text,
  status text not null default 'lead' check (status in ('lead','ativo','inativo')),
  created_at timestamptz not null default now(),
  -- Necessário para a venda referenciar um cliente da mesma conta.
  constraint clientes_id_user_id_unique unique (id, user_id)
);

create table if not exists public.vendas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  "clienteId" uuid not null,
  produto text not null,
  valor numeric(12,2) not null check (valor >= 0),
  data date not null,
  status text not null default 'pendente' check (status in ('pendente','paga','cancelada')),
  created_at timestamptz not null default now(),
  constraint vendas_cliente_mesmo_usuario_fk
    foreign key ("clienteId", user_id)
    references public.clientes(id, user_id)
    on delete restrict
);

create table if not exists public.tarefas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  titulo text not null,
  status text not null default 'pendente' check (status in ('pendente','em andamento','concluída')),
  prioridade text not null default 'média' check (prioridade in ('baixa','média','alta')),
  prazo date,
  created_at timestamptz not null default now()
);

create table if not exists public.user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username text not null check (username ~ '^[a-z0-9_]{3,30}$'),
  created_at timestamptz not null default now()
);

create unique index if not exists user_profiles_username_lower_unique
  on public.user_profiles (lower(username));

create or replace function public.handle_new_user_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested_username text;
begin
  requested_username := lower(coalesce(new.raw_user_meta_data ->> 'username', ''));
  if requested_username = '' then
    return new;
  end if;
  if requested_username !~ '^[a-z0-9_]{3,30}$' then
    raise exception 'Nome de usuário inválido.';
  end if;
  insert into public.user_profiles (user_id, username)
  values (new.id, requested_username);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile
  after insert on auth.users
  for each row execute function public.handle_new_user_profile();
revoke all on function public.handle_new_user_profile() from public, anon, authenticated;

-- Recupera perfis de contas criadas antes da instalação do gatilho.
insert into public.user_profiles (user_id, username)
select u.id, lower(u.raw_user_meta_data ->> 'username')
from auth.users as u
where lower(coalesce(u.raw_user_meta_data ->> 'username', '')) ~ '^[a-z0-9_]{3,30}$'
on conflict do nothing;

alter table public.clientes enable row level security;
alter table public.vendas enable row level security;
alter table public.tarefas enable row level security;
alter table public.user_profiles enable row level security;

drop policy if exists "clientes do próprio usuário" on public.clientes;
create policy "clientes do próprio usuário" on public.clientes for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists "vendas do próprio usuário" on public.vendas;
create policy "vendas do próprio usuário" on public.vendas for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists "tarefas do próprio usuário" on public.tarefas;
create policy "tarefas do próprio usuário" on public.tarefas for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists "perfil visível ao próprio usuário" on public.user_profiles;
create policy "perfil visível ao próprio usuário" on public.user_profiles for select to authenticated
  using (user_id = (select auth.uid()));
drop policy if exists "perfil criado pelo próprio usuário" on public.user_profiles;
create policy "perfil criado pelo próprio usuário" on public.user_profiles for insert to authenticated
  with check (user_id = (select auth.uid()));
drop policy if exists "perfil atualizado pelo próprio usuário" on public.user_profiles;
create policy "perfil atualizado pelo próprio usuário" on public.user_profiles for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create index if not exists clientes_user_id_idx on public.clientes(user_id);
create index if not exists vendas_user_id_idx on public.vendas(user_id);
create index if not exists vendas_cliente_id_idx on public.vendas("clienteId");
create index if not exists tarefas_user_id_idx on public.tarefas(user_id);
