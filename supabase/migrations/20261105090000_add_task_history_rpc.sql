create function private.get_task_history(p_task_id uuid)
returns table (
  id uuid,
  actor_id uuid,
  actor_display_name text,
  from_status text,
  to_status text,
  comment text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_user_role text;
  v_assignee_id uuid;
  v_task_deleted_at timestamptz;
  v_project_deleted_at timestamptz;
begin
  if v_user_id is null then
    return;
  end if;

  select profile.role
  into v_user_role
  from public.profiles as profile
  where profile.id = v_user_id;

  if not found then
    return;
  end if;

  select task.assignee_id, task.deleted_at, project.deleted_at
  into v_assignee_id, v_task_deleted_at, v_project_deleted_at
  from public.tasks as task
  join public.projects as project on project.id = task.project_id
  where task.id = p_task_id;

  if not found
    or v_task_deleted_at is not null
    or v_project_deleted_at is not null
    or (
      v_user_role <> 'manager'
      and not (
        v_user_role = 'executor'
        and v_assignee_id = v_user_id
      )
    )
  then
    return;
  end if;

  return query
  select
    history.id,
    history.actor_id,
    actor.display_name,
    history.from_status,
    history.to_status,
    history.comment,
    history.created_at
  from public.task_status_history as history
  join public.profiles as actor on actor.id = history.actor_id
  where history.task_id = p_task_id
  order by history.created_at, history.id;
end;
$$;

create function public.get_task_history(p_task_id uuid)
returns table (
  id uuid,
  actor_id uuid,
  actor_display_name text,
  from_status text,
  to_status text,
  comment text,
  created_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select *
  from private.get_task_history(p_task_id);
$$;

revoke all on function private.get_task_history(uuid)
  from public, anon, authenticated;
revoke all on function public.get_task_history(uuid)
  from public, anon, authenticated;

grant execute on function private.get_task_history(uuid)
  to authenticated;
grant execute on function public.get_task_history(uuid)
  to authenticated;
