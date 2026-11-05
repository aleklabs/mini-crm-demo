begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

create or replace function pg_temp.command_fails_with_sqlstate(
  command text,
  expected_state text
)
returns boolean
language plpgsql
as $$
begin
  execute command;
  return false;
exception
  when others then
    return sqlstate = expected_state;
end;
$$;

select plan(32);

select ok(
  to_regprocedure('public.get_task_history(uuid)') is not null,
  'public history RPC exists'
);
select ok(
  to_regprocedure('private.get_task_history(uuid)') is not null,
  'private history implementation exists'
);
select ok(
  not (
    select prosecdef
    from pg_proc
    where oid = 'public.get_task_history(uuid)'::regprocedure
  ),
  'public history RPC is SECURITY INVOKER'
);
select ok(
  (
    select prosecdef
      and proconfig @> array['search_path=""']::text[]
    from pg_proc
    where oid = 'private.get_task_history(uuid)'::regprocedure
  ),
  'private history implementation is SECURITY DEFINER with empty search_path'
);
select ok(
  (
    select proconfig @> array['search_path=""']::text[]
    from pg_proc
    where oid = 'public.get_task_history(uuid)'::regprocedure
  ),
  'public history RPC also has an empty search_path'
);
select ok(
  (
    select provolatile = 's'
    from pg_proc
    where oid = 'public.get_task_history(uuid)'::regprocedure
  )
  and (
    select provolatile = 's'
    from pg_proc
    where oid = 'private.get_task_history(uuid)'::regprocedure
  ),
  'history functions are read-only stable functions'
);
select ok(
  has_function_privilege(
    'authenticated',
    'public.get_task_history(uuid)',
    'EXECUTE'
  )
  and has_function_privilege(
    'authenticated',
    'private.get_task_history(uuid)',
    'EXECUTE'
  ),
  'authenticated can execute only the exposed history path'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.get_task_history(uuid)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'anon',
    'private.get_task_history(uuid)',
    'EXECUTE'
  )
  and not exists (
    select 1
    from aclexplode(
      (
        select proacl
        from pg_proc
        where oid = 'public.get_task_history(uuid)'::regprocedure
      )
    ) as acl
    where acl.grantee = 0
      and acl.privilege_type = 'EXECUTE'
  ),
  'anon and PUBLIC cannot execute the history functions'
);
select ok(
  has_table_privilege(
    'authenticated',
    'public.task_status_history',
    'SELECT'
  )
  and not has_table_privilege(
    'authenticated',
    'public.task_status_history',
    'INSERT'
  )
  and not has_table_privilege(
    'authenticated',
    'public.task_status_history',
    'UPDATE'
  )
  and not has_table_privilege(
    'authenticated',
    'public.task_status_history',
    'DELETE'
  ),
  'history table permissions remain read-only'
);

select lives_ok(
  $sql$
    insert into auth.users (id, email)
    values
      ('03000000-0000-4000-8000-000000000001', 'history-manager@example.test'),
      ('03000000-0000-4000-8000-000000000011', 'history-executor1@example.test'),
      ('03000000-0000-4000-8000-000000000012', 'history-executor2@example.test'),
      ('03000000-0000-4000-8000-000000000099', 'history-no-profile@example.test')
  $sql$,
  'history auth fixtures are created'
);
select lives_ok(
  $sql$
    insert into public.profiles (id, display_name, role)
    values
      ('03000000-0000-4000-8000-000000000001', 'History Manager', 'manager'),
      ('03000000-0000-4000-8000-000000000011', 'History Executor One', 'executor'),
      ('03000000-0000-4000-8000-000000000012', 'History Executor Two', 'executor')
  $sql$,
  'history profile fixtures are created'
);
select lives_ok(
  $sql$
    insert into public.projects (id, name, address, deleted_at)
    values
      ('13000000-0000-4000-8000-000000000001', 'History Active Project', 'Address', null),
      ('13000000-0000-4000-8000-000000000002', 'History Deleted Project', 'Address', now())
  $sql$,
  'history project fixtures are created'
);
select lives_ok(
  $sql$
    insert into public.tasks (
      id,
      project_id,
      assignee_id,
      created_by,
      title,
      description,
      status,
      deleted_at
    )
    values
      ('23000000-0000-4000-8000-000000000001', '13000000-0000-4000-8000-000000000001', '03000000-0000-4000-8000-000000000011', '03000000-0000-4000-8000-000000000001', 'Lifecycle', 'Description', 'new', null),
      ('23000000-0000-4000-8000-000000000002', '13000000-0000-4000-8000-000000000001', '03000000-0000-4000-8000-000000000011', '03000000-0000-4000-8000-000000000001', 'Reassigned', 'Description', 'new', null),
      ('23000000-0000-4000-8000-000000000003', '13000000-0000-4000-8000-000000000001', '03000000-0000-4000-8000-000000000011', '03000000-0000-4000-8000-000000000001', 'Deleted', 'Description', 'new', now()),
      ('23000000-0000-4000-8000-000000000004', '13000000-0000-4000-8000-000000000002', '03000000-0000-4000-8000-000000000011', '03000000-0000-4000-8000-000000000001', 'Deleted Project', 'Description', 'new', null)
  $sql$,
  'history task fixtures and initial events are created'
);

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"03000000-0000-4000-8000-000000000011","role":"authenticated"}';
select lives_ok(
  $sql$select public.transition_task('23000000-0000-4000-8000-000000000001', 'in_progress', null)$sql$,
  'executor starts the history lifecycle'
);
select lives_ok(
  $sql$select public.transition_task('23000000-0000-4000-8000-000000000001', 'in_review', 'Ready')$sql$,
  'executor sends the task to review'
);
reset role;
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"03000000-0000-4000-8000-000000000001","role":"authenticated"}';
select lives_ok(
  $sql$select public.transition_task('23000000-0000-4000-8000-000000000001', 'rework', 'Please revise')$sql$,
  'manager returns the task to rework'
);

