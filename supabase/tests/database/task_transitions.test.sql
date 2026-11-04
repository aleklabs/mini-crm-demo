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

create or replace function pg_temp.transition_fails_unchanged(
  target_task_id uuid,
  new_status text,
  transition_comment text,
  expected_state text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  before_status text;
  after_status text;
  before_history_count bigint;
  after_history_count bigint;
  actual_state text;
begin
  select status
  into before_status
  from public.tasks
  where id = target_task_id;

  select count(*)
  into before_history_count
  from public.task_status_history
  where task_id = target_task_id;

  begin
    perform public.transition_task(
      target_task_id,
      new_status,
      transition_comment
    );
    return false;
  exception
    when others then
      get stacked diagnostics actual_state = returned_sqlstate;
  end;

  select status
  into after_status
  from public.tasks
  where id = target_task_id;

  select count(*)
  into after_history_count
  from public.task_status_history
  where task_id = target_task_id;

  return actual_state = expected_state
    and before_status is not distinct from after_status
    and before_history_count = after_history_count;
end;
$$;

select plan(86);

select ok(
  to_regprocedure('public.transition_task(uuid,text,text)') is not null,
  'public transition_task RPC exists with the expected signature'
);
select is(
  (
    select pronargdefaults
    from pg_proc
    where oid = 'public.transition_task(uuid,text,text)'::regprocedure
  ),
  1::smallint,
  'public RPC has one default argument for the optional comment'
);
select ok(
  not (
    select prosecdef
    from pg_proc
    where oid = 'public.transition_task(uuid,text,text)'::regprocedure
  ),
  'public RPC is SECURITY INVOKER'
);
select ok(
  (
    select prosecdef
      and proconfig @> array['search_path=""']::text[]
    from pg_proc
    where oid = 'private.transition_task(uuid,text,text)'::regprocedure
  ),
  'private transition implementation is SECURITY DEFINER with empty search_path'
);
select ok(
  has_function_privilege(
    'authenticated',
    'public.transition_task(uuid,text,text)',
    'EXECUTE'
  )
  and has_function_privilege(
    'authenticated',
    'private.transition_task(uuid,text,text)',
    'EXECUTE'
  ),
  'authenticated can execute the public and private transition functions'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.transition_task(uuid,text,text)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'anon',
    'private.transition_task(uuid,text,text)',
    'EXECUTE'
  )
  and not exists (
    select 1
    from aclexplode(
      (
        select proacl
        from pg_proc
        where oid = 'public.transition_task(uuid,text,text)'::regprocedure
      )
    ) as acl
    where acl.grantee = 0
      and acl.privilege_type = 'EXECUTE'
  ),
  'anon and PUBLIC cannot execute transition functions'
);
select ok(
  not has_column_privilege(
    'authenticated',
    'public.tasks',
    'status',
    'UPDATE'
  ),
  'authenticated still has no direct UPDATE grant on task status'
);
select ok(
  exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.tasks'::regclass
      and tgname = 'tasks_record_initial_history'
      and not tgisinternal
  ),
  'task initial-history trigger exists'
);

