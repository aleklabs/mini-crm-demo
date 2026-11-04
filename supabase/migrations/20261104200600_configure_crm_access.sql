create schema if not exists private;

revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;

create function private.is_manager()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles
    where id = (select auth.uid())
      and role = 'manager'
  );
$$;

create function private.has_active_task_in_project(target_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.tasks
    where project_id = target_project_id
      and assignee_id = (select auth.uid())
      and deleted_at is null
  );
$$;

create function private.enforce_task_assignee_role()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  assignee_role text;
begin
  select role
  into assignee_role
  from public.profiles
  where id = new.assignee_id;

  if assignee_role is not null and assignee_role <> 'executor' then
    raise exception 'Task assignee must have executor role'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create function private.apply_project_soft_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if pg_trigger_depth() > 1
    or old.deleted_at is not null
    or new.deleted_at is null
  then
    return new;
  end if;

  if not private.is_manager() then
    raise exception 'Only managers can logically delete projects'
      using errcode = '42501';
  end if;

  if new.name is distinct from old.name
    or new.address is distinct from old.address
  then
    raise exception 'Logical deletion must be a separate project update'
      using errcode = '22023';
  end if;

  update public.projects
  set deleted_at = new.deleted_at
  where id = old.id;

  return null;
end;
$$;

create function private.apply_task_soft_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if pg_trigger_depth() > 1
    or old.deleted_at is not null
    or new.deleted_at is null
  then
    return new;
  end if;

  if not private.is_manager() then
    raise exception 'Only managers can logically delete tasks'
      using errcode = '42501';
  end if;

  if new.project_id is distinct from old.project_id
    or new.assignee_id is distinct from old.assignee_id
    or new.title is distinct from old.title
    or new.description is distinct from old.description
  then
    raise exception 'Logical deletion must be a separate task update'
      using errcode = '22023';
  end if;

  update public.tasks
  set deleted_at = new.deleted_at
  where id = old.id;

  return null;
end;
$$;

revoke all on function private.is_manager() from public, anon, authenticated;
revoke all on function private.has_active_task_in_project(uuid)
  from public, anon, authenticated;
revoke all on function private.enforce_task_assignee_role()
  from public, anon, authenticated;
revoke all on function private.apply_project_soft_delete()
  from public, anon, authenticated;
revoke all on function private.apply_task_soft_delete()
  from public, anon, authenticated;

grant execute on function private.is_manager() to authenticated;
grant execute on function private.has_active_task_in_project(uuid)
  to authenticated;

create trigger tasks_enforce_assignee_role
before insert or update of assignee_id on public.tasks
for each row
execute function private.enforce_task_assignee_role();

create trigger projects_apply_soft_delete
before update of deleted_at on public.projects
for each row
execute function private.apply_project_soft_delete();

create trigger tasks_apply_soft_delete
before update of deleted_at on public.tasks
for each row
execute function private.apply_task_soft_delete();

alter table public.tasks
  alter column created_by set default auth.uid();

revoke all privileges
  on table
    public.profiles,
    public.projects,
    public.tasks,
    public.task_status_history
  from public, anon, authenticated;

grant select on table public.profiles to authenticated;

grant select on table public.projects to authenticated;
grant insert (name, address) on table public.projects to authenticated;
grant update (name, address, deleted_at) on table public.projects to authenticated;

grant select on table public.tasks to authenticated;
grant insert (project_id, assignee_id, title, description)
  on table public.tasks to authenticated;
grant update (project_id, assignee_id, title, description, deleted_at)
  on table public.tasks to authenticated;

grant select on table public.task_status_history to authenticated;

create policy profiles_select_authenticated
on public.profiles
for select
to authenticated
using (
  private.is_manager()
  or id = (select auth.uid())
);

create policy projects_select_authenticated
on public.projects
for select
to authenticated
using (
  deleted_at is null
  and (
    private.is_manager()
    or private.has_active_task_in_project(id)
  )
);

create policy projects_insert_manager
on public.projects
for insert
to authenticated
with check (
  private.is_manager()
  and deleted_at is null
);

create policy projects_update_manager
on public.projects
for update
to authenticated
using (
  private.is_manager()
  and deleted_at is null
)
with check (private.is_manager());

create policy tasks_select_authenticated
on public.tasks
for select
to authenticated
using (
  deleted_at is null
  and (
    private.is_manager()
    or (
      assignee_id = (select auth.uid())
      and exists (
        select 1
        from public.projects
        where projects.id = tasks.project_id
          and projects.deleted_at is null
      )
    )
  )
);

create policy tasks_insert_manager
on public.tasks
for insert
to authenticated
with check (
  private.is_manager()
  and created_by = (select auth.uid())
  and status = 'new'
  and deleted_at is null
  and exists (
    select 1
    from public.projects
    where projects.id = tasks.project_id
      and projects.deleted_at is null
  )
);

create policy tasks_update_manager
on public.tasks
for update
to authenticated
using (
  private.is_manager()
  and deleted_at is null
)
with check (
  private.is_manager()
  and exists (
    select 1
    from public.projects
    where projects.id = tasks.project_id
      and projects.deleted_at is null
  )
);

create policy task_status_history_select_authenticated
on public.task_status_history
for select
to authenticated
using (
  exists (
    select 1
    from public.tasks
    where tasks.id = task_status_history.task_id
  )
);
