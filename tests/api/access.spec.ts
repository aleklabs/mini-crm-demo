import { randomBytes, randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import type { TablesInsert } from '../../src/database.types.ts'
import {
  createTestClient,
  loadLocalSupabaseConfig,
  type LocalSupabaseConfig,
  type TestSupabaseClient,
} from '../helpers/localSupabase.ts'

type UserName = 'manager1' | 'manager2' | 'executor1' | 'executor2'
type CleanupTable = 'profiles' | 'projects' | 'tasks'

test.describe.serial('local Supabase Auth and CRM access', () => {
  const runId = randomBytes(8).toString('hex')
  const password = `Api-${randomBytes(18).toString('base64url')}!`
  const emails: Record<UserName, string> = {
    manager1: `stage3-${runId}-manager1@example.test`,
    manager2: `stage3-${runId}-manager2@example.test`,
    executor1: `stage3-${runId}-executor1@example.test`,
    executor2: `stage3-${runId}-executor2@example.test`,
  }
  const userIds: Record<UserName, string> = {
    manager1: '',
    manager2: '',
    executor1: '',
    executor2: '',
  }
  const projectIds = {
    executor1: randomUUID(),
    executor2: randomUUID(),
    unassigned: randomUUID(),
    deleted: randomUUID(),
  }
  const taskIds = {
    executor1: randomUUID(),
    executor2: randomUUID(),
    deleted: randomUUID(),
    deletedProject: randomUUID(),
  }
  const createdUserIds: string[] = []
  const createdProjectIds: string[] = Object.values(projectIds)
  const createdTaskIds: string[] = Object.values(taskIds)
  const userClients: Partial<Record<UserName, TestSupabaseClient>> = {}

  let localConfig: LocalSupabaseConfig
  let adminClient: TestSupabaseClient | undefined
  let publicClient: TestSupabaseClient
  let managerProjectId = ''
  let managerTaskId = ''

  const getUserClient = (name: UserName): TestSupabaseClient => {
    const client = userClients[name]
    if (!client) {
      throw new Error(`User client ${name} is not authenticated`)
    }
    return client
  }

  const transitionTask = (
    client: TestSupabaseClient,
    taskId: string,
    newStatus: string,
    comment: string | null = null,
  ) =>
    client.rpc('transition_task', {
      ...(comment === null ? {} : { p_comment: comment }),
      p_new_status: newStatus,
      p_task_id: taskId,
    })

  const cleanupFixtures = async (): Promise<void> => {
    if (!adminClient) {
      return
    }

    const unique = (values: string[]) => [...new Set(values.filter(Boolean))]
    const taskIdsForCleanup = unique(createdTaskIds)

    if (taskIdsForCleanup.length > 0) {
      const { error } = await adminClient
        .from('task_status_history')
        .delete()
        .in('task_id', taskIdsForCleanup)
      if (error) {
        throw new Error('Failed to clean API fixture history')
      }

      const { count, error: verificationError } = await adminClient
        .from('task_status_history')
        .select('id', { count: 'exact', head: true })
        .in('task_id', taskIdsForCleanup)
      if (verificationError || count !== 0) {
        throw new Error('API fixture history cleanup verification failed')
      }
    }

    const cleanupTables: Array<[CleanupTable, string[]]> = [
      ['tasks', taskIdsForCleanup],
      ['projects', unique(createdProjectIds)],
      ['profiles', unique(createdUserIds)],
    ]

    for (const [table, ids] of cleanupTables) {
      if (ids.length === 0) {
        continue
      }

      const { error } = await adminClient.from(table).delete().in('id', ids)
      if (error) {
        throw new Error(`Failed to clean API fixtures from ${table}`)
      }

      const { count, error: verificationError } = await adminClient
        .from(table)
        .select('id', { count: 'exact', head: true })
        .in('id', ids)
      if (verificationError || count !== 0) {
        throw new Error(`API fixture cleanup verification failed for ${table}`)
      }
    }

    for (const userId of unique(createdUserIds).reverse()) {
      const { error } = await adminClient.auth.admin.deleteUser(userId)
      if (error) {
        throw new Error('Failed to clean an API test user')
      }
    }

    createdTaskIds.length = 0
    createdProjectIds.length = 0
    createdUserIds.length = 0
  }

  test.beforeAll(async () => {
    localConfig = loadLocalSupabaseConfig()
    adminClient = createTestClient(localConfig.apiUrl, localConfig.secretKey)
    publicClient = createTestClient(
      localConfig.apiUrl,
      localConfig.publishableKey,
    )

    try {
      const names: UserName[] = [
        'manager1',
        'manager2',
        'executor1',
        'executor2',
      ]

      for (const name of names) {
        const { data, error } = await adminClient.auth.admin.createUser({
          email: emails[name],
          email_confirm: true,
          password,
        })
        if (error || !data.user) {
          throw new Error(`Failed to create API user ${name}`)
        }
        userIds[name] = data.user.id
        createdUserIds.push(data.user.id)
      }

      const { error: profilesError } = await adminClient
        .from('profiles')
        .insert([
          {
            id: userIds.manager1,
            display_name: 'API Manager One',
            role: 'manager',
          },
          {
            id: userIds.manager2,
            display_name: 'API Manager Two',
            role: 'manager',
          },
          {
            id: userIds.executor1,
            display_name: 'API Executor One',
            role: 'executor',
          },
          {
            id: userIds.executor2,
            display_name: 'API Executor Two',
            role: 'executor',
          },
        ])
      if (profilesError) {
        throw new Error('Failed to create API profile fixtures')
      }

      const { error: projectsError } = await adminClient
        .from('projects')
        .insert([
          {
            id: projectIds.executor1,
            name: 'API Executor One Project',
            address: 'API Address One',
          },
          {
            id: projectIds.executor2,
            name: 'API Executor Two Project',
            address: 'API Address Two',
          },
          {
            id: projectIds.unassigned,
            name: 'API Unassigned Project',
            address: 'API Address Three',
          },
          {
            id: projectIds.deleted,
            name: 'API Deleted Project',
            address: 'API Address Four',
            deleted_at: new Date().toISOString(),
          },
        ])
      if (projectsError) {
        throw new Error('Failed to create API project fixtures')
      }

      const { error: tasksError } = await adminClient.from('tasks').insert([
        {
          id: taskIds.executor1,
          project_id: projectIds.executor1,
          assignee_id: userIds.executor1,
          created_by: userIds.manager1,
          title: 'API Executor One Task',
          description: 'API Description One',
        },
        {
          id: taskIds.executor2,
          project_id: projectIds.executor2,
          assignee_id: userIds.executor2,
          created_by: userIds.manager2,
          title: 'API Executor Two Task',
          description: 'API Description Two',
        },
        {
          id: taskIds.deleted,
          project_id: projectIds.executor1,
          assignee_id: userIds.executor1,
          created_by: userIds.manager1,
          title: 'API Deleted Task',
          description: 'API Deleted Description',
          deleted_at: new Date().toISOString(),
        },
        {
          id: taskIds.deletedProject,
          project_id: projectIds.deleted,
          assignee_id: userIds.executor1,
          created_by: userIds.manager1,
          title: 'API Task In Deleted Project',
          description: 'API Hidden Description',
        },
      ])
      if (tasksError) {
        throw new Error('Failed to create API task fixtures')
      }

    } catch (error) {
      try {
        await cleanupFixtures()
      } catch {
        // The original setup error is more useful; afterAll retries cleanup.
      }
      throw error
    }
  })

  test.afterAll(async () => {
    await cleanupFixtures()
  })

  test('authenticates all four users with password', async () => {
    const names: UserName[] = [
      'manager1',
      'manager2',
      'executor1',
      'executor2',
    ]

    for (const name of names) {
      const client = createTestClient(
        localConfig.apiUrl,
        localConfig.publishableKey,
      )
      const { data, error } = await client.auth.signInWithPassword({
        email: emails[name],
        password,
      })
      expect(error).toBeNull()
      expect(data.user?.id).toBe(userIds[name])
      expect(data.session?.access_token).toBeTruthy()
      userClients[name] = client
    }
  })

  test('rejects a wrong password and public registration', async () => {
    const wrongPasswordClient = createTestClient(
      localConfig.apiUrl,
      localConfig.publishableKey,
    )
    const { data: loginData, error: loginError } =
      await wrongPasswordClient.auth.signInWithPassword({
        email: emails.manager1,
        password: `${password}-wrong`,
      })
    expect(loginError).not.toBeNull()
    expect(loginData.session).toBeNull()

    const { data: signupData, error: signupError } =
      await publicClient.auth.signUp({
        email: `stage3-${runId}-signup@example.test`,
        password,
      })
    if (signupData.user) {
      createdUserIds.push(signupData.user.id)
    }
    expect(signupError).not.toBeNull()
    expect(signupData.session).toBeNull()
  })

  test('denies anonymous CRM access', async () => {
    const { data, error } = await publicClient.from('projects').select('id')
    expect(error).not.toBeNull()
    expect(data).toBeNull()
  })

  test('both managers read all active CRM data', async () => {
    for (const name of ['manager1', 'manager2'] as const) {
      const client = getUserClient(name)
      const profiles = await client.from('profiles').select('id')
      const projects = await client.from('projects').select('id')
      const tasks = await client.from('tasks').select('id')
      const history = await client
        .from('task_status_history')
        .select('task_id')

      expect(profiles.error).toBeNull()
      expect(profiles.data).toHaveLength(4)
      expect(projects.error).toBeNull()
      expect(projects.data?.map(({ id }) => id).sort()).toEqual(
        [projectIds.executor1, projectIds.executor2, projectIds.unassigned].sort(),
      )
      expect(tasks.error).toBeNull()
      expect(tasks.data?.map(({ id }) => id).sort()).toEqual(
        [taskIds.executor1, taskIds.executor2].sort(),
      )
      expect(history.error).toBeNull()
      expect(history.data?.map(({ task_id }) => task_id).sort()).toEqual(
        [taskIds.executor1, taskIds.executor2].sort(),
      )
    }
  })

  test('manager creates, edits and logically deletes a project', async () => {
    const manager = getUserClient('manager1')
    const created = await manager
      .from('projects')
      .insert({ name: 'API Manager Project', address: 'API Manager Address' })
      .select('id, name, address, deleted_at')
      .single()
    expect(created.error).toBeNull()
    expect(created.data?.id).toBeTruthy()
    expect(created.data?.deleted_at).toBeNull()
    if (!created.data) {
      throw new Error('Manager project was not returned')
    }
    managerProjectId = created.data.id
    createdProjectIds.push(managerProjectId)

    const updated = await manager
      .from('projects')
      .update({
        address: 'API Manager Address Updated',
        name: 'API Manager Project Updated',
      })
      .eq('id', managerProjectId)
      .select('name, address')
      .single()
    expect(updated.error).toBeNull()
    expect(updated.data).toEqual({
      address: 'API Manager Address Updated',
      name: 'API Manager Project Updated',
    })

    const deletedAt = new Date().toISOString()
    const deletion = await manager
      .from('projects')
      .update({ deleted_at: deletedAt })
      .eq('id', managerProjectId)
    expect(deletion.error).toBeNull()

    const managerView = await manager
      .from('projects')
      .select('id')
      .eq('id', managerProjectId)
    expect(managerView.error).toBeNull()
    expect(managerView.data).toEqual([])

    const adminState = await adminClient!
      .from('projects')
      .select('deleted_at')
      .eq('id', managerProjectId)
      .single()
    expect(adminState.error).toBeNull()
    expect(new Date(adminState.data?.deleted_at ?? '').getTime()).toBe(
      new Date(deletedAt).getTime(),
    )
  })

  test('manager creates and edits a task with protected defaults', async () => {
    const manager = getUserClient('manager1')
    const created = await manager
      .from('tasks')
      .insert({
        assignee_id: userIds.executor1,
        description: 'API Manager Task Description',
        project_id: projectIds.executor1,
        title: 'API Manager Task',
      })
      .select('id, status, created_by, created_at, deleted_at')
      .single()
    expect(created.error).toBeNull()
    expect(created.data?.id).toBeTruthy()
    expect(created.data?.status).toBe('new')
    expect(created.data?.created_by).toBe(userIds.manager1)
    expect(created.data?.created_at).toBeTruthy()
    expect(created.data?.deleted_at).toBeNull()
    if (!created.data) {
      throw new Error('Manager task was not returned')
    }
    managerTaskId = created.data.id
    createdTaskIds.push(managerTaskId)

    const updated = await manager
      .from('tasks')
      .update({
        assignee_id: userIds.executor2,
        description: 'API Manager Task Description Updated',
        project_id: projectIds.executor2,
        title: 'API Manager Task Updated',
      })
      .eq('id', managerTaskId)
      .select('project_id, assignee_id, title, description')
      .single()
    expect(updated.error).toBeNull()
    expect(updated.data).toEqual({
      assignee_id: userIds.executor2,
      description: 'API Manager Task Description Updated',
      project_id: projectIds.executor2,
      title: 'API Manager Task Updated',
    })
  })

  test('manager cannot forge protected task fields or assignee role', async () => {
    const manager = getUserClient('manager1')
    const forbiddenInserts: Array<TablesInsert<'tasks'>> = [
      {
        assignee_id: userIds.manager2,
        description: 'Description',
        project_id: projectIds.executor1,
        title: `forbidden-manager-${runId}`,
      },
      {
        assignee_id: userIds.executor1,
        description: 'Description',
        project_id: projectIds.executor1,
        status: 'accepted',
        title: `forbidden-status-${runId}`,
      },
      {
        assignee_id: userIds.executor1,
        created_by: userIds.manager2,
        description: 'Description',
        project_id: projectIds.executor1,
        title: `forbidden-creator-${runId}`,
      },
      {
        assignee_id: userIds.executor1,
        created_at: '2000-01-01T00:00:00.000Z',
        description: 'Description',
        project_id: projectIds.executor1,
        title: `forbidden-time-${runId}`,
      },
      {
        assignee_id: userIds.executor1,
        description: 'Description',
        project_id: projectIds.deleted,
        title: `forbidden-project-${runId}`,
      },
    ]

    for (const payload of forbiddenInserts) {
      const { error } = await manager.from('tasks').insert(payload)
      expect(error).not.toBeNull()
    }

    const statusUpdate = await manager
      .from('tasks')
      .update({ status: 'accepted' })
      .eq('id', taskIds.executor1)
    const creatorUpdate = await manager
      .from('tasks')
      .update({ created_by: userIds.manager2 })
      .eq('id', taskIds.executor1)
    const timeUpdate = await manager
      .from('tasks')
      .update({ created_at: '2000-01-01T00:00:00.000Z' })
      .eq('id', taskIds.executor1)
    const managerAssigneeUpdate = await manager
      .from('tasks')
      .update({ assignee_id: userIds.manager2 })
      .eq('id', managerTaskId)

    expect(statusUpdate.error).not.toBeNull()
    expect(creatorUpdate.error).not.toBeNull()
    expect(timeUpdate.error).not.toBeNull()
    expect(managerAssigneeUpdate.error).not.toBeNull()

    const forbiddenState = await adminClient!
      .from('tasks')
      .select('id', { count: 'exact' })
      .in(
        'title',
        forbiddenInserts.map(({ title }) => title),
      )
    expect(forbiddenState.error).toBeNull()
    expect(forbiddenState.count).toBe(0)

    const baseTask = await adminClient!
      .from('tasks')
      .select('status, created_by, created_at')
      .eq('id', taskIds.executor1)
      .single()
    expect(baseTask.data?.status).toBe('new')
    expect(baseTask.data?.created_by).toBe(userIds.manager1)
    expect(baseTask.data?.created_at).not.toBe('2000-01-01T00:00:00+00:00')

    const managerTask = await adminClient!
      .from('tasks')
      .select('assignee_id')
      .eq('id', managerTaskId)
      .single()
    expect(managerTask.data?.assignee_id).toBe(userIds.executor2)
  })

  test('manager cannot mutate profiles, history or physically delete data', async () => {
    const manager = getUserClient('manager1')
    const roleUpdate = await manager
      .from('profiles')
      .update({ role: 'manager' })
      .eq('id', userIds.executor1)
    const profileInsert = await manager.from('profiles').insert({
      display_name: 'Injected Profile',
      id: randomUUID(),
      role: 'manager',
    })
    const historyInsert = await manager.from('task_status_history').insert({
      actor_id: userIds.manager1,
      task_id: taskIds.executor1,
      to_status: 'accepted',
    })
    const historyUpdate = await manager
      .from('task_status_history')
      .update({ comment: 'Forged' })
      .eq('task_id', taskIds.executor1)
    const historyDelete = await manager
      .from('task_status_history')
      .delete()
      .eq('task_id', taskIds.executor1)
    const taskDelete = await manager
      .from('tasks')
      .delete()
      .eq('id', taskIds.executor2)
    const projectDelete = await manager
      .from('projects')
      .delete()
      .eq('id', projectIds.unassigned)

    for (const result of [
      roleUpdate,
      profileInsert,
      historyInsert,
      historyUpdate,
      historyDelete,
      taskDelete,
      projectDelete,
    ]) {
      expect(result.error).not.toBeNull()
    }

    const profileState = await adminClient!
      .from('profiles')
      .select('role')
      .eq('id', userIds.executor1)
      .single()
    const historyState = await adminClient!
      .from('task_status_history')
      .select('comment')
      .eq('task_id', taskIds.executor1)
      .single()
    const taskState = await adminClient!
      .from('tasks')
      .select('id')
      .eq('id', taskIds.executor2)
      .single()
    const projectState = await adminClient!
      .from('projects')
      .select('id')
      .eq('id', projectIds.unassigned)
      .single()
    expect(profileState.data?.role).toBe('executor')
    expect(historyState.data?.comment).toBeNull()
    expect(taskState.data?.id).toBe(taskIds.executor2)
    expect(projectState.data?.id).toBe(projectIds.unassigned)
  })

  test('manager logically deletes a task', async () => {
    const manager = getUserClient('manager1')
    const deletedAt = new Date().toISOString()
    const deletion = await manager
      .from('tasks')
      .update({ deleted_at: deletedAt })
      .eq('id', managerTaskId)
    expect(deletion.error).toBeNull()

    const managerView = await manager
      .from('tasks')
      .select('id')
      .eq('id', managerTaskId)
    expect(managerView.error).toBeNull()
    expect(managerView.data).toEqual([])

    const adminState = await adminClient!
      .from('tasks')
      .select('deleted_at')
      .eq('id', managerTaskId)
      .single()
    expect(adminState.error).toBeNull()
    expect(new Date(adminState.data?.deleted_at ?? '').getTime()).toBe(
      new Date(deletedAt).getTime(),
    )
  })

  test('executors read only their own active scope', async () => {
    const expectations: Array<{
      name: 'executor1' | 'executor2'
      profileId: string
      projectId: string
      taskId: string
    }> = [
      {
        name: 'executor1',
        profileId: userIds.executor1,
        projectId: projectIds.executor1,
        taskId: taskIds.executor1,
      },
      {
        name: 'executor2',
        profileId: userIds.executor2,
        projectId: projectIds.executor2,
        taskId: taskIds.executor2,
      },
    ]

    for (const expected of expectations) {
      const client = getUserClient(expected.name)
      const profiles = await client.from('profiles').select('id')
      const projects = await client.from('projects').select('id')
      const tasks = await client.from('tasks').select('id')
      const history = await client
        .from('task_status_history')
        .select('task_id')

      expect(profiles.error).toBeNull()
      expect(profiles.data?.map(({ id }) => id)).toEqual([expected.profileId])
      expect(projects.error).toBeNull()
      expect(projects.data?.map(({ id }) => id)).toEqual([expected.projectId])
      expect(tasks.error).toBeNull()
      expect(tasks.data?.map(({ id }) => id)).toEqual([expected.taskId])
      expect(history.error).toBeNull()
      expect(history.data?.map(({ task_id }) => task_id)).toEqual([
        expected.taskId,
      ])
    }

    const foreignTask = await getUserClient('executor1')
      .from('tasks')
      .select('id')
      .eq('id', taskIds.executor2)
    expect(foreignTask.error).toBeNull()
    expect(foreignTask.data).toEqual([])
  })

  test('executor writes are denied and stored data stays unchanged', async () => {
    const executor = getUserClient('executor1')
    const projectInsert = await executor
      .from('projects')
      .insert({ name: 'Executor Project', address: 'Executor Address' })
    const taskInsert = await executor.from('tasks').insert({
      assignee_id: userIds.executor1,
      description: 'Executor Description',
      project_id: projectIds.executor1,
      title: 'Executor Task',
    })
    expect(projectInsert.error).not.toBeNull()
    expect(taskInsert.error).not.toBeNull()

    const projectUpdate = await executor
      .from('projects')
      .update({ name: 'Executor Changed Project' })
      .eq('id', projectIds.executor1)
      .select('id')
    expect(projectUpdate.error).toBeNull()
    expect(projectUpdate.data).toEqual([])

    const ownTaskUpdate = await executor
      .from('tasks')
      .update({ title: 'Executor Changed Own Task' })
      .eq('id', taskIds.executor1)
      .select('id')
    const foreignTaskUpdate = await executor
      .from('tasks')
      .update({ title: 'Executor Changed Foreign Task' })
      .eq('id', taskIds.executor2)
      .select('id')
    const foreignAssigneeUpdate = await executor
      .from('tasks')
      .update({ assignee_id: userIds.executor1 })
      .eq('id', taskIds.executor2)
      .select('id')
    expect(ownTaskUpdate.error).toBeNull()
    expect(ownTaskUpdate.data).toEqual([])
    expect(foreignTaskUpdate.error).toBeNull()
    expect(foreignTaskUpdate.data).toEqual([])
    expect(foreignAssigneeUpdate.error).toBeNull()
    expect(foreignAssigneeUpdate.data).toEqual([])

    const roleUpdate = await executor
      .from('profiles')
      .update({ role: 'manager' })
      .eq('id', userIds.executor1)
    const historyInsert = await executor.from('task_status_history').insert({
      actor_id: userIds.executor1,
      task_id: taskIds.executor1,
      to_status: 'accepted',
    })
    const historyUpdate = await executor
      .from('task_status_history')
      .update({ comment: 'Executor Forged' })
      .eq('task_id', taskIds.executor1)
    const historyDelete = await executor
      .from('task_status_history')
      .delete()
      .eq('task_id', taskIds.executor1)
    const physicalDelete = await executor
      .from('tasks')
      .delete()
      .eq('id', taskIds.executor1)

    for (const result of [
      roleUpdate,
      historyInsert,
      historyUpdate,
      historyDelete,
      physicalDelete,
    ]) {
      expect(result.error).not.toBeNull()
    }

    const ownTaskState = await adminClient!
      .from('tasks')
      .select('title')
      .eq('id', taskIds.executor1)
      .single()
    const foreignTaskState = await adminClient!
      .from('tasks')
      .select('title, assignee_id')
      .eq('id', taskIds.executor2)
      .single()
    const profileState = await adminClient!
      .from('profiles')
      .select('role')
      .eq('id', userIds.executor1)
      .single()
    const projectState = await adminClient!
      .from('projects')
      .select('name')
      .eq('id', projectIds.executor1)
      .single()
    const historyState = await adminClient!
      .from('task_status_history')
      .select('comment')
      .eq('task_id', taskIds.executor1)
      .single()

    expect(ownTaskState.data?.title).toBe('API Executor One Task')
    expect(foreignTaskState.data).toEqual({
      assignee_id: userIds.executor2,
      title: 'API Executor Two Task',
    })
    expect(profileState.data?.role).toBe('executor')
    expect(projectState.data?.name).toBe('API Executor One Project')
    expect(historyState.data?.comment).toBeNull()
  })

  test('runs the complete task status lifecycle and records seven events', async () => {
    const manager = getUserClient('manager1')
    const executor = getUserClient('executor1')
    const created = await manager
      .from('tasks')
      .insert({
        assignee_id: userIds.executor1,
        description: 'Stage Four Lifecycle Description',
        project_id: projectIds.executor1,
        title: `stage4-lifecycle-${runId}`,
      })
      .select('id, status')
      .single()
    expect(created.error).toBeNull()
    expect(created.data?.status).toBe('new')
    if (!created.data) {
      throw new Error('Lifecycle task was not returned')
    }
    const lifecycleTaskId = created.data.id
    createdTaskIds.push(lifecycleTaskId)

    const initialHistory = await manager
      .from('task_status_history')
      .select('actor_id, from_status, to_status, comment')
      .eq('task_id', lifecycleTaskId)
      .single()
    expect(initialHistory.error).toBeNull()
    expect(initialHistory.data).toEqual({
      actor_id: userIds.manager1,
      comment: null,
      from_status: null,
      to_status: 'new',
    })

    const transitions: Array<{
      client: TestSupabaseClient
      comment: string | null
      status: string
    }> = [
      { client: executor, comment: null, status: 'in_progress' },
      { client: executor, comment: null, status: 'in_review' },
      { client: manager, comment: 'Needs correction', status: 'rework' },
      { client: executor, comment: null, status: 'in_progress' },
      { client: executor, comment: null, status: 'in_review' },
      { client: manager, comment: null, status: 'accepted' },
    ]

    for (const transition of transitions) {
      const { error } = await transitionTask(
        transition.client,
        lifecycleTaskId,
        transition.status,
        transition.comment,
      )
      expect(error).toBeNull()
    }

    const history = await manager
      .from('task_status_history')
      .select('actor_id, from_status, to_status, comment')
      .eq('task_id', lifecycleTaskId)
      .order('created_at', { ascending: true })
    expect(history.error).toBeNull()
    expect(history.data).toEqual([
      {
        actor_id: userIds.manager1,
        comment: null,
        from_status: null,
        to_status: 'new',
      },
      {
        actor_id: userIds.executor1,
        comment: null,
        from_status: 'new',
        to_status: 'in_progress',
      },
      {
        actor_id: userIds.executor1,
        comment: null,
        from_status: 'in_progress',
        to_status: 'in_review',
      },
      {
        actor_id: userIds.manager1,
        comment: 'Needs correction',
        from_status: 'in_review',
        to_status: 'rework',
      },
      {
        actor_id: userIds.executor1,
        comment: null,
        from_status: 'rework',
        to_status: 'in_progress',
      },
      {
        actor_id: userIds.executor1,
        comment: null,
        from_status: 'in_progress',
        to_status: 'in_review',
      },
      {
        actor_id: userIds.manager1,
        comment: null,
        from_status: 'in_review',
        to_status: 'accepted',
      },
    ])

    const terminalAttempt = await transitionTask(
      manager,
      lifecycleTaskId,
      'rework',
      'Cannot reopen an accepted task',
    )
    expect(terminalAttempt.error).not.toBeNull()

    const finalTask = await adminClient!
      .from('tasks')
      .select('status')
      .eq('id', lifecycleTaskId)
      .single()
    const finalHistory = await adminClient!
      .from('task_status_history')
      .select('id', { count: 'exact' })
      .eq('task_id', lifecycleTaskId)
    expect(finalTask.data?.status).toBe('accepted')
    expect(finalHistory.count).toBe(7)
  })

  test('rejects invalid RPC transitions without changing stored state', async () => {
    const manager = getUserClient('manager1')
    const executor1 = getUserClient('executor1')
    const executor2 = getUserClient('executor2')

    const baseFailures = [
      transitionTask(manager, taskIds.executor1, 'in_progress'),
      transitionTask(executor2, taskIds.executor1, 'in_progress'),
      transitionTask(executor1, taskIds.executor1, 'accepted'),
      transitionTask(executor1, taskIds.executor1, 'new'),
      transitionTask(executor1, taskIds.executor1, 'closed'),
      transitionTask(executor1, taskIds.deleted, 'in_progress'),
      transitionTask(executor1, taskIds.deletedProject, 'in_progress'),
      transitionTask(executor1, randomUUID(), 'in_progress'),
    ]

    for (const failure of await Promise.all(baseFailures)) {
      expect(failure.error).not.toBeNull()
    }

    const created = await manager
      .from('tasks')
      .insert({
        assignee_id: userIds.executor1,
        description: 'Stage Four Negative Description',
        project_id: projectIds.executor1,
        title: `stage4-negative-${runId}`,
      })
      .select('id')
      .single()
    expect(created.error).toBeNull()
    if (!created.data) {
      throw new Error('Negative transition task was not returned')
    }
    const negativeTaskId = created.data.id
    createdTaskIds.push(negativeTaskId)

    for (const status of ['in_progress', 'in_review']) {
      const { error } = await transitionTask(
        executor1,
        negativeTaskId,
        status,
      )
      expect(error).toBeNull()
    }

    const reviewFailures = [
      transitionTask(executor1, negativeTaskId, 'accepted'),
      transitionTask(
        executor1,
        negativeTaskId,
        'rework',
        'Executor cannot return this task',
      ),
      transitionTask(manager, negativeTaskId, 'rework'),
      transitionTask(manager, negativeTaskId, 'rework', ''),
      transitionTask(manager, negativeTaskId, 'rework', '   '),
    ]

    for (const failure of await Promise.all(reviewFailures)) {
      expect(failure.error).not.toBeNull()
    }

    const taskState = await adminClient!
      .from('tasks')
      .select('id, status')
      .in('id', [
        taskIds.executor1,
        taskIds.deleted,
        taskIds.deletedProject,
        negativeTaskId,
      ])
    expect(taskState.error).toBeNull()
    expect(
      Object.fromEntries(
        taskState.data?.map(({ id, status }) => [id, status]) ?? [],
      ),
    ).toEqual({
      [negativeTaskId]: 'in_review',
      [taskIds.deleted]: 'new',
      [taskIds.deletedProject]: 'new',
      [taskIds.executor1]: 'new',
    })

    const historyState = await adminClient!
      .from('task_status_history')
      .select('task_id')
      .in('task_id', [
        taskIds.executor1,
        taskIds.deleted,
        taskIds.deletedProject,
        negativeTaskId,
      ])
    expect(historyState.error).toBeNull()
    const historyCounts = (historyState.data ?? []).reduce<
      Record<string, number>
    >((counts, { task_id }) => {
      counts[task_id] = (counts[task_id] ?? 0) + 1
      return counts
    }, {})
    expect(historyCounts).toEqual({
      [negativeTaskId]: 3,
      [taskIds.deleted]: 1,
      [taskIds.deletedProject]: 1,
      [taskIds.executor1]: 1,
    })
  })

  test('serializes concurrent manager transitions from in_review', async () => {
    const manager1 = getUserClient('manager1')
    const manager2 = getUserClient('manager2')
    const executor = getUserClient('executor1')
    const created = await manager1
      .from('tasks')
      .insert({
        assignee_id: userIds.executor1,
        description: 'Stage Four Concurrent Description',
        project_id: projectIds.executor1,
        title: `stage4-concurrent-${runId}`,
      })
      .select('id')
      .single()
    expect(created.error).toBeNull()
    if (!created.data) {
      throw new Error('Concurrent transition task was not returned')
    }
    const concurrentTaskId = created.data.id
    createdTaskIds.push(concurrentTaskId)

    for (const status of ['in_progress', 'in_review']) {
      const { error } = await transitionTask(
        executor,
        concurrentTaskId,
        status,
      )
      expect(error).toBeNull()
    }

    const results = await Promise.all([
      transitionTask(manager1, concurrentTaskId, 'accepted'),
      transitionTask(
        manager2,
        concurrentTaskId,
        'rework',
        'Concurrent rework',
      ),
    ])
    expect(results.filter(({ error }) => error === null)).toHaveLength(1)
    expect(results.filter(({ error }) => error !== null)).toHaveLength(1)

    const acceptedWon = results[0].error === null
    const expectedStatus = acceptedWon ? 'accepted' : 'rework'
    const taskState = await adminClient!
      .from('tasks')
      .select('status')
      .eq('id', concurrentTaskId)
      .single()
    expect(taskState.error).toBeNull()
    expect(taskState.data?.status).toBe(expectedStatus)

    const history = await adminClient!
      .from('task_status_history')
      .select('actor_id, from_status, to_status, comment')
      .eq('task_id', concurrentTaskId)
    expect(history.error).toBeNull()
    expect(history.data).toHaveLength(4)
    const managerEvents =
      history.data?.filter(({ from_status }) => from_status === 'in_review') ?? []
    expect(managerEvents).toEqual([
      acceptedWon
        ? {
            actor_id: userIds.manager1,
            comment: null,
            from_status: 'in_review',
            to_status: 'accepted',
          }
        : {
            actor_id: userIds.manager2,
            comment: 'Concurrent rework',
            from_status: 'in_review',
            to_status: 'rework',
          },
    ])
  })
})
