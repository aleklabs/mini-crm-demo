create function private.transition_task(
  p_task_id uuid,
  p_new_status text,
  p_comment text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_actor_role text;
  v_assignee_id uuid;
  v_current_status text;
  v_task_deleted_at timestamptz;
  v_project_deleted_at timestamptz;
  v_required_role text;
begin
  if v_actor_id is null then
    raise exception 'Authentication is required'
      using errcode = '28000';
  end if;

  select profile.role
  into v_actor_role
  from public.profiles as profile
  where profile.id = v_actor_id;

  if not found then
    raise exception 'Authenticated user has no profile'
      using errcode = '42501';
  end if;

  select
    task.status,
    task.assignee_id,
    task.deleted_at,
    project.deleted_at
  into
    v_current_status,
    v_assignee_id,
    v_task_deleted_at,
    v_project_deleted_at
  from public.tasks as task
  join public.projects as project on project.id = task.project_id
  where task.id = p_task_id
  for update of task;

  if not found then
    raise exception 'Task does not exist'
      using errcode = 'P0002';
  end if;

  if v_task_deleted_at is not null then
    raise exception 'Deleted task cannot change status'
      using errcode = '55000';
  end if;

  if v_project_deleted_at is not null then
    raise exception 'Task in a deleted project cannot change status'
      using errcode = '55000';
  end if;

  if p_new_status is null
    or p_new_status not in (
      'new',
      'in_progress',
      'in_review',
      'accepted',
      'rework'
    )
  then
    raise exception 'Invalid task status'
      using errcode = '22023';
  end if;

  if p_new_status = v_current_status then
    raise exception 'Task is already in the requested status'
      using errcode = '22023';
  end if;

  v_required_role := case
    when v_current_status = 'new' and p_new_status = 'in_progress'
      then 'executor'
    when v_current_status = 'in_progress' and p_new_status = 'in_review'
      then 'executor'
    when v_current_status = 'in_review' and p_new_status = 'accepted'
      then 'manager'
    when v_current_status = 'in_review' and p_new_status = 'rework'
      then 'manager'
    when v_current_status = 'rework' and p_new_status = 'in_progress'
      then 'executor'
    else null
  end;

  if v_required_role is null then
    raise exception 'Task status transition is not allowed'
      using errcode = '22023';
  end if;

  if v_actor_role <> v_required_role then
    raise exception 'Current role cannot perform this transition'
      using errcode = '42501';
  end if;

  if v_required_role = 'executor' and v_actor_id <> v_assignee_id then
    raise exception 'Only the assigned executor can perform this transition'
      using errcode = '42501';
  end if;

  if p_comment is not null and btrim(p_comment) = '' then
    raise exception 'Comment cannot be blank'
      using errcode = '22023';
  end if;

  if v_current_status = 'in_review'
    and p_new_status = 'rework'
    and p_comment is null
  then
    raise exception 'A comment is required when returning a task to rework'
      using errcode = '22023';
  end if;

  update public.tasks
  set status = p_new_status
  where id = p_task_id;

  insert into public.task_status_history (
    task_id,
    actor_id,
    from_status,
    to_status,
    comment
  )
  values (
    p_task_id,
    v_actor_id,
    v_current_status,
    p_new_status,
    p_comment
  );
end;
$$;

create function public.transition_task(
  p_task_id uuid,
  p_new_status text,
  p_comment text default null
)
returns void
language sql
security invoker
set search_path = ''
as $$
  select private.transition_task(p_task_id, p_new_status, p_comment);
$$;

create function private.record_initial_task_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.task_status_history (
    task_id,
    actor_id,
    from_status,
    to_status,
    comment
  )
  values (
    new.id,
    new.created_by,
    null,
    'new',
    null
  );

  return new;
end;
$$;

revoke all on function private.transition_task(uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.transition_task(uuid, text, text)
  from public, anon, authenticated;
revoke all on function private.record_initial_task_history()
  from public, anon, authenticated;

grant execute on function private.transition_task(uuid, text, text)
  to authenticated;
grant execute on function public.transition_task(uuid, text, text)
  to authenticated;

create trigger tasks_record_initial_history
after insert on public.tasks
for each row
execute function private.record_initial_task_history();

drop policy tasks_select_authenticated on public.tasks;

create policy tasks_select_authenticated
on public.tasks
for select
to authenticated
using (
  deleted_at is null
  and exists (
    select 1
    from public.projects
    where projects.id = tasks.project_id
      and projects.deleted_at is null
  )
  and (
    private.is_manager()
    or assignee_id = (select auth.uid())
  )
);
