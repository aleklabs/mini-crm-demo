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

select plan(53);

select ok(to_regclass('public.profiles') is not null, 'profiles table exists');
select ok(to_regclass('public.projects') is not null, 'projects table exists');
select ok(to_regclass('public.tasks') is not null, 'tasks table exists');
select ok(
  to_regclass('public.task_status_history') is not null,
  'task_status_history table exists'
);

with expected(table_name, column_name, udt_name) as (
  values
    ('profiles', 'id', 'uuid'),
    ('profiles', 'display_name', 'text'),
    ('profiles', 'role', 'text'),
    ('projects', 'id', 'uuid'),
    ('projects', 'name', 'text'),
    ('projects', 'address', 'text'),
    ('projects', 'deleted_at', 'timestamptz'),
    ('tasks', 'id', 'uuid'),
    ('tasks', 'project_id', 'uuid'),
    ('tasks', 'assignee_id', 'uuid'),
    ('tasks', 'created_by', 'uuid'),
    ('tasks', 'title', 'text'),
    ('tasks', 'description', 'text'),
    ('tasks', 'status', 'text'),
    ('tasks', 'created_at', 'timestamptz'),
    ('tasks', 'deleted_at', 'timestamptz'),
    ('task_status_history', 'id', 'uuid'),
    ('task_status_history', 'task_id', 'uuid'),
    ('task_status_history', 'actor_id', 'uuid'),
    ('task_status_history', 'from_status', 'text'),
    ('task_status_history', 'to_status', 'text'),
    ('task_status_history', 'comment', 'text'),
    ('task_status_history', 'created_at', 'timestamptz')
)
select is(
  (
    select count(*)::integer
    from expected e
    join information_schema.columns c
      on c.table_schema = 'public'
      and c.table_name = e.table_name
      and c.column_name = e.column_name
      and c.udt_name = e.udt_name
  ),
  23,
  'all required columns have the expected PostgreSQL types'
);

with expected(table_name, column_name) as (
  values
    ('profiles', 'id'),
    ('profiles', 'display_name'),
    ('profiles', 'role'),
    ('projects', 'id'),
    ('projects', 'name'),
    ('projects', 'address'),
    ('tasks', 'id'),
    ('tasks', 'project_id'),
    ('tasks', 'assignee_id'),
    ('tasks', 'created_by'),
    ('tasks', 'title'),
    ('tasks', 'description'),
    ('tasks', 'status'),
    ('tasks', 'created_at'),
    ('task_status_history', 'id'),
    ('task_status_history', 'task_id'),
    ('task_status_history', 'actor_id'),
    ('task_status_history', 'to_status'),
    ('task_status_history', 'created_at')
)
select is(
  (
    select count(*)::integer
    from expected e
    join information_schema.columns c
      on c.table_schema = 'public'
      and c.table_name = e.table_name
      and c.column_name = e.column_name
      and c.is_nullable = 'NO'
  ),
  19,
  'all mandatory columns are NOT NULL'
);

with expected(table_name, column_name) as (
  values
    ('projects', 'deleted_at'),
    ('tasks', 'deleted_at'),
    ('task_status_history', 'from_status'),
    ('task_status_history', 'comment')
)
select is(
  (
    select count(*)::integer
    from expected e
    join information_schema.columns c
      on c.table_schema = 'public'
      and c.table_name = e.table_name
      and c.column_name = e.column_name
      and c.is_nullable = 'YES'
  ),
  4,
  'only the specified business fields are nullable'
);

select is(
  (
    select count(*)::integer
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname in ('profiles', 'projects', 'tasks', 'task_status_history')
      and c.contype = 'p'
  ),
  4,
  'all CRM tables have primary keys'
);

with expected(
  child_table,
  child_column,
  parent_schema,
  parent_table,
  parent_column
) as (
  values
    ('profiles', 'id', 'auth', 'users', 'id'),
    ('tasks', 'project_id', 'public', 'projects', 'id'),
    ('tasks', 'assignee_id', 'public', 'profiles', 'id'),
    ('tasks', 'created_by', 'public', 'profiles', 'id'),
    ('task_status_history', 'task_id', 'public', 'tasks', 'id'),
    ('task_status_history', 'actor_id', 'public', 'profiles', 'id')
), actual as (
  select
    child.relname as child_table,
    child_column.attname as child_column,
    parent_namespace.nspname as parent_schema,
    parent.relname as parent_table,
    parent_column.attname as parent_column,
    c.confdeltype
  from pg_constraint c
  join pg_class child on child.oid = c.conrelid
  join pg_namespace child_namespace on child_namespace.oid = child.relnamespace
  join pg_attribute child_column
    on child_column.attrelid = child.oid
    and child_column.attnum = c.conkey[1]
  join pg_class parent on parent.oid = c.confrelid
  join pg_namespace parent_namespace on parent_namespace.oid = parent.relnamespace
  join pg_attribute parent_column
    on parent_column.attrelid = parent.oid
    and parent_column.attnum = c.confkey[1]
  where child_namespace.nspname = 'public'
    and c.contype = 'f'
)
select is(
  (
    select count(*)::integer
    from expected e
    join actual a using (
      child_table,
      child_column,
      parent_schema,
      parent_table,
      parent_column
    )
  ),
  6,
  'all foreign keys reference the expected parent columns'
);

