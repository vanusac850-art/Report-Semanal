-- ════════════════════════════════════════════════════════════════
-- PASSO 1: Criar a tabela de papéis (roles) dos usuários
-- Execute isso no SQL Editor do Supabase
-- ════════════════════════════════════════════════════════════════

create table user_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'colaborador' check (role in ('gestor', 'colaborador')),
  created_at timestamptz default now()
);

-- Permitir que qualquer usuário autenticado leia sua própria role
alter table user_roles enable row level security;

create policy "usuarios podem ler todas as roles"
on user_roles for select
using (true);

create policy "acesso publico para insercao de roles"
on user_roles for insert
with check (true);


-- ════════════════════════════════════════════════════════════════
-- PASSO 2: Depois de criar um usuário em Authentication > Users,
-- defina o papel dele com um destes comandos.
--
-- Troque o e-mail pelo e-mail real que você cadastrou.
-- ════════════════════════════════════════════════════════════════

-- Para tornar alguém GESTOR (acesso total: dashboard + reports + envio):
insert into user_roles (user_id, role)
select id, 'gestor' from auth.users where email = 'gestor@teste.com';

-- Para tornar alguém COLABORADOR (acesso apenas à tela de envio):
insert into user_roles (user_id, role)
select id, 'colaborador' from auth.users where email = 'setor@teste.com';


-- ════════════════════════════════════════════════════════════════
-- PASSO 3 (opcional): Para trocar o papel de alguém depois:
-- ════════════════════════════════════════════════════════════════

update user_roles
set role = 'gestor'
where user_id = (select id from auth.users where email = 'algum@email.com');