select lives_ok(
  $sql$
    insert into auth.users (id, email)
    values
      ('02000000-0000-4000-8000-000000000001', 'manager1-transition@example.test'),
      ('02000000-0000-4000-8000-000000000002', 'manager2-transition@example.test'),
      ('02000000-0000-4000-8000-000000000011', 'executor1-transition@example.test'),
      ('02000000-0000-4000-8000-000000000012', 'executor2-transition@example.test'),
      ('02000000-0000-4000-8000-000000000099', 'no-profile-transition@example.test')
  $sql$,
  'transition auth fixtures are created'
);
select lives_ok(
  $sql$
    insert into public.profiles (id, display_name, role)
    values
      ('02000000-0000-4000-8000-000000000001', 'Transition Manager One', 'manager'),
      ('02000000-0000-4000-8000-000000000002', 'Transition Manager Two', 'manager'),
      ('02000000-0000-4000-8000-000000000011', 'Transition Executor One', 'executor'),
      ('02000000-0000-4000-8000-000000000012', 'Transition Executor Two', 'executor')
  $sql$,
  'transition profile fixtures are created'
);
select lives_ok(
  $sql$
    insert into public.projects (id, name, address, deleted_at)
    values
      (
        '12000000-0000-4000-8000-000000000001',
        'Active Transition Project',
        'Active Address',
        null
      ),
      (
        '12000000-0000-4000-8000-000000000002',
        'Deleted Transition Project',
        'Deleted Address',
        now()
      )
  $sql$,
  'transition project fixtures are created'
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
      ('22000000-0000-4000-8000-000000000001', '12000000-0000-4000-8000-000000000001', '02000000-0000-4000-8000-000000000011', '02000000-0000-4000-8000-000000000001', 'Allowed New', 'Description', 'new', null),
      ('22000000-0000-4000-8000-000000000002', '12000000-0000-4000-8000-000000000001', '02000000-0000-4000-8000-000000000011', '02000000-0000-4000-8000-000000000001', 'Allowed In Progress', 'Description', 'in_progress', null),
      ('22000000-0000-4000-8000-000000000003', '12000000-0000-4000-8000-000000000001', '02000000-0000-4000-8000-000000000011', '02000000-0000-4000-8000-000000000001', 'Allowed Review Accept', 'Description', 'in_review', null),
      ('22000000-0000-4000-8000-000000000004', '12000000-0000-4000-8000-000000000001', '02000000-0000-4000-8000-000000000011', '02000000-0000-4000-8000-000000000001', 'Allowed Review Rework', 'Description', 'in_review', null),
      ('22000000-0000-4000-8000-000000000005', '12000000-0000-4000-8000-000000000001', '02000000-0000-4000-8000-000000000011', '02000000-0000-4000-8000-000000000001', 'Allowed Rework', 'Description', 'rework', null),
      ('22000000-0000-4000-8000-000000000006', '12000000-0000-4000-8000-000000000001', '02000000-0000-4000-8000-000000000011', '02000000-0000-4000-8000-000000000001', 'Negative Review', 'Description', 'in_review', null),
      ('22000000-0000-4000-8000-000000000007', '12000000-0000-4000-8000-000000000001', '02000000-0000-4000-8000-000000000011', '02000000-0000-4000-8000-000000000001', 'Negative New', 'Description', 'new', null),
      ('22000000-0000-4000-8000-000000000008', '12000000-0000-4000-8000-000000000001', '02000000-0000-4000-8000-000000000011', '02000000-0000-4000-8000-000000000001', 'Negative In Progress', 'Description', 'in_progress', null),
      ('22000000-0000-4000-8000-000000000009', '12000000-0000-4000-8000-000000000001', '02000000-0000-4000-8000-000000000012', '02000000-0000-4000-8000-000000000001', 'Foreign Executor Task', 'Description', 'new', null),
      ('22000000-0000-4000-8000-000000000010', '12000000-0000-4000-8000-000000000001', '02000000-0000-4000-8000-000000000011', '02000000-0000-4000-8000-000000000001', 'Accepted Final Task', 'Description', 'accepted', null),
      ('22000000-0000-4000-8000-000000000011', '12000000-0000-4000-8000-000000000001', '02000000-0000-4000-8000-000000000011', '02000000-0000-4000-8000-000000000001', 'Missing Matrix Task', 'Description', 'new', null),
      ('22000000-0000-4000-8000-000000000012', '12000000-0000-4000-8000-000000000001', '02000000-0000-4000-8000-000000000011', '02000000-0000-4000-8000-000000000001', 'Comment Required Task', 'Description', 'in_review', null),
      ('22000000-0000-4000-8000-000000000013', '12000000-0000-4000-8000-000000000001', '02000000-0000-4000-8000-000000000011', '02000000-0000-4000-8000-000000000001', 'Deleted Task', 'Description', 'new', now()),
      ('22000000-0000-4000-8000-000000000014', '12000000-0000-4000-8000-000000000002', '02000000-0000-4000-8000-000000000011', '02000000-0000-4000-8000-000000000001', 'Deleted Project Task', 'Description', 'new', null),
      ('22000000-0000-4000-8000-000000000015', '12000000-0000-4000-8000-000000000001', '02000000-0000-4000-8000-000000000011', '02000000-0000-4000-8000-000000000001', 'Atomic Task', 'Description', 'new', null)
  $sql$,
  'transition task fixtures are created'
);