select is(
  (
    select count(*)::integer
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname in ('profiles', 'tasks', 'task_status_history')
      and c.contype = 'f'
      and c.confdeltype = 'r'
  ),
  6,
  'all foreign keys use restrictive deletion'
);

select is(
  (
    select count(*)::integer
    from information_schema.columns
    where table_schema = 'public'
      and table_name in ('projects', 'tasks', 'task_status_history')
      and column_name = 'id'
      and column_default like '%gen_random_uuid()%'
  ),
  3,
  'generated business identifiers default to gen_random_uuid()'
);

select is(
  (
    select column_default
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'tasks'
      and column_name = 'status'
  ),
  '''new''::text',
  'task status defaults to new'
);

select is(
  (
    select count(*)::integer
    from information_schema.columns
    where table_schema = 'public'
      and table_name in ('tasks', 'task_status_history')
      and column_name = 'created_at'
      and column_default = 'now()'
  ),
  2,
  'created_at defaults to now()'
);

select is(
  (
    select count(*)::integer
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in ('profiles', 'projects', 'tasks', 'task_status_history')
      and c.relrowsecurity
  ),
  4,
  'RLS is enabled on all CRM tables'
);

select is(
  (
    select count(*)::integer
    from pg_policy p
    join pg_class c on c.oid = p.polrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in ('profiles', 'projects', 'tasks', 'task_status_history')
  ),
  8,
  'all expected access policies exist'
);

select is(
  (
    select count(*)::integer
    from pg_indexes
    where schemaname = 'public'
      and indexname in (
        'tasks_project_id_active_idx',
        'tasks_assignee_id_active_idx',
        'task_status_history_task_id_idx'
      )
  ),
  3,
  'expected query indexes exist'
);

select lives_ok(
  $sql$
    insert into auth.users (id, email)
    values
      ('00000000-0000-4000-8000-000000000001', 'manager@example.test'),
      ('00000000-0000-4000-8000-000000000002', 'executor@example.test'),
      ('00000000-0000-4000-8000-000000000003', 'invalid-role@example.test')
  $sql$,
  'isolated auth user fixtures can be created'
);

select lives_ok(
  $sql$
    insert into public.profiles (id, display_name, role)
    values
      ('00000000-0000-4000-8000-000000000001', 'Test Manager', 'manager'),
      ('00000000-0000-4000-8000-000000000002', 'Test Executor', 'executor')
  $sql$,
  'manager and executor roles are accepted'
);

select ok(
  pg_temp.command_fails_with_sqlstate(
    $sql$
      insert into public.profiles (id, display_name, role)
      values ('00000000-0000-4000-8000-000000000003', 'Invalid Role', 'admin')
    $sql$,
    '23514'
  ),
  'an invalid role is rejected on insert'
);

select ok(
  pg_temp.command_fails_with_sqlstate(
    $sql$
      update public.profiles
      set role = 'admin'
      where id = '00000000-0000-4000-8000-000000000001'
    $sql$,
    '23514'
  ),
  'an invalid role is rejected on update'
);

select ok(
  pg_temp.command_fails_with_sqlstate(
    $sql$
      insert into public.profiles (id, display_name, role)
      values ('00000000-0000-4000-8000-000000000003', '   ', 'executor')
    $sql$,
    '23514'
  ),
  'a blank display name is rejected'
);

select lives_ok(
  $sql$
    insert into public.projects (id, name, address)
    values (
      '10000000-0000-4000-8000-000000000001',
      'Test Project',
      'Test Address'
    )
  $sql$,
  'a valid project can be inserted'
);

select ok(
  pg_temp.command_fails_with_sqlstate(
    $sql$
      insert into public.projects (id, name, address)
      values (
        '10000000-0000-4000-8000-000000000001',
        'Duplicate Project',
        'Test Address'
      )
    $sql$,
    '23505'
  ),
  'a duplicate primary key is rejected'
);

select ok(
  pg_temp.command_fails_with_sqlstate(
    $sql$
      insert into public.projects (name, address)
      values ('  ', 'Test Address')
    $sql$,
    '23514'
  ),
  'a blank project name is rejected'
);

select lives_ok(
  $sql$
    insert into public.projects (name, address)
    values ('Generated Project', 'Generated Address')
  $sql$,
  'a project can use its generated identifier'
);

select ok(
  (
    select id is not null
    from public.projects
    where name = 'Generated Project'
  ),
  'gen_random_uuid() generates the project identifier'
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
      status
    )
    values
      (
        '20000000-0000-4000-8000-000000000001',
        '10000000-0000-4000-8000-000000000001',
        '00000000-0000-4000-8000-000000000002',
        '00000000-0000-4000-8000-000000000001',
        'New task',
        'Description',
        'new'
      ),
      (
        '20000000-0000-4000-8000-000000000002',
        '10000000-0000-4000-8000-000000000001',
        '00000000-0000-4000-8000-000000000002',
        '00000000-0000-4000-8000-000000000001',
        'In progress task',
        'Description',
        'in_progress'
      ),
      (
        '20000000-0000-4000-8000-000000000003',
        '10000000-0000-4000-8000-000000000001',
        '00000000-0000-4000-8000-000000000002',
        '00000000-0000-4000-8000-000000000001',
        'In review task',
        'Description',
        'in_review'
      ),
      (
        '20000000-0000-4000-8000-000000000004',
        '10000000-0000-4000-8000-000000000001',
        '00000000-0000-4000-8000-000000000002',
        '00000000-0000-4000-8000-000000000001',
        'Accepted task',
        'Description',
        'accepted'
      ),
      (
        '20000000-0000-4000-8000-000000000005',
        '10000000-0000-4000-8000-000000000001',
        '00000000-0000-4000-8000-000000000002',
        '00000000-0000-4000-8000-000000000001',
        'Rework task',
        'Description',
        'rework'
      )
  $sql$,
  'all five allowed task statuses are accepted'
);

select ok(
  pg_temp.command_fails_with_sqlstate(
    $sql$
      insert into public.tasks (
        project_id,
        assignee_id,
        created_by,
        title,
        description,
        status
      )
      values (
        '10000000-0000-4000-8000-000000000001',
        '00000000-0000-4000-8000-000000000002',
        '00000000-0000-4000-8000-000000000001',
        'Invalid status task',
        'Description',
        'closed'
      )
    $sql$,
    '23514'
  ),
  'an invalid task status is rejected on insert'
);

select ok(
  pg_temp.command_fails_with_sqlstate(
    $sql$
      update public.tasks
      set status = 'closed'
      where id = '20000000-0000-4000-8000-000000000001'
    $sql$,
    '23514'
  ),
  'an invalid task status is rejected on update'
);

select ok(
  pg_temp.command_fails_with_sqlstate(
    $sql$
      insert into public.tasks (
        project_id,
        assignee_id,
        created_by,
        title,
        description
      )
      values (
        '10000000-0000-4000-8000-000000000001',
        '00000000-0000-4000-8000-000000000002',
        '00000000-0000-4000-8000-000000000001',
        '   ',
        'Description'
      )
    $sql$,
    '23514'
  ),
  'a blank task title is rejected'
);

select lives_ok(
  $sql$
    insert into public.tasks (
      project_id,
      assignee_id,
      created_by,
      title,
      description
    )
    values (
      '10000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000002',
      '00000000-0000-4000-8000-000000000001',
      'Default task',
      'Description'
    )
  $sql$,
  'task defaults can be used'
);

select ok(
  (
    select id is not null and status = 'new' and created_at is not null
    from public.tasks
    where title = 'Default task'
  ),
  'task UUID, status and creation time defaults are applied'
);

select lives_ok(
  $sql$
    insert into public.task_status_history (
      id,
      task_id,
      actor_id,
      from_status,
      to_status,
      comment
    )
    values (
      '30000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000001',
      null,
      'in_progress',
      'Started work'
    )
  $sql$,
  'valid task history can be inserted'
);

select ok(
  pg_temp.command_fails_with_sqlstate(
    $sql$
      insert into public.task_status_history (
        task_id,
        actor_id,
        from_status,
        to_status
      )
      values (
        '20000000-0000-4000-8000-000000000001',
        '00000000-0000-4000-8000-000000000001',
        'closed',
        'accepted'
      )
    $sql$,
    '23514'
  ),
  'an invalid history from_status is rejected'
);

select ok(
  pg_temp.command_fails_with_sqlstate(
    $sql$
      insert into public.task_status_history (
        task_id,
        actor_id,
        from_status,
        to_status
      )
      values (
        '20000000-0000-4000-8000-000000000001',
        '00000000-0000-4000-8000-000000000001',
        'new',
        'closed'
      )
    $sql$,
    '23514'
  ),
  'an invalid history to_status is rejected'
);

select ok(
  pg_temp.command_fails_with_sqlstate(
    $sql$
      insert into public.profiles (id, display_name, role)
      values ('00000000-0000-4000-8000-000000000099', 'Missing User', 'executor')
    $sql$,
    '23503'
  ),
  'profiles reject a missing auth user foreign key'
);

select ok(
  pg_temp.command_fails_with_sqlstate(
    $sql$
      insert into public.tasks (
        project_id,
        assignee_id,
        created_by,
        title,
        description
      )
      values (
        '10000000-0000-4000-8000-000000000099',
        '00000000-0000-4000-8000-000000000002',
        '00000000-0000-4000-8000-000000000001',
        'Missing project',
        'Description'
      )
    $sql$,
    '23503'
  ),
  'tasks reject a missing project foreign key'
);

select ok(
  pg_temp.command_fails_with_sqlstate(
    $sql$
      insert into public.tasks (
        project_id,
        assignee_id,
        created_by,
        title,
        description
      )
      values (
        '10000000-0000-4000-8000-000000000001',
        '00000000-0000-4000-8000-000000000099',
        '00000000-0000-4000-8000-000000000001',
        'Missing assignee',
        'Description'
      )
    $sql$,
    '23503'
  ),
  'tasks reject a missing assignee foreign key'
);

select ok(
  pg_temp.command_fails_with_sqlstate(
    $sql$
      insert into public.tasks (
        project_id,
        assignee_id,
        created_by,
        title,
        description
      )
      values (
        '10000000-0000-4000-8000-000000000001',
        '00000000-0000-4000-8000-000000000002',
        '00000000-0000-4000-8000-000000000099',
        'Missing creator',
        'Description'
      )
    $sql$,
    '23503'
  ),
  'tasks reject a missing creator foreign key'
);

select ok(
  pg_temp.command_fails_with_sqlstate(
    $sql$
      insert into public.task_status_history (task_id, actor_id, to_status)
      values (
        '20000000-0000-4000-8000-000000000099',
        '00000000-0000-4000-8000-000000000001',
        'new'
      )
    $sql$,
    '23503'
  ),
  'history rejects a missing task foreign key'
);

select ok(
  pg_temp.command_fails_with_sqlstate(
    $sql$
      insert into public.task_status_history (task_id, actor_id, to_status)
      values (
        '20000000-0000-4000-8000-000000000001',
        '00000000-0000-4000-8000-000000000099',
        'new'
      )
    $sql$,
    '23503'
  ),
  'history rejects a missing actor foreign key'
);

select ok(
  pg_temp.command_fails_with_sqlstate(
    $sql$
      delete from public.tasks
      where id = '20000000-0000-4000-8000-000000000001'
    $sql$,
    '23503'
  ),
  'a task referenced by history cannot be physically deleted'
);

select is(
  (
    select count(*)
    from public.task_status_history
    where id = '30000000-0000-4000-8000-000000000001'
  ),
  1::bigint,
  'task history remains after a rejected parent deletion'
);

set local role anon;

select ok(
  pg_temp.command_fails_with_sqlstate(
    'select count(*) from public.profiles',
    '42501'
  ),
  'anon has no SELECT privilege on profiles'
);
select ok(
  pg_temp.command_fails_with_sqlstate(
    'select count(*) from public.projects',
    '42501'
  ),
  'anon has no SELECT privilege on projects'
);
select ok(
  pg_temp.command_fails_with_sqlstate(
    'select count(*) from public.tasks',
    '42501'
  ),
  'anon has no SELECT privilege on tasks'
);
select ok(
  pg_temp.command_fails_with_sqlstate(
    'select count(*) from public.task_status_history',
    '42501'
  ),
  'anon has no SELECT privilege on task history'
);
select ok(
  pg_temp.command_fails_with_sqlstate(
    $sql$
      insert into public.projects (name, address)
      values ('Anon Project', 'Address')
    $sql$,
    '42501'
  ),
  'anon cannot insert through RLS'
);

reset role;
set local role authenticated;

select is(
  (select count(*) from public.profiles),
  0::bigint,
  'authenticated cannot read profiles'
);
select is(
  (select count(*) from public.projects),
  0::bigint,
  'authenticated cannot read projects'
);
select is(
  (select count(*) from public.tasks),
  0::bigint,
  'authenticated cannot read tasks'
);
select is(
  (select count(*) from public.task_status_history),
  0::bigint,
  'authenticated cannot read task history'
);
select ok(
  pg_temp.command_fails_with_sqlstate(
    $sql$
      insert into public.projects (name, address)
      values ('Authenticated Project', 'Address')
    $sql$,
    '42501'
  ),
  'authenticated cannot insert through RLS'
);

reset role;

select * from finish();
rollback;