select is(
  (
    select count(*)
    from public.get_task_history('23000000-0000-4000-8000-000000000001')
  ),
  4::bigint,
  'manager reads all lifecycle history events'
);
select is(
  (
    select array_agg(actor_display_name order by actor_display_name)
    from public.get_task_history('23000000-0000-4000-8000-000000000001')
  ),
  array[
    'History Executor One',
    'History Executor One',
    'History Manager',
    'History Manager'
  ]::text[],
  'RPC returns the correct author name for every event'
);
select is(
  (
    select comment
    from public.get_task_history('23000000-0000-4000-8000-000000000001')
    where to_status = 'rework'
  ),
  'Please revise',
  'RPC returns transition comments'
);
select ok(
  (
    select array_agg(id) = array_agg(id order by created_at, id)
    from public.get_task_history('23000000-0000-4000-8000-000000000001')
  ),
  'RPC returns history in stable chronological order'
);

set local "request.jwt.claims" = '{"sub":"03000000-0000-4000-8000-000000000011","role":"authenticated"}';
select is(
  (
    select count(*)
    from public.get_task_history('23000000-0000-4000-8000-000000000001')
  ),
  4::bigint,
  'assigned executor reads the complete task history'
);
select is(
  (
    select count(*)
    from public.get_task_history('23000000-0000-4000-8000-000000000001')
    where actor_display_name = 'History Manager'
  ),
  2::bigint,
  'executor receives manager names from history'
);
select is(
  (select count(*) from public.profiles where id = '03000000-0000-4000-8000-000000000001'),
  0::bigint,
  'history RPC does not grant executor arbitrary manager profile reads'
);

set local "request.jwt.claims" = '{"sub":"03000000-0000-4000-8000-000000000012","role":"authenticated"}';
select is(
  (
    select count(*)
    from public.get_task_history('23000000-0000-4000-8000-000000000001')
  ),
  0::bigint,
  'another executor receives no foreign task history'
);

reset role;
update public.tasks
set assignee_id = '03000000-0000-4000-8000-000000000012'
where id = '23000000-0000-4000-8000-000000000002';
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"03000000-0000-4000-8000-000000000011","role":"authenticated"}';
select is(
  (
    select count(*)
    from public.get_task_history('23000000-0000-4000-8000-000000000002')
  ),
  0::bigint,
  'former executor loses history access after reassignment'
);
set local "request.jwt.claims" = '{"sub":"03000000-0000-4000-8000-000000000012","role":"authenticated"}';
select is(
  (
    select count(*)
    from public.get_task_history('23000000-0000-4000-8000-000000000002')
  ),
  1::bigint,
  'current executor receives reassigned task history'
);

set local "request.jwt.claims" = '{"sub":"03000000-0000-4000-8000-000000000099","role":"authenticated"}';
select is(
  (
    select count(*)
    from public.get_task_history('23000000-0000-4000-8000-000000000001')
  ),
  0::bigint,
  'authenticated user without a profile receives no history'
);
set local "request.jwt.claims" = '{"sub":"03000000-0000-4000-8000-000000000001","role":"authenticated"}';
select is(
  (
    select count(*)
    from public.get_task_history('23000000-0000-4000-8000-000000000003')
  ),
  0::bigint,
  'deleted task history is unavailable'
);
select is(
  (
    select count(*)
    from public.get_task_history('23000000-0000-4000-8000-000000000004')
  ),
  0::bigint,
  'task history in a deleted project is unavailable'
);
select is(
  (
    select count(*)
    from public.get_task_history('23000000-0000-4000-8000-000000000099')
  ),
  0::bigint,
  'missing task returns no history and no existence details'
);

select ok(
  pg_temp.command_fails_with_sqlstate(
    $sql$update public.task_status_history set comment = 'Forged' where task_id = '23000000-0000-4000-8000-000000000001'$sql$,
    '42501'
  ),
  'history RPC adds no mutation capability'
);

reset role;
set local role anon;
select ok(
  pg_temp.command_fails_with_sqlstate(
    $sql$select * from public.get_task_history('23000000-0000-4000-8000-000000000001')$sql$,
    '42501'
  ),
  'anon cannot invoke the history RPC'
);

select * from finish();
rollback;