select is(
  (select count(*) from public.task_status_history where task_id = '22000000-0000-4000-8000-000000000001'),
  1::bigint,
  'task insert creates exactly one initial history event'
);
select is(
  (select actor_id from public.task_status_history where task_id = '22000000-0000-4000-8000-000000000001'),
  '02000000-0000-4000-8000-000000000001'::uuid,
  'initial history actor is created_by'
);
select ok(
  (select from_status is null from public.task_status_history where task_id = '22000000-0000-4000-8000-000000000001'),
  'initial history has NULL from_status'
);
select is(
  (select to_status from public.task_status_history where task_id = '22000000-0000-4000-8000-000000000001'),
  'new',
  'initial history records new status'
);
select ok(
  (select comment is null from public.task_status_history where task_id = '22000000-0000-4000-8000-000000000001'),
  'initial history stores a missing comment as NULL'
);
select ok(
  (select created_at is not null from public.task_status_history where task_id = '22000000-0000-4000-8000-000000000001'),
  'initial history creation time is generated by the database'
);

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"02000000-0000-4000-8000-000000000011","role":"authenticated"}';

select lives_ok(
  $sql$select public.transition_task('22000000-0000-4000-8000-000000000001', 'in_progress', null)$sql$,
  'assigned executor transitions new to in_progress'
);
reset role;
select is((select status from public.tasks where id = '22000000-0000-4000-8000-000000000001'), 'in_progress', 'new to in_progress stores the new status');
select is((select count(*) from public.task_status_history where task_id = '22000000-0000-4000-8000-000000000001'), 2::bigint, 'new to in_progress creates exactly one transition event');
select is((select actor_id from public.task_status_history where task_id = '22000000-0000-4000-8000-000000000001' and from_status = 'new'), '02000000-0000-4000-8000-000000000011'::uuid, 'new to in_progress records the executor actor');
select is((select from_status from public.task_status_history where task_id = '22000000-0000-4000-8000-000000000001' and from_status = 'new'), 'new', 'new to in_progress records from_status');
select is((select to_status from public.task_status_history where task_id = '22000000-0000-4000-8000-000000000001' and from_status = 'new'), 'in_progress', 'new to in_progress records to_status');
select is((select comment from public.task_status_history where task_id = '22000000-0000-4000-8000-000000000001' and from_status = 'new'), null::text, 'new to in_progress stores omitted comment as NULL');

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"02000000-0000-4000-8000-000000000011","role":"authenticated"}';
select lives_ok(
  $sql$select public.transition_task('22000000-0000-4000-8000-000000000002', 'in_review', 'Ready for review')$sql$,
  'assigned executor transitions in_progress to in_review'
);
reset role;
select is((select status from public.tasks where id = '22000000-0000-4000-8000-000000000002'), 'in_review', 'in_progress to in_review stores the new status');
select is((select count(*) from public.task_status_history where task_id = '22000000-0000-4000-8000-000000000002'), 2::bigint, 'in_progress to in_review creates exactly one transition event');
select is((select actor_id from public.task_status_history where task_id = '22000000-0000-4000-8000-000000000002' and from_status = 'in_progress'), '02000000-0000-4000-8000-000000000011'::uuid, 'in_progress to in_review records the executor actor');
select is((select from_status from public.task_status_history where task_id = '22000000-0000-4000-8000-000000000002' and from_status = 'in_progress'), 'in_progress', 'in_progress to in_review records from_status');
select is((select to_status from public.task_status_history where task_id = '22000000-0000-4000-8000-000000000002' and from_status = 'in_progress'), 'in_review', 'in_progress to in_review records to_status');
select is((select comment from public.task_status_history where task_id = '22000000-0000-4000-8000-000000000002' and from_status = 'in_progress'), 'Ready for review', 'in_progress to in_review records optional comment');

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"02000000-0000-4000-8000-000000000001","role":"authenticated"}';
select lives_ok(
  $sql$select public.transition_task('22000000-0000-4000-8000-000000000003', 'accepted', null)$sql$,
  'manager transitions in_review to accepted'
);
reset role;
select is((select status from public.tasks where id = '22000000-0000-4000-8000-000000000003'), 'accepted', 'in_review to accepted stores the new status');
select is((select count(*) from public.task_status_history where task_id = '22000000-0000-4000-8000-000000000003'), 2::bigint, 'in_review to accepted creates exactly one transition event');
select is((select actor_id from public.task_status_history where task_id = '22000000-0000-4000-8000-000000000003' and from_status = 'in_review'), '02000000-0000-4000-8000-000000000001'::uuid, 'in_review to accepted records the manager actor');
select is((select from_status from public.task_status_history where task_id = '22000000-0000-4000-8000-000000000003' and from_status = 'in_review'), 'in_review', 'in_review to accepted records from_status');
select is((select to_status from public.task_status_history where task_id = '22000000-0000-4000-8000-000000000003' and from_status = 'in_review'), 'accepted', 'in_review to accepted records to_status');
select is((select comment from public.task_status_history where task_id = '22000000-0000-4000-8000-000000000003' and from_status = 'in_review'), null::text, 'in_review to accepted stores omitted comment as NULL');

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"02000000-0000-4000-8000-000000000002","role":"authenticated"}';
select lives_ok(
  $sql$select public.transition_task('22000000-0000-4000-8000-000000000004', 'rework', 'Please revise')$sql$,
  'manager transitions in_review to rework with a comment'
);
reset role;
select is((select status from public.tasks where id = '22000000-0000-4000-8000-000000000004'), 'rework', 'in_review to rework stores the new status');
select is((select count(*) from public.task_status_history where task_id = '22000000-0000-4000-8000-000000000004'), 2::bigint, 'in_review to rework creates exactly one transition event');
select is((select actor_id from public.task_status_history where task_id = '22000000-0000-4000-8000-000000000004' and from_status = 'in_review'), '02000000-0000-4000-8000-000000000002'::uuid, 'in_review to rework records the manager actor');
select is((select from_status from public.task_status_history where task_id = '22000000-0000-4000-8000-000000000004' and from_status = 'in_review'), 'in_review', 'in_review to rework records from_status');
select is((select to_status from public.task_status_history where task_id = '22000000-0000-4000-8000-000000000004' and from_status = 'in_review'), 'rework', 'in_review to rework records to_status');
select is((select comment from public.task_status_history where task_id = '22000000-0000-4000-8000-000000000004' and from_status = 'in_review'), 'Please revise', 'in_review to rework records the required comment');

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"02000000-0000-4000-8000-000000000011","role":"authenticated"}';
select lives_ok(
  $sql$select public.transition_task('22000000-0000-4000-8000-000000000005', 'in_progress', null)$sql$,
  'assigned executor transitions rework to in_progress'
);
reset role;
select is((select status from public.tasks where id = '22000000-0000-4000-8000-000000000005'), 'in_progress', 'rework to in_progress stores the new status');
select is((select count(*) from public.task_status_history where task_id = '22000000-0000-4000-8000-000000000005'), 2::bigint, 'rework to in_progress creates exactly one transition event');
select is((select actor_id from public.task_status_history where task_id = '22000000-0000-4000-8000-000000000005' and from_status = 'rework'), '02000000-0000-4000-8000-000000000011'::uuid, 'rework to in_progress records the executor actor');
select is((select from_status from public.task_status_history where task_id = '22000000-0000-4000-8000-000000000005' and from_status = 'rework'), 'rework', 'rework to in_progress records from_status');
select is((select to_status from public.task_status_history where task_id = '22000000-0000-4000-8000-000000000005' and from_status = 'rework'), 'in_progress', 'rework to in_progress records to_status');
select is((select comment from public.task_status_history where task_id = '22000000-0000-4000-8000-000000000005' and from_status = 'rework'), null::text, 'rework to in_progress stores omitted comment as NULL');

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"02000000-0000-4000-8000-000000000001","role":"authenticated"}';
select is((select count(*) from public.tasks where id = '22000000-0000-4000-8000-000000000014'), 0::bigint, 'manager cannot read a task in a deleted project');
select is((select count(*) from public.task_status_history where task_id = '22000000-0000-4000-8000-000000000014'), 0::bigint, 'manager cannot read history for a task in a deleted project');

