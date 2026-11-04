create table public.profiles (
  id uuid not null,
  display_name text not null,
  role text not null,
  constraint profiles_pkey primary key (id),
  constraint profiles_user_fkey
    foreign key (id) references auth.users (id) on delete restrict,
  constraint profiles_display_name_not_blank
    check (btrim(display_name) <> ''),
  constraint profiles_role_check
    check (role in ('manager', 'executor'))
);

create table public.projects (
  id uuid not null default gen_random_uuid(),
  name text not null,
  address text not null,
  deleted_at timestamptz,
  constraint projects_pkey primary key (id),
  constraint projects_name_not_blank check (btrim(name) <> '')
);

create table public.tasks (
  id uuid not null default gen_random_uuid(),
  project_id uuid not null,
  assignee_id uuid not null,
  created_by uuid not null,
  title text not null,
  description text not null,
  status text not null default 'new',
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint tasks_pkey primary key (id),
  constraint tasks_project_fkey
    foreign key (project_id) references public.projects (id) on delete restrict,
  constraint tasks_assignee_fkey
    foreign key (assignee_id) references public.profiles (id) on delete restrict,
  constraint tasks_created_by_fkey
    foreign key (created_by) references public.profiles (id) on delete restrict,
  constraint tasks_title_not_blank check (btrim(title) <> ''),
  constraint tasks_status_check
    check (status in ('new', 'in_progress', 'in_review', 'accepted', 'rework'))
);

create table public.task_status_history (
  id uuid not null default gen_random_uuid(),
  task_id uuid not null,
  actor_id uuid not null,
  from_status text,
  to_status text not null,
  comment text,
  created_at timestamptz not null default now(),
  constraint task_status_history_pkey primary key (id),
  constraint task_status_history_task_fkey
    foreign key (task_id) references public.tasks (id) on delete restrict,
  constraint task_status_history_actor_fkey
    foreign key (actor_id) references public.profiles (id) on delete restrict,
  constraint task_status_history_from_status_check
    check (
      from_status is null
      or from_status in ('new', 'in_progress', 'in_review', 'accepted', 'rework')
    ),
  constraint task_status_history_to_status_check
    check (to_status in ('new', 'in_progress', 'in_review', 'accepted', 'rework'))
);

create index tasks_project_id_active_idx
  on public.tasks (project_id)
  where deleted_at is null;

create index tasks_assignee_id_active_idx
  on public.tasks (assignee_id)
  where deleted_at is null;

create index task_status_history_task_id_idx
  on public.task_status_history (task_id);

alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.tasks enable row level security;
alter table public.task_status_history enable row level security;
