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

select plan(91);

select is(
  (
    select count(*)::integer
    from pg_policies
    where schemaname = 'public'
      and policyname in (
        'profiles_select_authenticated',
        'projects_select_authenticated',
        'projects_insert_manager',
        'projects_update_manager',
        'tasks_select_authenticated',
        'tasks_insert_manager',
        'tasks_update_manager',
        'task_status_history_select_authenticated'
      )
  ),
  8,
  'all expected RLS policies exist'
);

select ok(
  not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename in ('profiles', 'projects', 'tasks', 'task_status_history')
      and roles <> array['authenticated']::name[]
  ),
  'all CRM policies apply only to authenticated'
);

with checked(table_name, privilege_name) as (
  values
    ('profiles', 'SELECT'),
    ('profiles', 'INSERT'),
    ('profiles', 'UPDATE'),
    ('profiles', 'DELETE'),
    ('profiles', 'TRUNCATE'),
    ('projects', 'SELECT'),
    ('projects', 'INSERT'),
    ('projects', 'UPDATE'),
    ('projects', 'DELETE'),
    ('projects', 'TRUNCATE'),
    ('tasks', 'SELECT'),
    ('tasks', 'INSERT'),
    ('tasks', 'UPDATE'),
    ('tasks', 'DELETE'),
    ('tasks', 'TRUNCATE'),
    ('task_status_history', 'SELECT'),
    ('task_status_history', 'INSERT'),
    ('task_status_history', 'UPDATE'),
    ('task_status_history', 'DELETE'),
    ('task_status_history', 'TRUNCATE')
)
select ok(
  not exists (
    select 1
    from checked
    where has_table_privilege(
      'anon',
      format('public.%I', table_name),
      privilege_name
    )
  ),
  'anon has no effective privileges on CRM tables'
);

select is(
  (
    select count(*)::integer
    from information_schema.role_table_grants
    where table_schema = 'public'
      and table_name in ('profiles', 'projects', 'tasks', 'task_status_history')
      and grantee = 'PUBLIC'
  ),
  0,
  'PUBLIC has no CRM table privileges'
);