set local "request.jwt.claims" = '{"sub":"02000000-0000-4000-8000-000000000011","role":"authenticated"}';
select ok(pg_temp.transition_fails_unchanged('22000000-0000-4000-8000-000000000006', 'accepted', null, '42501'), 'executor cannot accept a task and leaves state unchanged');
select ok(pg_temp.transition_fails_unchanged('22000000-0000-4000-8000-000000000006', 'rework', 'Executor comment', '42501'), 'executor cannot return a task to rework and leaves state unchanged');

set local "request.jwt.claims" = '{"sub":"02000000-0000-4000-8000-000000000001","role":"authenticated"}';
select ok(pg_temp.transition_fails_unchanged('22000000-0000-4000-8000-000000000007', 'in_progress', null, '42501'), 'manager cannot take a task into work and leaves state unchanged');
select ok(pg_temp.transition_fails_unchanged('22000000-0000-4000-8000-000000000008', 'in_review', null, '42501'), 'manager cannot send a task to review and leaves state unchanged');

set local "request.jwt.claims" = '{"sub":"02000000-0000-4000-8000-000000000011","role":"authenticated"}';
select ok(pg_temp.transition_fails_unchanged('22000000-0000-4000-8000-000000000009', 'in_progress', null, '42501'), 'executor cannot transition another executor task and leaves state unchanged');

