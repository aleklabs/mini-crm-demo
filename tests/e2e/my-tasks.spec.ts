import { randomBytes, randomUUID } from 'node:crypto'
import { expect, test, type Page, type TestInfo } from '@playwright/test'
import {
  createTestClient,
  loadLocalSupabaseConfig,
  type TestSupabaseClient,
} from '../helpers/localSupabase.ts'

type UserName = 'manager' | 'executor1' | 'executor2'

test.describe.serial('Stage 9 executor task list', () => {
  const runId = randomBytes(8).toString('hex')
  const password = `E2e9-${randomBytes(18).toString('base64url')}!`
  const emails: Record<UserName, string> = {
    executor1: `stage9-${runId}-executor1@example.test`,
    executor2: `stage9-${runId}-executor2@example.test`,
    manager: `stage9-${runId}-manager@example.test`,
  }
  const names: Record<UserName, string> = {
    executor1: `E2E9 Исполнитель Альфа ${runId}`,
    executor2: `E2E9 Исполнитель Бета ${runId}`,
    manager: `E2E9 Постановщик ${runId}`,
  }
  const userIds: Record<UserName, string> = {
    executor1: '',
    executor2: '',
    manager: '',
  }
  const projectIds = {
    deleted: randomUUID(),
    empty: randomUUID(),
    first: randomUUID(),
    second: randomUUID(),
  }
  const projectNames = {
    deleted: `E2E9 Удалённый объект ${runId}`,
    empty: `E2E9 Объект без задач ${runId}`,
    first: `E2E9 Первый объект ${runId}`,
    second: `E2E9 Второй объект ${runId}`,
  }
  const taskIds = {
    accepted: randomUUID(),
    deleted: randomUUID(),
    deletedProject: randomUUID(),
    executor2First: randomUUID(),
    executor2Second: randomUUID(),
    inProgress: randomUUID(),
    inReview: randomUUID(),
    new: randomUUID(),
    reassigned: randomUUID(),
    rework: randomUUID(),
  }
  const taskTitles = {
    accepted: `E2E9 Принятая ${runId}`,
    deleted: `E2E9 Удалённая ${runId}`,
    deletedProject: `E2E9 Удалённый объект задача ${runId}`,
    executor2First: `E2E9 Задача Бета первая ${runId}`,
    executor2Second: `E2E9 Задача Бета вторая ${runId}`,
    inProgress: `E2E9 В работе ${runId}`,
    inReview: `E2E9 На проверке ${runId}`,
    new: `E2E9 Новая ${runId}`,
    reassigned: `E2E9 Переназначение ${runId}`,
    rework: `E2E9 На доработке ${runId}`,
  }
  const baseTime = Date.parse('2026-10-15T10:00:00.000Z')
  const createdAt: Record<keyof typeof taskIds, string> = {
    accepted: new Date(baseTime + 7 * 60_000).toISOString(),
    deleted: new Date(baseTime + 3 * 60_000).toISOString(),
    deletedProject: new Date(baseTime + 2 * 60_000).toISOString(),
    executor2First: new Date(baseTime + 4 * 60_000).toISOString(),
    executor2Second: new Date(baseTime + 1 * 60_000).toISOString(),
    inProgress: new Date(baseTime + 9 * 60_000).toISOString(),
    inReview: new Date(baseTime + 8 * 60_000).toISOString(),
    new: new Date(baseTime + 10 * 60_000).toISOString(),
    reassigned: new Date(baseTime + 5 * 60_000).toISOString(),
    rework: new Date(baseTime + 6 * 60_000).toISOString(),
  }
  const executor1InitialOrder = [
    taskTitles.new,
    taskTitles.inProgress,
    taskTitles.inReview,
    taskTitles.accepted,
    taskTitles.rework,
    taskTitles.reassigned,
  ]
  const createdUserIds: string[] = []
  const userClients: Partial<Record<UserName, TestSupabaseClient>> = {}
  let adminClient: TestSupabaseClient | undefined
  let consoleErrors: string[] = []
  let pageErrors: string[] = []

  const userClient = (name: UserName) => {
    const value = userClients[name]
    if (!value) {
      throw new Error(`Stage 9 client ${name} is unavailable`)
    }
    return value
  }

  const taskCard = (page: Page, title: string) =>
    page.locator('.my-task-card').filter({ hasText: title })

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
      throw new Error('Failed to clean Stage 9 history')
    }
    const taskDelete = await adminClient
      .from('tasks')
      .delete()
      .in('id', ownTaskIds)
    if (taskDelete.error) {
      throw new Error('Failed to clean Stage 9 tasks')
    }
    const projectDelete = await adminClient
      .from('projects')
      .delete()
      .in('id', Object.values(projectIds))
    if (projectDelete.error) {
      throw new Error('Failed to clean Stage 9 projects')
    }
    if (createdUserIds.length > 0) {
      const profileDelete = await adminClient
        .from('profiles')
        .delete()
        .in('id', createdUserIds)
      if (profileDelete.error) {
        throw new Error('Failed to clean Stage 9 profiles')
      }
    }
    for (const userId of [...createdUserIds].reverse()) {
      const deletion = await adminClient.auth.admin.deleteUser(userId)
      if (deletion.error) {
        throw new Error('Failed to clean a Stage 9 auth user')
      }
    }
    createdUserIds.length = 0

    const [history, tasks, projects, profiles] = await Promise.all([
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
      adminClient
        .from('profiles')
        .select('id', { count: 'exact', head: true })
        .in('id', Object.values(userIds).filter(Boolean)),
    ])
    if (
      history.error || history.count !== 0 ||
      tasks.error || tasks.count !== 0 ||
      projects.error || projects.count !== 0 ||
      profiles.error || profiles.count !== 0
    ) {
      throw new Error('Stage 9 cleanup verification failed')
    }
  }

  const login = async (page: Page, name: UserName) => {
    await page.goto('/login')
    const email = page.getByLabel('Email')
    const signOut = page.getByRole('button', { name: 'Выйти' })
    await expect(email.or(signOut).first()).toBeVisible()
    if (await signOut.isVisible()) {
      await signOut.click()
      await expect(page).toHaveURL(/\/login$/)
    }
    await email.fill(emails[name])
    await page.getByLabel('Пароль').fill(password)
    await page.getByRole('button', { name: 'Войти' }).click()
    await expect(page).toHaveURL(/\/projects$/)
  }

  const openMyTasks = async (page: Page) => {
    await page.goto('/my-tasks')
    await expect(
      page.getByRole('heading', { level: 2, name: 'Мои задачи' }),
    ).toBeVisible()
    await expect(page.getByRole('status')).toHaveCount(0)
  }

  const transition = async (
    actor: UserName,
    taskId: string,
    status: string,
    comment: string | null = null,
  ) => {
    const result = await userClient(actor).rpc('transition_task', {
      p_comment: comment,
      p_new_status: status,
      p_task_id: taskId,
    })
    if (result.error) {
      throw new Error(`Failed to prepare Stage 9 status ${status}`)
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
          throw new Error(`Failed to create Stage 9 user ${name}`)
        }
        userIds[name] = created.data.user.id
        createdUserIds.push(created.data.user.id)

        const client = createTestClient(config.apiUrl, config.publishableKey)
        const signIn = await client.auth.signInWithPassword({
          email: emails[name],
          password,
        })
        if (signIn.error) {
          throw new Error(`Failed to authenticate Stage 9 user ${name}`)
        }
        userClients[name] = client
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
        throw new Error('Failed to create Stage 9 profiles')
      }

      const projects = await adminClient.from('projects').insert([
        {
          address: `Первый адрес ${runId}`,
          id: projectIds.first,
          name: projectNames.first,
        },
        {
          address: `Второй адрес ${runId}`,
          id: projectIds.second,
          name: projectNames.second,
        },
        {
          address: `Пустой адрес ${runId}`,
          id: projectIds.empty,
          name: projectNames.empty,
        },
        {
          address: `Удалённый адрес ${runId}`,
          deleted_at: new Date().toISOString(),
          id: projectIds.deleted,
          name: projectNames.deleted,
        },
      ])
      if (projects.error) {
        throw new Error('Failed to create Stage 9 projects')
      }

      const taskKeys = Object.keys(taskIds) as Array<keyof typeof taskIds>
      const tasks = await adminClient.from('tasks').insert(
        taskKeys.map((key) => ({
          assignee_id:
            key === 'executor2First' || key === 'executor2Second'
              ? userIds.executor2
              : userIds.executor1,
          created_at: createdAt[key],
          created_by: userIds.manager,
          deleted_at: key === 'deleted' ? new Date().toISOString() : null,
          description: `Описание ${taskTitles[key]}`,
          id: taskIds[key],
          project_id:
            key === 'deletedProject'
              ? projectIds.deleted
              : key === 'inProgress' || key === 'accepted' ||
                  key === 'reassigned' || key === 'executor2First'
                ? projectIds.second
                : projectIds.first,
          title: taskTitles[key],
        })),
      )
      if (tasks.error) {
        throw new Error('Failed to create Stage 9 tasks')
      }

      await transition('executor1', taskIds.inProgress, 'in_progress')
      await transition('executor1', taskIds.inReview, 'in_progress')
      await transition('executor1', taskIds.inReview, 'in_review')
      await transition('executor1', taskIds.accepted, 'in_progress')
      await transition('executor1', taskIds.accepted, 'in_review')
      await transition('manager', taskIds.accepted, 'accepted')
      await transition('executor1', taskIds.rework, 'in_progress')
      await transition('executor1', taskIds.rework, 'in_review')
      await transition(
        'manager',
        taskIds.rework,
        'rework',
        `Исправить ${runId}`,
      )
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

  test.beforeEach(async ({ page }) => {
    consoleErrors = []
    pageErrors = []
    page.on('console', (message) => {
      if (message.type() === 'error') {
        consoleErrors.push(message.text())
      }
    })
    page.on('pageerror', (error) => pageErrors.push(error.message))
  })

  test.afterEach(({ page }, testInfo: TestInfo) => {
    void page
    const expectedApiError = testInfo.title.includes('error and retry')
    const unexpected = expectedApiError
      ? consoleErrors.filter(
          (message) =>
            !message.includes(
              'Failed to load resource: the server responded with a status of 500',
            ),
        )
      : consoleErrors
    expect(unexpected).toEqual([])
    expect(pageErrors).toEqual([])
  })

  test('route access and navigation are role protected before task loading', async ({
    page,
  }) => {
    await page.goto('/my-tasks')
    await expect(page).toHaveURL(/\/login$/)

    await login(page, 'manager')
    await expect(
      page.getByRole('link', { name: 'Мои задачи' }),
    ).toHaveCount(0)
    let taskRequests = 0
    page.on('request', (request) => {
      if (
        request.method() === 'GET' &&
        request.url().includes('/rest/v1/tasks')
      ) {
        taskRequests += 1
      }
    })
    await page.goto('/my-tasks')
    await expect(
      page.getByRole('heading', { name: 'Недостаточно прав' }),
    ).toBeVisible()
    expect(taskRequests).toBe(0)

    await login(page, 'executor1')
    const myTasksLink = page.getByRole('link', { name: 'Мои задачи' })
    await expect(myTasksLink).toBeVisible()
    await myTasksLink.click()
    await expect(page).toHaveURL(/\/my-tasks$/)
    await expect(
      page.getByRole('heading', { level: 2, name: 'Мои задачи' }),
    ).toBeVisible()
  })

  test('executor list contains every status, server order, dates and correct links', async ({
    page,
  }) => {
    await login(page, 'executor1')
    await openMyTasks(page)
    await expect(page.locator('.my-task-card')).toHaveCount(6)
    await expect(
      page.locator('.my-task-card h3').allTextContents(),
    ).resolves.toEqual(executor1InitialOrder)

    const expectedStatuses: Array<[keyof typeof taskTitles, string]> = [
      ['new', 'Новая'],
      ['inProgress', 'В работе'],
      ['inReview', 'На проверке'],
      ['accepted', 'Принята'],
      ['rework', 'На доработке'],
    ]
    for (const [key, status] of expectedStatuses) {
      await expect(taskCard(page, taskTitles[key])).toContainText(status)
    }

    await expect(taskCard(page, taskTitles.inProgress)).toContainText(
      projectNames.second,
    )
    await expect(taskCard(page, taskTitles.new)).toContainText(
      projectNames.first,
    )
    const displayedCreatedAt = await taskCard(page, taskTitles.new)
      .locator('time')
      .getAttribute('datetime')
    expect(displayedCreatedAt).not.toBeNull()
    expect(new Date(displayedCreatedAt ?? '').toISOString()).toBe(createdAt.new)
    await expect(
      taskCard(page, taskTitles.new).getByRole('link', {
        exact: true,
        name: taskTitles.new,
      }),
    ).toHaveAttribute('href', `/tasks/${taskIds.new}`)
    await expect(
      taskCard(page, taskTitles.new).getByRole('link', {
        name: projectNames.first,
      }),
    ).toHaveAttribute('href', `/projects/${projectIds.first}`)

    for (const hiddenTitle of [
      taskTitles.executor2First,
      taskTitles.executor2Second,
      taskTitles.deleted,
      taskTitles.deletedProject,
    ]) {
      await expect(page.getByText(hiddenTitle, { exact: true })).toHaveCount(0)
    }

    await page.reload()
    await expect(page.locator('.my-task-card')).toHaveCount(6)
    await page.setViewportSize({ height: 740, width: 360 })
    expect(
      await page.evaluate<boolean>(
        'document.documentElement.scrollWidth <= window.innerWidth',
      ),
    ).toBe(true)
  })

  test('task and project navigation work and executors receive distinct RLS results', async ({
    page,
  }) => {
    await login(page, 'executor1')
    await openMyTasks(page)
    await taskCard(page, taskTitles.inProgress)
      .getByRole('link', { exact: true, name: taskTitles.inProgress })
      .click()
    await expect(page).toHaveURL(new RegExp(`/tasks/${taskIds.inProgress}$`))
    await expect(
      page.getByRole('heading', { name: taskTitles.inProgress }),
    ).toBeVisible()
    await page.getByRole('link', { name: '← К моим задачам' }).click()
    await expect(page).toHaveURL(/\/my-tasks$/)
    await expect(taskCard(page, taskTitles.inProgress)).toBeVisible()

    await taskCard(page, taskTitles.inProgress)
      .getByRole('link', { name: projectNames.second })
      .click()
    await expect(page).toHaveURL(new RegExp(`/projects/${projectIds.second}$`))
    await expect(
      page.getByRole('heading', { name: projectNames.second }),
    ).toBeVisible()

    await login(page, 'executor2')
    await openMyTasks(page)
    await expect(page.locator('.my-task-card')).toHaveCount(2)
    await expect(taskCard(page, taskTitles.executor2First)).toBeVisible()
    await expect(taskCard(page, taskTitles.executor2Second)).toBeVisible()
    await expect(page.getByText(taskTitles.new, { exact: true })).toHaveCount(0)
    await expect(page.getByText(taskTitles.accepted, { exact: true }))
      .toHaveCount(0)
  })

  test('status, reassignment and soft delete are reflected on ordinary reload', async ({
    page,
  }) => {
    await login(page, 'executor1')
    await openMyTasks(page)
    await taskCard(page, taskTitles.new)
      .getByRole('link', { exact: true, name: taskTitles.new })
      .click()
    await page.getByRole('button', { name: 'Взять в работу' }).click()
    await expect(page.locator('.task-details-card .status-label')).toHaveText(
      'В работе',
    )
    await page.getByRole('link', { name: '← К моим задачам' }).click()
    await expect(taskCard(page, taskTitles.new)).toContainText('В работе')
    const transitioned = await adminClient!
      .from('tasks')
      .select('status')
      .eq('id', taskIds.new)
      .single()
    expect(transitioned.data?.status).toBe('in_progress')

    const reassignment = await adminClient!
      .from('tasks')
      .update({ assignee_id: userIds.executor2 })
      .eq('id', taskIds.reassigned)
    expect(reassignment.error).toBeNull()
    await page.reload()
    await expect(page.getByText(taskTitles.reassigned, { exact: true }))
      .toHaveCount(0)
    await expect(taskCard(page, taskTitles.accepted)).toBeVisible()

    await login(page, 'executor2')
    await openMyTasks(page)
    await expect(taskCard(page, taskTitles.reassigned)).toBeVisible()
    const softDelete = await userClient('manager')
      .from('tasks')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', taskIds.executor2First)
    expect(softDelete.error).toBeNull()
    await page.reload()
    await expect(page.getByText(taskTitles.executor2First, { exact: true }))
      .toHaveCount(0)
    await expect(page.getByText(taskTitles.deletedProject, { exact: true }))
      .toHaveCount(0)
  })

  test('API error and retry recover, then an executor can have an empty list', async ({
    page,
  }) => {
    await login(page, 'executor1')
    let failTasks = true
    await page.route('**/rest/v1/tasks*', async (route) => {
      if (failTasks && route.request().method() === 'GET') {
        await route.fulfill({
          body: JSON.stringify({ message: 'synthetic task list failure' }),
          contentType: 'application/json',
          status: 500,
        })
        return
      }
      await route.continue()
    })
    await page.goto('/my-tasks')
    await expect(page.getByRole('alert')).toContainText(
      'Не удалось загрузить задачи',
    )
    failTasks = false
    await page.getByRole('button', { name: 'Повторить' }).click()
    await expect(page.locator('.my-task-card')).toHaveCount(5)
    await page.unroute('**/rest/v1/tasks*')

    const [returnTask, deleteRemaining] = await Promise.all([
      userClient('manager')
        .from('tasks')
        .update({ assignee_id: userIds.executor1 })
        .eq('id', taskIds.reassigned),
      userClient('manager')
        .from('tasks')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', taskIds.executor2Second),
    ])
    expect(returnTask.error).toBeNull()
    expect(deleteRemaining.error).toBeNull()

    await login(page, 'executor2')
    await openMyTasks(page)
    await expect(page.getByText('У вас пока нет задач')).toBeVisible()
    await expect(page.locator('.my-task-card')).toHaveCount(0)
  })

  test('stale response and sequential sign-in cannot restore previous user data', async ({
    page,
  }) => {
    await login(page, 'executor1')
    let holdInitialRequests = true
    let releaseFirst: (() => void) | undefined
    let finishFirst: (() => void) | undefined
    let heldRequests = 0
    let finishedRequests = 0
    let requestsReleased = false
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const firstFinished = new Promise<void>((resolve) => {
      finishFirst = resolve
    })
    await page.route('**/rest/v1/tasks*', async (route) => {
      if (!holdInitialRequests || route.request().method() !== 'GET') {
        await route.continue()
        return
      }

      heldRequests += 1
      const response = await route.fetch()
      await firstGate
      try {
        await route.fulfill({ response })
      } finally {
        finishedRequests += 1
        if (requestsReleased && finishedRequests === heldRequests) {
          finishFirst?.()
        }
      }
    })

    await page.goto('/my-tasks')
    await expect(page.getByRole('status')).toHaveText('Загрузка задач…')
    holdInitialRequests = false
    await page.goto('/projects')
    await page.goto('/my-tasks')
    await expect(taskCard(page, taskTitles.new)).toBeVisible()
    requestsReleased = true
    releaseFirst?.()
    if (finishedRequests === heldRequests) {
      finishFirst?.()
    }
    await firstFinished
    await expect(taskCard(page, taskTitles.new)).toBeVisible()
    await expect(page.locator('.my-task-card')).toHaveCount(6)

    await login(page, 'executor2')
    await openMyTasks(page)
    await expect(page.getByText('У вас пока нет задач')).toBeVisible()
    await expect(page.getByText(taskTitles.new, { exact: true })).toHaveCount(0)
    await expect(page.getByText(taskTitles.accepted, { exact: true }))
      .toHaveCount(0)
  })
})