select ok(
  has_table_privilege('authenticated', 'public.profiles', 'SELECT')
  and not has_table_privilege('authenticated', 'public.profiles', 'INSERT')
  and not has_table_privilege('authenticated', 'public.profiles', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.profiles', 'DELETE')
  and not has_table_privilege('authenticated', 'public.profiles', 'TRUNCATE'),
  'profiles grants are read-only for authenticated'
);

select ok(
  has_table_privilege('authenticated', 'public.projects', 'SELECT')
  and not has_table_privilege('authenticated', 'public.projects', 'INSERT')
  and not has_table_privilege('authenticated', 'public.projects', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.projects', 'DELETE')
  and not has_table_privilege('authenticated', 'public.projects', 'TRUNCATE'),
  'projects have SELECT plus column-level write grants only'
);

select is(
  (
    select count(*)::integer
    from information_schema.column_privileges
    where table_schema = 'public'
      and table_name = 'projects'
      and grantee = 'authenticated'
      and privilege_type = 'INSERT'
      and column_name in ('name', 'address')
  ),
  2,
  'project INSERT is granted only on name and address'
);

select is(
  (
    select count(*)::integer
    from information_schema.column_privileges
    where table_schema = 'public'
      and table_name = 'projects'
      and grantee = 'authenticated'
      and privilege_type = 'UPDATE'
      and column_name in ('name', 'address', 'deleted_at')
  ),
  3,
  'project UPDATE is granted only on editable columns'
);

select ok(
  has_table_privilege('authenticated', 'public.tasks', 'SELECT')
  and not has_table_privilege('authenticated', 'public.tasks', 'INSERT')
  and not has_table_privilege('authenticated', 'public.tasks', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.tasks', 'DELETE')
  and not has_table_privilege('authenticated', 'public.tasks', 'TRUNCATE'),
  'tasks have SELECT plus column-level write grants only'
);

select is(
  (
    select count(*)::integer
    from information_schema.column_privileges
    where table_schema = 'public'
      and table_name = 'tasks'
      and grantee = 'authenticated'
      and privilege_type = 'INSERT'
      and column_name in ('project_id', 'assignee_id', 'title', 'description')
  ),
  4,
  'task INSERT is granted only on client-editable columns'
);

select is(
  (
    select count(*)::integer
    from information_schema.column_privileges
    where table_schema = 'public'
      and table_name = 'tasks'
      and grantee = 'authenticated'
      and privilege_type = 'UPDATE'
      and column_name in (
        'project_id',
        'assignee_id',
        'title',
        'description',
        'deleted_at'
      )
  ),
  5,
  'task UPDATE excludes id, status, creator and creation time'
);

select ok(
  has_table_privilege('authenticated', 'public.task_status_history', 'SELECT')
  and not has_table_privilege('authenticated', 'public.task_status_history', 'INSERT')
  and not has_table_privilege('authenticated', 'public.task_status_history', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.task_status_history', 'DELETE')
  and not has_table_privilege('authenticated', 'public.task_status_history', 'TRUNCATE'),
  'task history is read-only for authenticated'
);

select is(
  (
    select count(*)::integer
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private'
      and has_function_privilege('authenticated', p.oid, 'EXECUTE')
  ),
  3,
  'authenticated can execute only the two RLS helpers and transition implementation'
);

select is(
  (
    select count(*)::integer
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private'
      and has_function_privilege('anon', p.oid, 'EXECUTE')
  ),
  0,
  'anon cannot execute private functions'
);

select is(
  (
    select count(*)::integer
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private'
      and p.prosecdef
      and p.proconfig @> array['search_path=""']::text[]
  ),
  7,
  'all SECURITY DEFINER functions use an empty search_path'
);

select ok(
  exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.tasks'::regclass
      and tgname = 'tasks_enforce_assignee_role'
      and not tgisinternal
  ),
  'task assignee role trigger exists'
);

select is(
  (
    select count(*)::integer
    from pg_trigger
    where tgrelid in ('public.projects'::regclass, 'public.tasks'::regclass)
      and tgname in ('projects_apply_soft_delete', 'tasks_apply_soft_delete')
      and not tgisinternal
  ),
  2,
  'project and task soft-delete triggers exist'
);

select ok(
  (
    select column_default like '%auth.uid()%'
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'tasks'
      and column_name = 'created_by'
  ),
  'created_by defaults to auth.uid()'
);

select lives_ok(
  $sql$
    insert into auth.users (id, email)
    values
      ('01000000-0000-4000-8000-000000000001', 'manager1-rls@example.test'),
      ('01000000-0000-4000-8000-000000000002', 'manager2-rls@example.test'),
      ('01000000-0000-4000-8000-000000000011', 'executor1-rls@example.test'),
      ('01000000-0000-4000-8000-000000000012', 'executor2-rls@example.test')
  $sql$,
  'JWT test users are created'
);

select lives_ok(
  $sql$
    insert into public.profiles (id, display_name, role)
    values
      ('01000000-0000-4000-8000-000000000001', 'Manager One', 'manager'),
      ('01000000-0000-4000-8000-000000000002', 'Manager Two', 'manager'),
      ('01000000-0000-4000-8000-000000000011', 'Executor One', 'executor'),
      ('01000000-0000-4000-8000-000000000012', 'Executor Two', 'executor')
  $sql$,
  'role profiles are created'
);

select lives_ok(
  $sql$
    insert into public.projects (id, name, address, deleted_at)
    values
      (
        '11000000-0000-4000-8000-000000000001',
        'Executor One Project',
        'Address One',
        null
      ),
      (
        '11000000-0000-4000-8000-000000000002',
        'Executor Two Project',
        'Address Two',
        null
      ),
      (
        '11000000-0000-4000-8000-000000000003',
        'Unassigned Project',
        'Address Three',
        null
      ),
      (
        '11000000-0000-4000-8000-000000000004',
        'Deleted Project',
        'Address Four',
        now()
      )
  $sql$,
  'project fixtures are created'
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
      (
        '21000000-0000-4000-8000-000000000001',
        '11000000-0000-4000-8000-000000000001',
        '01000000-0000-4000-8000-000000000011',
        '01000000-0000-4000-8000-000000000001',
        'Executor One Task',
        'Description One',
        'new',
        null
      ),
      (
        '21000000-0000-4000-8000-000000000002',
        '11000000-0000-4000-8000-000000000002',
        '01000000-0000-4000-8000-000000000012',
        '01000000-0000-4000-8000-000000000002',
        'Executor Two Task',
        'Description Two',
        'new',
        null
      ),
      (
        '21000000-0000-4000-8000-000000000003',
        '11000000-0000-4000-8000-000000000001',
        '01000000-0000-4000-8000-000000000011',
        '01000000-0000-4000-8000-000000000001',
        'Deleted Task',
        'Deleted Description',
        'new',
        now()
      ),
      (
        '21000000-0000-4000-8000-000000000004',
        '11000000-0000-4000-8000-000000000004',
        '01000000-0000-4000-8000-000000000011',
        '01000000-0000-4000-8000-000000000001',
        'Task In Deleted Project',
        'Hidden Description',
        'new',
        null
      )
  $sql$,
  'task fixtures are created'
);

select is(
  (select count(*) from public.task_status_history),
  4::bigint,
  'initial history is created automatically for every task fixture'
);

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"01000000-0000-4000-8000-000000000001","role":"authenticated"}';

select is((select count(*) from public.profiles), 4::bigint, 'manager1 reads every profile');
select is((select count(*) from public.projects), 3::bigint, 'manager1 reads active projects');
select is(
  (select count(*) from public.tasks),
  2::bigint,
  'manager1 reads active tasks only in active projects'
);
select is(
  (select count(*) from public.task_status_history),
  2::bigint,
  'manager1 reads accessible task history'
);

set local "request.jwt.claims" = '{"sub":"01000000-0000-4000-8000-000000000002","role":"authenticated"}';

select is((select count(*) from public.profiles), 4::bigint, 'manager2 reads every profile');
select is((select count(*) from public.projects), 3::bigint, 'manager2 reads active projects');
select is(
  (select count(*) from public.tasks),
  2::bigint,
  'manager2 reads active tasks only in active projects'
);

set local "request.jwt.claims" = '{"sub":"01000000-0000-4000-8000-000000000001","role":"authenticated"}';

select lives_ok(
  $sql$
    insert into public.projects (name, address)
    values ('Manager Project', 'Manager Address')
  $sql$,
  'manager creates a project'
);
select ok(
  (
    select id is not null and deleted_at is null
    from public.projects
    where name = 'Manager Project'
  ),
  'project id is generated and deletion starts as null'
);
select lives_ok(
  $sql$
    update public.projects
    set name = 'Manager Project Updated', address = 'Manager Address Updated'
    where name = 'Manager Project'
  $sql$,
  'manager edits project name and address'
);

select lives_ok(
  $sql$
    insert into public.tasks (
      project_id,
      assignee_id,
      title,
      description
    )
    values (
      '11000000-0000-4000-8000-000000000001',
      '01000000-0000-4000-8000-000000000011',
      'Manager Task',
      'Manager Task Description'
    )
  $sql$,
  'manager creates a task for an executor'
);
select ok(
  (
    select
      id is not null
      and status = 'new'
      and created_by = '01000000-0000-4000-8000-000000000001'
      and created_at is not null
      and deleted_at is null
    from public.tasks
    where title = 'Manager Task'
  ),
  'task protected fields are generated by PostgreSQL'
);
select lives_ok(
  $sql$
    update public.tasks
    set
      project_id = '11000000-0000-4000-8000-000000000002',
      assignee_id = '01000000-0000-4000-8000-000000000012',
      title = 'Manager Task Updated',
      description = 'Manager Task Description Updated'
    where title = 'Manager Task'
  $sql$,
  'manager edits all permitted task fields and assigns another executor'
);

select ok(
  pg_temp.command_fails_with_sqlstate(
    $sql$
      insert into public.tasks (project_id, assignee_id, title, description)
      values (
        '11000000-0000-4000-8000-000000000001',
        '01000000-0000-4000-8000-000000000002',
        'Manager Assignee Task',
        'Description'
      )
    $sql$,
    '23514'
  ),
  'manager cannot assign a task to another manager'
);
select ok(
  pg_temp.command_fails_with_sqlstate(
    $sql$
      update public.tasks
      set assignee_id = '01000000-0000-4000-8000-000000000002'
      where title = 'Manager Task Updated'
    $sql$,
    '23514'
  ),
  'manager cannot change an assignee to a manager'
);
select ok(
  pg_temp.command_fails_with_sqlstate(
    $sql$
      insert into public.tasks (project_id, assignee_id, title, description)
      values (
        '11000000-0000-4000-8000-000000000004',
        '01000000-0000-4000-8000-000000000011',
        'Deleted Project Task',
        'Description'
      )
    $sql$,
    '42501'
  ),
  'manager cannot create a task in a deleted project'
);
select ok(
  pg_temp.command_fails_with_sqlstate(
    $sql$
      insert into public.tasks (
        project_id,
        assignee_id,
        title,
        description,
        status
      )
      values (
        '11000000-0000-4000-8000-000000000001',
        '01000000-0000-4000-8000-000000000011',
        'Forged Status Task',
        'Description',
        'accepted'
      )
    $sql$,
    '42501'
  ),
  'manager cannot provide status on task insert'
);
select ok(
  pg_temp.command_fails_with_sqlstate(
    $sql$
      insert into public.tasks (
        project_id,
        assignee_id,
        title,
        description,
        created_by
      )
      values (
        '11000000-0000-4000-8000-000000000001',
        '01000000-0000-4000-8000-000000000011',
        'Forged Creator Task',
        'Description',
        '01000000-0000-4000-8000-000000000002'
      )
    $sql$,
    '42501'
  ),
  'manager cannot provide created_by on task insert'
);
select ok(
  pg_temp.command_fails_with_sqlstate(
    $sql$
      insert into public.tasks (
        project_id,
        assignee_id,
        title,
        description,
        created_at
      )
      values (
        '11000000-0000-4000-8000-000000000001',
        '01000000-0000-4000-8000-000000000011',
        'Forged Time Task',
        'Description',
        '2000-01-01 00:00:00+00'
      )
    $sql$,
    '42501'
  ),
  'manager cannot provide created_at on task insert'
);
select ok(
  pg_temp.command_fails_with_sqlstate(
    $sql$
      insert into public.tasks (
        project_id,
        assignee_id,
        title,
        description,
        deleted_at
      )
      values (
        '11000000-0000-4000-8000-000000000001',
        '01000000-0000-4000-8000-000000000011',
        'Forged Deletion Task',
        'Description',
        now()
      )
    $sql$,
    '42501'
  ),
  'manager cannot provide deleted_at on task insert'
);
select ok(
  pg_temp.command_fails_with_sqlstate(
    $sql$update public.tasks set status = 'accepted' where id = '21000000-0000-4000-8000-000000000001'$sql$,
    '42501'
  ),
  'manager cannot update task status'
);
select ok(
  pg_temp.command_fails_with_sqlstate(
    $sql$update public.tasks set created_by = '01000000-0000-4000-8000-000000000002' where id = '21000000-0000-4000-8000-000000000001'$sql$,
    '42501'
  ),
  'manager cannot update task creator'
);
select ok(
  pg_temp.command_fails_with_sqlstate(
    $sql$update public.tasks set created_at = '2000-01-01 00:00:00+00' where id = '21000000-0000-4000-8000-000000000001'$sql$,
    '42501'
  ),
  'manager cannot update task creation time'
);

select ok(
  pg_temp.command_fails_with_sqlstate(
    $sql$
      insert into public.task_status_history (task_id, actor_id, to_status)
      values (
        '21000000-0000-4000-8000-000000000001',
        '01000000-0000-4000-8000-000000000001',
        'accepted'
      )
    $sql$,
    '42501'
  ),
  'manager cannot insert task history directly'
);
select ok(
  pg_temp.command_fails_with_sqlstate(
    $sql$update public.task_status_history set comment = 'Forged' where task_id = '21000000-0000-4000-8000-000000000001'$sql$,
    '42501'
  ),
  'manager cannot update task history directly'
);
select ok(
  pg_temp.command_fails_with_sqlstate(
    $sql$delete from public.task_status_history where task_id = '21000000-0000-4000-8000-000000000001'$sql$,
    '42501'
  ),
  'manager cannot delete task history directly'
);
select ok(
  pg_temp.command_fails_with_sqlstate(
    $sql$delete from public.tasks where id = '21000000-0000-4000-8000-000000000002'$sql$,
    '42501'
  ),
  'manager cannot physically delete a task'
);
select ok(
  pg_temp.command_fails_with_sqlstate(
    $sql$delete from public.projects where id = '11000000-0000-4000-8000-000000000003'$sql$,
    '42501'
  ),
  'manager cannot physically delete a project'
);
select ok(
  pg_temp.command_fails_with_sqlstate(
    $sql$
      insert into public.profiles (id, display_name, role)
      values ('01000000-0000-4000-8000-000000000099', 'Injected', 'manager')
    $sql$,
    '42501'
  ),
  'manager cannot create profiles'
);
select ok(
  pg_temp.command_fails_with_sqlstate(
    $sql$update public.profiles set role = 'manager' where id = '01000000-0000-4000-8000-000000000011'$sql$,
    '42501'
  ),
  'manager cannot update profile roles'
);
select ok(
  pg_temp.command_fails_with_sqlstate(
    $sql$update public.profiles set display_name = 'Changed' where id = '01000000-0000-4000-8000-000000000011'$sql$,
    '42501'
  ),
  'manager cannot update profile names'
);
select ok(
  pg_temp.command_fails_with_sqlstate(
    $sql$delete from public.profiles where id = '01000000-0000-4000-8000-000000000011'$sql$,
    '42501'
  ),
  'manager cannot delete profiles'
);

select lives_ok(
  $sql$
    update public.tasks
    set deleted_at = now()
    where title = 'Manager Task Updated'
  $sql$,
  'manager logically deletes a task'
);
select is(
  (select count(*) from public.tasks where title = 'Manager Task Updated'),
  0::bigint,
  'a logically deleted task disappears from manager queries'
);
select lives_ok(
  $sql$
    update public.projects
    set deleted_at = now()
    where name = 'Manager Project Updated'
  $sql$,
  'manager logically deletes a project'
);
select is(
  (select count(*) from public.projects where name = 'Manager Project Updated'),
  0::bigint,
  'a logically deleted project disappears from manager queries'
);

set local "request.jwt.claims" = '{"sub":"01000000-0000-4000-8000-000000000011","role":"authenticated"}';

select is((select count(*) from public.profiles), 1::bigint, 'executor1 reads only own profile');
select is((select count(*) from public.projects), 1::bigint, 'executor1 reads only assigned project');
select is((select count(*) from public.tasks), 1::bigint, 'executor1 reads only own active task');
select is(
  (select count(*) from public.tasks where id = '21000000-0000-4000-8000-000000000002'),
  0::bigint,
  'executor1 cannot read a foreign task by known UUID'
);
select is(
  (select count(*) from public.task_status_history),
  1::bigint,
  'executor1 reads history only for own accessible task'
);
select ok(
  pg_temp.command_fails_with_sqlstate(
    $sql$insert into public.projects (name, address) values ('Executor Project', 'Address')$sql$,
    '42501'
  ),
  'executor cannot create projects'
);
select ok(
  pg_temp.command_fails_with_sqlstate(
    $sql$
      insert into public.tasks (project_id, assignee_id, title, description)
      values (
        '11000000-0000-4000-8000-000000000001',
        '01000000-0000-4000-8000-000000000011',
        'Executor Created Task',
        'Description'
      )
    $sql$,
    '42501'
  ),
  'executor cannot create tasks'
);
select lives_ok(
  $sql$update public.projects set name = 'Executor Changed Project' where id = '11000000-0000-4000-8000-000000000001'$sql$,
  'executor project update safely affects zero rows'
);
select lives_ok(
  $sql$update public.tasks set title = 'Executor Changed Own Task' where id = '21000000-0000-4000-8000-000000000001'$sql$,
  'executor own task update safely affects zero rows'
);
select lives_ok(
  $sql$update public.tasks set title = 'Executor Changed Foreign Task' where id = '21000000-0000-4000-8000-000000000002'$sql$,
  'executor foreign task update safely affects zero rows'
);
select lives_ok(
  $sql$update public.tasks set assignee_id = '01000000-0000-4000-8000-000000000011' where id = '21000000-0000-4000-8000-000000000002'$sql$,
  'executor cannot reassign a foreign task and affects zero rows'
);
select ok(
  pg_temp.command_fails_with_sqlstate(
    $sql$update public.profiles set role = 'manager' where id = '01000000-0000-4000-8000-000000000011'$sql$,
    '42501'
  ),
  'executor cannot elevate own profile role'
);
select ok(
  pg_temp.command_fails_with_sqlstate(
    $sql$update public.profiles set display_name = 'Changed' where id = '01000000-0000-4000-8000-000000000011'$sql$,
    '42501'
  ),
  'executor cannot edit own display name'
);
select ok(
  pg_temp.command_fails_with_sqlstate(
    $sql$update public.task_status_history set comment = 'Executor Forged' where task_id = '21000000-0000-4000-8000-000000000001'$sql$,
    '42501'
  ),
  'executor cannot update task history'
);
select ok(
  pg_temp.command_fails_with_sqlstate(
    $sql$delete from public.task_status_history where task_id = '21000000-0000-4000-8000-000000000001'$sql$,
    '42501'
  ),
  'executor cannot delete task history'
);
select ok(
  pg_temp.command_fails_with_sqlstate(
    $sql$
      insert into public.task_status_history (task_id, actor_id, to_status)
      values (
        '21000000-0000-4000-8000-000000000001',
        '01000000-0000-4000-8000-000000000011',
        'accepted'
      )
    $sql$,
    '42501'
  ),
  'executor cannot insert task history'
);

set local "request.jwt.claims" = '{"sub":"01000000-0000-4000-8000-000000000012","role":"authenticated"}';

select is((select count(*) from public.profiles), 1::bigint, 'executor2 reads only own profile');
select is((select count(*) from public.projects), 1::bigint, 'executor2 reads only assigned project');
select is((select count(*) from public.tasks), 1::bigint, 'executor2 reads only own active task');
select is(
  (select count(*) from public.task_status_history),
  1::bigint,
  'executor2 reads history only for own accessible task'
);

reset role;
set local role anon;

select ok(
  pg_temp.command_fails_with_sqlstate(
    'select count(*) from public.projects',
    '42501'
  ),
  'anon cannot read CRM data'
);
select ok(
  pg_temp.command_fails_with_sqlstate(
    $sql$insert into public.projects (name, address) values ('Anon Project', 'Address')$sql$,
    '42501'
  ),
  'anon cannot create CRM data'
);

reset role;

select is(
  (
    select name
    from public.projects
    where id = '11000000-0000-4000-8000-000000000001'
  ),
  'Executor One Project',
  'executor project update did not change stored data'
);
select is(
  (
    select title
    from public.tasks
    where id = '21000000-0000-4000-8000-000000000001'
  ),
  'Executor One Task',
  'executor own task update did not change stored data'
);
select is(
  (
    select title
    from public.tasks
    where id = '21000000-0000-4000-8000-000000000002'
  ),
  'Executor Two Task',
  'executor foreign task update did not change stored data'
);
select is(
  (
    select assignee_id
    from public.tasks
    where id = '21000000-0000-4000-8000-000000000002'
  ),
  '01000000-0000-4000-8000-000000000012'::uuid,
  'executor could not reassign a foreign task'
);
select is(
  (
    select role
    from public.profiles
    where id = '01000000-0000-4000-8000-000000000011'
  ),
  'executor',
  'executor role escalation did not change stored data'
);
select is(
  (
    select comment
    from public.task_status_history
    where task_id = '21000000-0000-4000-8000-000000000001'
  ),
  null,
  'forbidden history changes did not alter stored data'
);
select is(
  (
    select status
    from public.tasks
    where id = '21000000-0000-4000-8000-000000000001'
  ),
  'new',
  'forbidden manager status update did not alter stored data'
);
select is(
  (
    select count(*)
    from public.tasks
    where title in (
      'Manager Assignee Task',
      'Deleted Project Task',
      'Forged Status Task',
      'Forged Creator Task',
      'Forged Time Task',
      'Forged Deletion Task',
      'Executor Created Task'
    )
  ),
  0::bigint,
  'all forbidden task inserts left no data'
);
select ok(
  exists (
    select 1
    from public.tasks
    where id = '21000000-0000-4000-8000-000000000002'
  )
  and exists (
    select 1
    from public.projects
    where id = '11000000-0000-4000-8000-000000000003'
  ),
  'forbidden physical deletes left task and project intact'
);
select ok(
  exists (
    select 1
    from public.tasks
    where title = 'Manager Task Updated'
      and deleted_at is not null
  )
  and exists (
    select 1
    from public.projects
    where name = 'Manager Project Updated'
      and deleted_at is not null
  ),
  'logical deletes persisted without physical deletion'
);

select * from finish();
rollback;