set local "request.jwt.claims" = '{"sub":"02000000-0000-4000-8000-000000000099","role":"authenticated"}';
select ok(pg_temp.transition_fails_unchanged('22000000-0000-4000-8000-000000000007', 'in_progress', null, '42501'), 'authenticated user without a profile is rejected without changes');

set local "request.jwt.claims" = '{"role":"authenticated"}';
select ok(pg_temp.transition_fails_unchanged('22000000-0000-4000-8000-000000000007', 'in_progress', null, '28000'), 'missing authenticated user identity is rejected without changes');

set local "request.jwt.claims" = '{"sub":"02000000-0000-4000-8000-000000000011","role":"authenticated"}';
select ok(pg_temp.transition_fails_unchanged('22000000-0000-4000-8000-000000000099', 'in_progress', null, 'P0002'), 'nonexistent task is rejected without creating history');
select ok(pg_temp.transition_fails_unchanged('22000000-0000-4000-8000-000000000013', 'in_progress', null, '55000'), 'deleted task is rejected without changes');
select ok(pg_temp.transition_fails_unchanged('22000000-0000-4000-8000-000000000014', 'in_progress', null, '55000'), 'task in a deleted project is rejected without changes');
select ok(pg_temp.transition_fails_unchanged('22000000-0000-4000-8000-000000000007', 'closed', null, '22023'), 'unknown target status is rejected without changes');
select ok(pg_temp.transition_fails_unchanged('22000000-0000-4000-8000-000000000007', 'new', null, '22023'), 'repeating the same status is rejected without changes');
select ok(pg_temp.transition_fails_unchanged('22000000-0000-4000-8000-000000000010', 'rework', 'Again', '22023'), 'accepted status is terminal and remains unchanged');
select ok(pg_temp.transition_fails_unchanged('22000000-0000-4000-8000-000000000011', 'in_review', null, '22023'), 'transition absent from the matrix is rejected without changes');

