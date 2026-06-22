-- ════════════════════════════════════════════════════════════════
-- SETUP COMPLETO — execute tudo isso no SQL Editor do NOVO projeto
-- Pode rodar em um único bloco, de uma vez
-- ════════════════════════════════════════════════════════════════

-- 1) Tabela de reports
create table reports (
  id uuid default gen_random_uuid() primary key,
  titulo text not null,
  responsavel text not null,
  setor text not null,
  data_referencia date not null,
  file_name text,
  file_size text,
  file_type text,
  on_time boolean default true,
  submitted_at timestamptz default now(),
  file_url text,
  submitted_by_email text
);

alter table reports enable row level security;

create policy "acesso publico" on reports
for all using (true) with check (true);

grant all on public.reports to anon;
grant all on public.reports to authenticated;


-- 2) Tabela de papéis de usuário (gestor / colaborador)
create table user_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'colaborador' check (role in ('gestor', 'colaborador')),
  created_at timestamptz default now()
);

alter table user_roles enable row level security;

create policy "usuarios podem ler todas as roles"
on user_roles for select using (true);

create policy "acesso publico para insercao de roles"
on user_roles for insert with check (true);

grant select on public.user_roles to anon;
grant select on public.user_roles to authenticated;


-- ════════════════════════════════════════════════════════════════
-- 3) Política do Storage — rode SOMENTE depois de criar o bucket
--    "arquivos" em Storage > New bucket (marcado como Público)
-- ════════════════════════════════════════════════════════════════

create policy "acesso publico storage" on storage.objects
for all using (bucket_id = 'arquivos') with check (bucket_id = 'arquivos');


-- ════════════════════════════════════════════════════════════════
-- 4) Cadastro de usuários — rode DEPOIS de criar cada pessoa em
--    Authentication > Users > Add user > Create new user
-- ════════════════════════════════════════════════════════════════

-- Exemplo gestor:
-- insert into user_roles (user_id, role)
-- select id, 'gestor' from auth.users where email = 'gestor@exemplo.com';

-- Exemplo colaborador:
-- insert into user_roles (user_id, role)
-- select id, 'colaborador' from auth.users where email = 'colaborador@exemplo.com';
