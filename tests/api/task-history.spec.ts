import { randomBytes, randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import {
  createTestClient,
  loadLocalSupabaseConfig,
  type TestSupabaseClient,
} from '../helpers/localSupabase.ts'

type UserName = 'manager' | 'executor1' | 'executor2'

test.describe.serial('task history RPC API', () => {
  const runId = randomBytes(8).toString('hex')
  const password = `Api8-${randomBytes(18).toString('base64url')}!`
  const emails: Record<UserName, string> = {
    executor1: `stage8-${runId}-executor1@example.test`,
    executor2: `stage8-${runId}-executor2@example.test`,
    manager: `stage8-${runId}-manager@example.test`,
  }
  const names = {
    executor1: `API8 Executor One ${runId}`,
    executor2: `API8 Executor Two ${runId}`,
    manager: `API8 Manager ${runId}`,
  }
  const userIds: Record<UserName, string> = {
    executor1: '',
    executor2: '',
    manager: '',
  }
  const projectIds = {
    active: randomUUID(),
    deleted: randomUUID(),
  }
  const taskIds = {
    deleted: randomUUID(),
    deletedProject: randomUUID(),
    lifecycle: randomUUID(),
    reassigned: randomUUID(),
  }
  const createdUserIds: string[] = []
  let adminClient: TestSupabaseClient | undefined
  const clients: Partial<Record<UserName, TestSupabaseClient>> = {}

  const client = (name: UserName) => {
    const value = clients[name]
    if (!value) {
      throw new Error(`Stage 8 API client ${name} is unavailable`)
    }
    return value
  }

  const cleanup = async () => {
    if (!adminClient) {
      return
    }

    const ownTaskIds = Object.values(taskIds)
    const historyDelete = await adminClient
      .from('task_status_history')
      .delete()
      .in('task_id', ownTaskIds)
    if (historyDelete.error) {
      throw new Error('Failed to clean Stage 8 API history')
    }
    const taskDelete = await adminClient
      .from('tasks')
      .delete()
      .in('id', ownTaskIds)
    if (taskDelete.error) {
      throw new Error('Failed to clean Stage 8 API tasks')
    }
    const projectDelete = await adminClient
      .from('projects')
      .delete()
      .in('id', Object.values(projectIds))
    if (projectDelete.error) {
      throw new Error('Failed to clean Stage 8 API projects')
    }
    if (createdUserIds.length > 0) {
      const profileDelete = await adminClient
        .from('profiles')
        .delete()
        .in('id', createdUserIds)
      if (profileDelete.error) {
        throw new Error('Failed to clean Stage 8 API profiles')
      }
    }
    for (const userId of [...createdUserIds].reverse()) {
      const deletion = await adminClient.auth.admin.deleteUser(userId)
      if (deletion.error) {
        throw new Error('Failed to clean a Stage 8 API auth user')
      }
    }
    createdUserIds.length = 0

    const [history, tasks, projects] = await Promise.all([
      adminClient
        .from('task_status_history')
        .select('id', { count: 'exact', head: true })
        .in('task_id', ownTaskIds),
      adminClient
        .from('tasks')
        .select('id', { count: 'exact', head: true })
        .in('id', ownTaskIds),
      adminClient
        .from('projects')
        .select('id', { count: 'exact', head: true })
        .in('id', Object.values(projectIds)),
    ])
    if (
      history.error ||
      history.count !== 0 ||
      tasks.error ||
      tasks.count !== 0 ||
      projects.error ||
      projects.count !== 0
    ) {
      throw new Error('Stage 8 API cleanup verification failed')
    }
  }

  test.beforeAll(async () => {
    const config = loadLocalSupabaseConfig()
    adminClient = createTestClient(config.apiUrl, config.secretKey)

    try {
      for (const name of ['manager', 'executor1', 'executor2'] as const) {
        const created = await adminClient.auth.admin.createUser({
          email: emails[name],
          email_confirm: true,
          password,
        })
        if (created.error || !created.data.user) {
          throw new Error(`Failed to create Stage 8 API user ${name}`)
        }
        userIds[name] = created.data.user.id
        createdUserIds.push(created.data.user.id)

        const userClient = createTestClient(
          config.apiUrl,
          config.publishableKey,
        )
        const signIn = await userClient.auth.signInWithPassword({
          email: emails[name],
          password,
        })
        if (signIn.error) {
          throw new Error(`Failed to authenticate Stage 8 API user ${name}`)
        }
        clients[name] = userClient
      }

      const profiles = await adminClient.from('profiles').insert([
        { display_name: names.manager, id: userIds.manager, role: 'manager' },
        {
          display_name: names.executor1,
          id: userIds.executor1,
          role: 'executor',
        },
        {
          display_name: names.executor2,
          id: userIds.executor2,
          role: 'executor',
        },
      ])
      if (profiles.error) {
        throw new Error('Failed to create Stage 8 API profiles')
      }

      const projects = await adminClient.from('projects').insert([
        {
          address: `API8 address ${runId}`,
          id: projectIds.active,
          name: `API8 active ${runId}`,
        },
        {
          address: `API8 deleted address ${runId}`,
          deleted_at: new Date().toISOString(),
          id: projectIds.deleted,
          name: `API8 deleted ${runId}`,
        },
      ])
      if (projects.error) {
        throw new Error('Failed to create Stage 8 API projects')
      }

      const tasks = await adminClient.from('tasks').insert([
        {
          assignee_id: userIds.executor1,
          created_by: userIds.manager,
          description: `API8 lifecycle description ${runId}`,
          id: taskIds.lifecycle,
          project_id: projectIds.active,
          title: `API8 lifecycle ${runId}`,
        },
        {
          assignee_id: userIds.executor1,
          created_by: userIds.manager,
          description: `API8 reassigned description ${runId}`,
          id: taskIds.reassigned,
          project_id: projectIds.active,
          title: `API8 reassigned ${runId}`,
        },
        {
          assignee_id: userIds.executor1,
          created_by: userIds.manager,
          deleted_at: new Date().toISOString(),
          description: `API8 deleted description ${runId}`,
          id: taskIds.deleted,
          project_id: projectIds.active,
          title: `API8 deleted ${runId}`,
        },
        {
          assignee_id: userIds.executor1,
          created_by: userIds.manager,
          description: `API8 deleted project description ${runId}`,
          id: taskIds.deletedProject,
          project_id: projectIds.deleted,
          title: `API8 deleted project task ${runId}`,
        },
      ])
      if (tasks.error) {
        throw new Error('Failed to create Stage 8 API tasks')
      }

      for (const [status, comment] of [
        ['in_progress', null],
        ['in_review', 'Ready for API review'],
      ] as const) {
        const transition = await client('executor1').rpc('transition_task', {
          p_comment: comment,
          p_new_status: status,
          p_task_id: taskIds.lifecycle,
        })
        if (transition.error) {
          throw new Error('Failed to prepare Stage 8 API lifecycle')
        }
      }
      const rework = await client('manager').rpc('transition_task', {
        p_comment: 'API changes requested',
        p_new_status: 'rework',
        p_task_id: taskIds.lifecycle,
      })
      if (rework.error) {
        throw new Error('Failed to prepare Stage 8 API manager event')
      }
    } catch (error) {
      try {
        await cleanup()
      } catch {
        // Preserve the setup failure; afterAll retries cleanup.
      }
      throw error
    }
  })

  test.afterAll(async () => {
    await cleanup()
  })

  test('manager and assigned executor receive complete history with actor names', async () => {
    for (const name of ['manager', 'executor1'] as const) {
      const history = await client(name).rpc('get_task_history', {
        p_task_id: taskIds.lifecycle,
      })
      expect(history.error).toBeNull()
      expect(history.data).toHaveLength(4)
      expect(history.data?.map(({ actor_display_name }) => actor_display_name))
        .toEqual(expect.arrayContaining([names.manager, names.executor1]))
      expect(history.data?.find(({ to_status }) => to_status === 'rework'))
        .toMatchObject({
          actor_display_name: names.manager,
          comment: 'API changes requested',
          from_status: 'in_review',
          to_status: 'rework',
        })
    }

    const hiddenManagerProfile = await client('executor1')
      .from('profiles')
      .select('id')
      .eq('id', userIds.manager)
    expect(hiddenManagerProfile.error).toBeNull()
    expect(hiddenManagerProfile.data).toEqual([])
  })

  test('foreign and former executors receive no history', async () => {
    const foreign = await client('executor2').rpc('get_task_history', {
      p_task_id: taskIds.lifecycle,
    })
    expect(foreign.error).toBeNull()
    expect(foreign.data).toEqual([])

    const reassignment = await adminClient!
      .from('tasks')
      .update({ assignee_id: userIds.executor2 })
      .eq('id', taskIds.reassigned)
    expect(reassignment.error).toBeNull()

    const former = await client('executor1').rpc('get_task_history', {
      p_task_id: taskIds.reassigned,
    })
    const current = await client('executor2').rpc('get_task_history', {
      p_task_id: taskIds.reassigned,
    })
    expect(former.error).toBeNull()
    expect(former.data).toEqual([])
    expect(current.error).toBeNull()
    expect(current.data).toHaveLength(1)
    expect(current.data?.[0].actor_display_name).toBe(names.manager)
  })

  test('deleted scopes expose no history and RPC cannot mutate it', async () => {
    for (const taskId of [taskIds.deleted, taskIds.deletedProject]) {
      const history = await client('manager').rpc('get_task_history', {
        p_task_id: taskId,
      })
      expect(history.error).toBeNull()
      expect(history.data).toEqual([])
    }

    const before = await adminClient!
      .from('task_status_history')
      .select('id, comment')
      .eq('task_id', taskIds.lifecycle)
    expect(before.error).toBeNull()

    const forbiddenUpdate = await client('manager')
      .from('task_status_history')
      .update({ comment: 'forged' })
      .eq('task_id', taskIds.lifecycle)
    expect(forbiddenUpdate.error).not.toBeNull()

    const after = await adminClient!
      .from('task_status_history')
      .select('id, comment')
      .eq('task_id', taskIds.lifecycle)
    expect(after.error).toBeNull()
    expect(after.data).toEqual(before.data)
  })
})