set local "request.jwt.claims" = '{"sub":"02000000-0000-4000-8000-000000000001","role":"authenticated"}';
select ok(pg_temp.transition_fails_unchanged('22000000-0000-4000-8000-000000000012', 'rework', null, '22023'), 'rework without a comment is rejected without changes');
select ok(pg_temp.transition_fails_unchanged('22000000-0000-4000-8000-000000000012', 'rework', '', '22023'), 'rework with an empty comment is rejected without changes');
select ok(pg_temp.transition_fails_unchanged('22000000-0000-4000-8000-000000000012', 'rework', '   ', '22023'), 'rework with a whitespace-only comment is rejected without changes');

reset role;
set local role anon;
select ok(
  pg_temp.command_fails_with_sqlstate(
    $sql$select public.transition_task('22000000-0000-4000-8000-000000000007', 'in_progress', null)$sql$,
    '42501'
  ),
  'anon cannot execute transition RPC'
);
reset role;
select is((select status from public.tasks where id = '22000000-0000-4000-8000-000000000007'), 'new', 'anon attempt leaves task status unchanged');
select is((select count(*) from public.task_status_history where task_id = '22000000-0000-4000-8000-000000000007'), 1::bigint, 'anon attempt creates no history');

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"02000000-0000-4000-8000-000000000001","role":"authenticated"}';
select ok(
  pg_temp.command_fails_with_sqlstate(
    $sql$update public.tasks set status = 'accepted' where id = '22000000-0000-4000-8000-000000000007'$sql$,
    '42501'
  ),
  'direct task status update remains forbidden'
);
reset role;
select is((select status from public.tasks where id = '22000000-0000-4000-8000-000000000007'), 'new', 'direct status update leaves status unchanged');
select is((select count(*) from public.task_status_history where task_id = '22000000-0000-4000-8000-000000000007'), 1::bigint, 'direct status update creates no history');

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"02000000-0000-4000-8000-000000000001","role":"authenticated"}';
select ok(pg_temp.command_fails_with_sqlstate($sql$insert into public.task_status_history (task_id, actor_id, from_status, to_status) values ('22000000-0000-4000-8000-000000000006', '02000000-0000-4000-8000-000000000001', 'in_review', 'accepted')$sql$, '42501'), 'direct history insert remains forbidden');
select ok(pg_temp.command_fails_with_sqlstate($sql$update public.task_status_history set comment = 'Forged' where task_id = '22000000-0000-4000-8000-000000000006'$sql$, '42501'), 'direct history update remains forbidden');
select ok(pg_temp.command_fails_with_sqlstate($sql$delete from public.task_status_history where task_id = '22000000-0000-4000-8000-000000000006'$sql$, '42501'), 'direct history delete remains forbidden');
reset role;
select is((select count(*) from public.task_status_history where task_id = '22000000-0000-4000-8000-000000000006'), 1::bigint, 'direct history attempts do not add or remove events');
select is((select comment from public.task_status_history where task_id = '22000000-0000-4000-8000-000000000006'), null::text, 'direct history attempts do not alter the event');

create function pg_temp.fail_atomic_history_insert()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Synthetic history failure';
end;
$$;

create trigger test_fail_atomic_history_insert
before insert on public.task_status_history
for each row
when (new.task_id = '22000000-0000-4000-8000-000000000015'::uuid)
execute function pg_temp.fail_atomic_history_insert();

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"02000000-0000-4000-8000-000000000011","role":"authenticated"}';
select ok(pg_temp.transition_fails_unchanged('22000000-0000-4000-8000-000000000015', 'in_progress', null, 'P0001'), 'history insertion failure rejects the transition atomically');
reset role;
select is((select status from public.tasks where id = '22000000-0000-4000-8000-000000000015'), 'new', 'history failure rolls task status back');
select is((select count(*) from public.task_status_history where task_id = '22000000-0000-4000-8000-000000000015'), 1::bigint, 'history failure leaves only the initial event');

select * from finish();
rollback;
