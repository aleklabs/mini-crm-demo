import { randomBytes, randomUUID } from 'node:crypto'
import { expect, test, type Page, type TestInfo } from '@playwright/test'
import {
  createTestClient,
  loadLocalSupabaseConfig,
  type TestSupabaseClient,
} from '../helpers/localSupabase.ts'

type UserName = 'manager' | 'executor1' | 'executor2'

test.describe('task management', () => {
  const runId = randomBytes(8).toString('hex')
  const password = `E2e7-${randomBytes(18).toString('base64url')}!`
  const emails: Record<UserName, string> = {
    executor1: `stage7-${runId}-executor1@example.test`,
    executor2: `stage7-${runId}-executor2@example.test`,
    manager: `stage7-${runId}-manager@example.test`,
  }
  const userIds: Record<UserName, string> = {
    executor1: '',
    executor2: '',
    manager: '',
  }
  const displayNames = {
    executor1: `E2E7 Исполнитель Альфа ${runId}`,
    executor2: `E2E7 Исполнитель Бета ${runId}`,
    manager: `E2E7 Постановщик ${runId}`,
  }
  const projectIds = {
    deleted: randomUUID(),
    first: randomUUID(),
    second: randomUUID(),
  }
  const projectNames = {
    deleted: `E2E7 Удалённый объект ${runId}`,
    first: `E2E7 Первый объект ${runId}`,
    second: `E2E7 Второй объект ${runId}`,
  }
  const taskIds = {
    cancel: randomUUID(),
    deleteError: randomUUID(),
    deletable: randomUUID(),
    deleted: randomUUID(),
    editable: randomUUID(),
    error: randomUUID(),
  }
  const taskTitles = {
    cancel: `E2E7 Отмена задачи ${runId}`,
    deleteError: `E2E7 Ошибка удаления задачи ${runId}`,
    deletable: `E2E7 Удаляемая задача ${runId}`,
    deleted: `E2E7 Уже удалённая задача ${runId}`,
    editable: `E2E7 Редактируемая задача ${runId}`,
    error: `E2E7 Ошибка сохранения задачи ${runId}`,
  }
  const taskDescriptions = {
    cancel: `Описание отменяемой задачи ${runId}`,
    deleteError: `Описание ошибки удаления ${runId}`,
    deletable: `Описание удаляемой задачи ${runId}`,
    deleted: `Описание удалённой задачи ${runId}`,
    editable: `Описание редактируемой задачи ${runId}`,
    error: `Описание ошибки сохранения ${runId}`,
  }
  const createdUserIds: string[] = []

  let adminClient: TestSupabaseClient | undefined
  let consoleErrors: string[] = []
  let pageErrors: string[] = []

  const cleanupFixtures = async () => {
    if (!adminClient) {
      return
    }

    const ownTasks = await adminClient
      .from('tasks')
      .select('id')
      .like('title', `%${runId}%`)
    if (ownTasks.error) {
      throw new Error('Failed to find Stage 7 tasks for cleanup')
    }
    const ownTaskIds = ownTasks.data.map(({ id }) => id)
    if (ownTaskIds.length > 0) {
      const historyDelete = await adminClient
        .from('task_status_history')
        .delete()
        .in('task_id', ownTaskIds)
      if (historyDelete.error) {
        throw new Error('Failed to clean Stage 7 task history')
      }
      const taskDelete = await adminClient
        .from('tasks')
        .delete()
        .in('id', ownTaskIds)
      if (taskDelete.error) {
        throw new Error('Failed to clean Stage 7 tasks')
      }
    }

    const ownProjects = await adminClient
      .from('projects')
      .select('id')
      .like('name', `%${runId}%`)
    if (ownProjects.error) {
      throw new Error('Failed to find Stage 7 projects for cleanup')
    }
    const ownProjectIds = ownProjects.data.map(({ id }) => id)
    if (ownProjectIds.length > 0) {
      const projectDelete = await adminClient
        .from('projects')
        .delete()
        .in('id', ownProjectIds)
      if (projectDelete.error) {
        throw new Error('Failed to clean Stage 7 projects')
      }
    }

    if (createdUserIds.length > 0) {
      const profileDelete = await adminClient
        .from('profiles')
        .delete()
        .in('id', createdUserIds)
      if (profileDelete.error) {
        throw new Error('Failed to clean Stage 7 profiles')
      }
    }

    while (createdUserIds.length > 0) {
      const userId = createdUserIds.at(-1)
      if (!userId) {
        break
      }
      const { error } = await adminClient.auth.admin.deleteUser(userId)
      if (error) {
        throw new Error('Failed to clean a Stage 7 auth user')
      }
      createdUserIds.pop()
    }

    const historyCheck =
      ownTaskIds.length === 0
        ? { count: 0, error: null }
        : await adminClient
            .from('task_status_history')
            .select('id', { count: 'exact', head: true })
            .in('task_id', ownTaskIds)
    const taskCheck = await adminClient
      .from('tasks')
      .select('id', { count: 'exact', head: true })
      .like('title', `%${runId}%`)
    const projectCheck = await adminClient
      .from('projects')
      .select('id', { count: 'exact', head: true })
      .like('name', `%${runId}%`)
    if (
      historyCheck.error ||
      historyCheck.count !== 0 ||
      taskCheck.error ||
      taskCheck.count !== 0 ||
      projectCheck.error ||
      projectCheck.count !== 0
    ) {
      throw new Error('Stage 7 database cleanup verification failed')
    }
  }

  const login = async (page: Page, user: UserName) => {
    await page.goto('/login')
    await page.getByLabel('Email').fill(emails[user])
    await page.getByLabel('Пароль').fill(password)
    await page.getByRole('button', { name: 'Войти' }).click()
    await expect(page).toHaveURL(/\/projects$/)
    await expect(
      page.getByRole('heading', { level: 2, name: 'Объекты' }),
    ).toBeVisible()
  }

  const taskCard = (page: Page, title: string) =>
    page.locator('.task-card').filter({ hasText: title })

  const unexpectedConsoleErrors = (testInfo: TestInfo) =>
    testInfo.title.includes('API error')
      ? consoleErrors.filter(
          (message) =>
            !message.includes(
              'Failed to load resource: the server responded with a status of 400',
            ),
        )
      : consoleErrors

  test.beforeAll(async () => {
    const localConfig = loadLocalSupabaseConfig()
    adminClient = createTestClient(localConfig.apiUrl, localConfig.secretKey)

    try {
      for (const name of ['manager', 'executor1', 'executor2'] as const) {
        const { data, error } = await adminClient.auth.admin.createUser({
          email: emails[name],
          email_confirm: true,
          password,
        })
        if (error || !data.user) {
          throw new Error(`Failed to create Stage 7 user ${name}`)
        }
        userIds[name] = data.user.id
        createdUserIds.push(data.user.id)
      }

      const profiles = await adminClient.from('profiles').insert([
        {
          display_name: displayNames.manager,
          id: userIds.manager,
          role: 'manager',
        },
        {
          display_name: displayNames.executor1,
          id: userIds.executor1,
          role: 'executor',
        },
        {
          display_name: displayNames.executor2,
          id: userIds.executor2,
          role: 'executor',
        },
      ])
      if (profiles.error) {
        throw new Error('Failed to create Stage 7 profiles')
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
          address: `Удалённый адрес ${runId}`,
          deleted_at: new Date().toISOString(),
          id: projectIds.deleted,
          name: projectNames.deleted,
        },
      ])
      if (projects.error) {
        throw new Error('Failed to create Stage 7 projects')
      }

      const taskKeys = Object.keys(taskIds) as Array<keyof typeof taskIds>
      const tasks = await adminClient.from('tasks').insert(
        taskKeys.map((key) => ({
          assignee_id: userIds.executor1,
          created_by: userIds.manager,
          deleted_at: key === 'deleted' ? new Date().toISOString() : null,
          description: taskDescriptions[key],
          id: taskIds[key],
          project_id: projectIds.first,
          title: taskTitles[key],
        })),
      )
      if (tasks.error) {
        throw new Error('Failed to create Stage 7 tasks')
      }
    } catch (error) {
      try {
        await cleanupFixtures()
      } catch {
        // afterAll retries cleanup; preserve the original setup error.
      }
      throw error
    }
  })

  test.afterAll(async () => {
    await cleanupFixtures()
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

  test.afterEach(({ page }, testInfo) => {
    void page
    expect(unexpectedConsoleErrors(testInfo)).toEqual([])
    expect(pageErrors).toEqual([])
  })

  test('manager validates and creates one task with database defaults', async ({
    page,
  }) => {
    const createdTitle = `E2E7 Созданная задача ${runId}`
    await login(page, 'manager')
    await page.goto(`/projects/${projectIds.first}`)
    await page.getByRole('link', { name: 'Создать задачу' }).click()
    await expect(page).toHaveURL(
      new RegExp(`/projects/${projectIds.first}/tasks/new$`),
    )
    await expect(page.getByRole('heading', { name: 'Новая задача' })).toBeVisible()
    await expect(page.getByLabel('Объект')).toHaveValue(projectIds.first)
    await expect(page.getByLabel('Объект')).not.toContainText(
      projectNames.deleted,
    )

    const assigneeValues = await page
      .getByLabel('Исполнитель')
      .locator('option')
      .evaluateAll((options) =>
        options.map((option) => option.getAttribute('value') ?? ''),
      )
    expect(assigneeValues).toContain(userIds.executor1)
    expect(assigneeValues).toContain(userIds.executor2)
    expect(assigneeValues).not.toContain(userIds.manager)
    const optionProfileIds = assigneeValues.filter(Boolean)
    const optionProfiles = await adminClient!
      .from('profiles')
      .select('id, role')
      .in('id', optionProfileIds)
    expect(optionProfiles.error).toBeNull()
    expect(optionProfiles.data?.every(({ role }) => role === 'executor')).toBe(
      true,
    )

    await page.getByRole('button', { name: 'Сохранить' }).click()
    expect(
      await page
        .getByLabel('Название')
        .evaluate((input) => input.matches(':invalid')),
    ).toBe(true)
    await page.getByLabel('Название').fill('   ')
    await page.getByLabel('Исполнитель').selectOption(userIds.executor1)
    await page.getByLabel('Название').press('Enter')
    await expect(page.getByRole('alert')).toHaveText(
      'Заполните название, объект и исполнителя.',
    )

    let releaseInsert: (() => void) | undefined
    let markInsertStarted: (() => void) | undefined
    const insertGate = new Promise<void>((resolve) => {
      releaseInsert = resolve
    })
    const insertStarted = new Promise<void>((resolve) => {
      markInsertStarted = resolve
    })
    let insertCount = 0
    await page.route('**/rest/v1/tasks*', async (route) => {
      if (route.request().method() === 'POST') {
        insertCount += 1
        markInsertStarted?.()
        await insertGate
      }
      await route.continue()
    })

    await page.getByLabel('Название').fill(`  ${createdTitle}  `)
    await page.getByLabel('Описание').fill('   ')
    await page.getByLabel('Название').press('Enter')
    await insertStarted
    await expect(page.getByRole('status')).toHaveText('Сохранение…')
    await expect(
      page.getByRole('button', { name: 'Сохранение…' }),
    ).toBeDisabled()
    await page.locator('form').evaluate((form) => {
      ;(form as unknown as { requestSubmit: () => void }).requestSubmit()
    })
    expect(insertCount).toBe(1)
    releaseInsert?.()

    await expect(page).toHaveURL(
      new RegExp(`/projects/${projectIds.first}$`),
    )
    const createdCard = taskCard(page, createdTitle)
    await expect(createdCard).toBeVisible()
    await expect(createdCard.getByText('Новая', { exact: true })).toBeVisible()
    await expect(createdCard).toContainText(
      `Исполнитель: ${displayNames.executor1}`,
    )
    expect(insertCount).toBe(1)

    const stored = await adminClient!
      .from('tasks')
      .select(
        'id, title, description, project_id, assignee_id, created_by, status, created_at, deleted_at',
      )
      .eq('title', createdTitle)
      .single()
    expect(stored.error).toBeNull()
    expect(stored.data).toMatchObject({
      assignee_id: userIds.executor1,
      created_by: userIds.manager,
      deleted_at: null,
      description: '',
      project_id: projectIds.first,
      status: 'new',
      title: createdTitle,
    })
    expect(Number.isNaN(Date.parse(stored.data?.created_at ?? ''))).toBe(false)

    const history = await adminClient!
      .from('task_status_history')
      .select('actor_id, from_status, to_status, comment', { count: 'exact' })
      .eq('task_id', stored.data?.id ?? '')
    expect(history.error).toBeNull()
    expect(history.count).toBe(1)
    expect(history.data).toEqual([
      {
        actor_id: userIds.manager,
        comment: null,
        from_status: null,
        to_status: 'new',
      },
    ])

    await page.reload()
    await expect(taskCard(page, createdTitle)).toBeVisible()
  })

  test('executor has no task management UI or direct route access', async ({
    page,
  }) => {
    await login(page, 'executor1')
    await page.goto(`/projects/${projectIds.first}`)
    await expect(page.getByRole('link', { name: 'Создать задачу' })).toHaveCount(
      0,
    )
    await expect(
      page.getByRole('link', { name: /Редактировать задачу/ }),
    ).toHaveCount(0)
    await expect(
      page.getByRole('button', { name: /Удалить задачу/ }),
    ).toHaveCount(0)

    for (const path of [
      `/projects/${projectIds.first}/tasks/new`,
      `/tasks/${taskIds.editable}/edit`,
    ]) {
      await page.goto(path)
      await expect(
        page.getByRole('heading', { name: 'Недостаточно прав' }),
      ).toBeVisible()
      await expect(page.getByLabel('Название')).toHaveCount(0)
    }
  })

  test('manager edits, reassigns and moves a task without changing protected fields', async ({
    page,
  }) => {
    const updatedTitle = `E2E7 Перенесённая задача ${runId}`
    const updatedDescription = `Обновлённое описание ${runId}`
    const before = await adminClient!
      .from('tasks')
      .select('status, created_by')
      .eq('id', taskIds.editable)
      .single()
    const historyBefore = await adminClient!
      .from('task_status_history')
      .select('id', { count: 'exact', head: true })
      .eq('task_id', taskIds.editable)

    await login(page, 'manager')
    await page.goto(`/projects/${projectIds.first}`)
    await page
      .getByRole('link', {
        name: `Редактировать задачу «${taskTitles.editable}»`,
      })
      .click()
    await expect(page.getByLabel('Название')).toHaveValue(taskTitles.editable)
    await expect(page.getByLabel('Описание')).toHaveValue(
      taskDescriptions.editable,
    )
    await expect(page.getByLabel('Объект')).toHaveValue(projectIds.first)
    await expect(page.getByLabel('Исполнитель')).toHaveValue(userIds.executor1)

    await page.getByLabel('Название').fill(`  ${updatedTitle}  `)
    await page.getByLabel('Описание').fill(`  ${updatedDescription}  `)
    await page.getByLabel('Объект').selectOption(projectIds.second)
    await page.getByLabel('Исполнитель').selectOption(userIds.executor2)
    await page.getByLabel('Название').press('Enter')

    await expect(page).toHaveURL(
      new RegExp(`/projects/${projectIds.second}$`),
    )
    const movedCard = taskCard(page, updatedTitle)
    await expect(movedCard).toBeVisible()
    await expect(movedCard).toContainText(
      `Исполнитель: ${displayNames.executor2}`,
    )
    await page.reload()
    await expect(taskCard(page, updatedTitle)).toBeVisible()
    await page.goto(`/projects/${projectIds.first}`)
    await expect(taskCard(page, updatedTitle)).toHaveCount(0)

    const stored = await adminClient!
      .from('tasks')
      .select(
        'title, description, project_id, assignee_id, status, created_by',
      )
      .eq('id', taskIds.editable)
      .single()
    expect(stored.data).toEqual({
      assignee_id: userIds.executor2,
      created_by: before.data?.created_by,
      description: updatedDescription,
      project_id: projectIds.second,
      status: before.data?.status,
      title: updatedTitle,
    })
    const historyAfter = await adminClient!
      .from('task_status_history')
      .select('id', { count: 'exact', head: true })
      .eq('task_id', taskIds.editable)
    expect(historyAfter.count).toBe(historyBefore.count)
  })

  test('canceling task edit leaves every value unchanged', async ({ page }) => {
    await login(page, 'manager')
    await page.goto(`/tasks/${taskIds.cancel}/edit`)
    await expect(page.getByLabel('Название')).toHaveValue(taskTitles.cancel)
    await page.getByLabel('Название').fill(`E2E7 Не сохранять ${runId}`)
    await page.getByLabel('Описание').fill(`Не сохранять описание ${runId}`)
    await page.getByLabel('Объект').selectOption(projectIds.second)
    await page.getByLabel('Исполнитель').selectOption(userIds.executor2)
    await page.getByRole('button', { name: 'Отмена' }).click()
    await expect(page).toHaveURL(
      new RegExp(`/projects/${projectIds.first}$`),
    )

    const stored = await adminClient!
      .from('tasks')
      .select('title, description, project_id, assignee_id')
      .eq('id', taskIds.cancel)
      .single()
    expect(stored.data).toEqual({
      assignee_id: userIds.executor1,
      description: taskDescriptions.cancel,
      project_id: projectIds.first,
      title: taskTitles.cancel,
    })
  })

  test('task edit API error preserves values and allows retry', async ({
    page,
  }) => {
    const retriedTitle = `E2E7 После повтора задачи ${runId}`
    const retriedDescription = `Описание после повтора ${runId}`
    let failUpdate = true
    await login(page, 'manager')
    await page.goto(`/tasks/${taskIds.error}/edit`)
    await expect(page.getByLabel('Название')).toHaveValue(taskTitles.error)
    await page.route('**/rest/v1/tasks*', async (route) => {
      if (failUpdate && route.request().method() === 'PATCH') {
        await route.fulfill({
          body: JSON.stringify({
            code: 'PGRST100',
            details: null,
            hint: null,
            message: 'synthetic failure',
          }),
          contentType: 'application/json',
          status: 400,
        })
        return
      }
      await route.continue()
    })

    await page.getByLabel('Название').fill(retriedTitle)
    await page.getByLabel('Описание').fill(retriedDescription)
    await page.getByLabel('Исполнитель').selectOption(userIds.executor2)
    await page.getByRole('button', { name: 'Сохранить' }).click()
    await expect(page.getByRole('alert')).toHaveText(
      'Не удалось сохранить задачу. Повторите попытку.',
    )
    await expect(page.getByLabel('Название')).toHaveValue(retriedTitle)
    await expect(page.getByLabel('Описание')).toHaveValue(retriedDescription)
    await expect(page.getByLabel('Исполнитель')).toHaveValue(userIds.executor2)
    await expect(
      page.getByRole('button', { name: 'Сохранить' }),
    ).toBeEnabled()
    await expect(page.getByRole('status')).toHaveCount(0)

    failUpdate = false
    await page.getByRole('button', { name: 'Сохранить' }).click()
    await expect(taskCard(page, retriedTitle)).toBeVisible()
    const stored = await adminClient!
      .from('tasks')
      .select('title, description, assignee_id')
      .eq('id', taskIds.error)
      .single()
    expect(stored.data).toEqual({
      assignee_id: userIds.executor2,
      description: retriedDescription,
      title: retriedTitle,
    })
  })

  test('stale task response cannot replace a newly opened task', async ({
    page,
  }) => {
    let releaseFirstRequest: (() => void) | undefined
    const firstRequestGate = new Promise<void>((resolve) => {
      releaseFirstRequest = resolve
    })
    await login(page, 'manager')
    await page.route('**/rest/v1/tasks*', async (route) => {
      if (
        route.request().method() === 'GET' &&
        route.request().url().includes(taskIds.error)
      ) {
        await firstRequestGate
      }
      await route.continue()
    })

    await page.goto(`/tasks/${taskIds.error}/edit`)
    await expect(page.getByRole('status')).toHaveText('Загрузка задачи…')
    await page.goto(`/tasks/${taskIds.cancel}/edit`)
    await expect(page.getByLabel('Название')).toHaveValue(taskTitles.cancel)
    await expect(page.getByLabel('Описание')).toHaveValue(
      taskDescriptions.cancel,
    )
    releaseFirstRequest?.()
    await expect(page.getByLabel('Название')).toHaveValue(taskTitles.cancel)
    await expect(page.getByLabel('Описание')).toHaveValue(
      taskDescriptions.cancel,
    )
  })

  test('missing and deleted task routes disclose no form data', async ({
    page,
  }) => {
    await login(page, 'manager')
    for (const taskId of [randomUUID(), taskIds.deleted]) {
      await page.goto(`/tasks/${taskId}/edit`)
      await expect(
        page.getByRole('heading', {
          name: 'Задача не найдена или недоступна',
        }),
      ).toBeVisible()
      await expect(page.getByLabel('Название')).toHaveCount(0)
    }

    await page.goto(`/projects/${projectIds.deleted}/tasks/new`)
    await expect(
      page.getByRole('heading', {
        name: 'Объект не найден или недоступен',
      }),
    ).toBeVisible()
    await expect(page.getByLabel('Название')).toHaveCount(0)
  })

  test('manager cancels and then confirms task soft-delete', async ({
    page,
  }) => {
    let patchRequests = 0
    const historyBefore = await adminClient!
      .from('task_status_history')
      .select('id', { count: 'exact' })
      .eq('task_id', taskIds.deletable)
    expect(historyBefore.count).toBeGreaterThan(0)

    await login(page, 'manager')
    await page.goto(`/projects/${projectIds.first}`)
    page.on('request', (request) => {
      if (
        request.method() === 'PATCH' &&
        request.url().includes('/rest/v1/tasks')
      ) {
        patchRequests += 1
      }
    })

    page.once('dialog', (dialog) => dialog.dismiss())
    await page
      .getByRole('button', {
        name: `Удалить задачу «${taskTitles.deletable}»`,
      })
      .click()
    expect(patchRequests).toBe(0)
    await expect(taskCard(page, taskTitles.deletable)).toBeVisible()
    const beforeDelete = await adminClient!
      .from('tasks')
      .select('deleted_at')
      .eq('id', taskIds.deletable)
      .single()
    expect(beforeDelete.data?.deleted_at).toBeNull()

    page.once('dialog', (dialog) => dialog.accept())
    await page
      .getByRole('button', {
        name: `Удалить задачу «${taskTitles.deletable}»`,
      })
      .click()
    await expect(taskCard(page, taskTitles.deletable)).toHaveCount(0)
    expect(patchRequests).toBe(1)

    const taskState = await adminClient!
      .from('tasks')
      .select('id, deleted_at')
      .eq('id', taskIds.deletable)
      .single()
    expect(taskState.error).toBeNull()
    expect(taskState.data?.id).toBe(taskIds.deletable)
    expect(taskState.data?.deleted_at).not.toBeNull()
    const historyAfter = await adminClient!
      .from('task_status_history')
      .select('id', { count: 'exact' })
      .eq('task_id', taskIds.deletable)
    expect(historyAfter.count).toBe(historyBefore.count)

    const localConfig = loadLocalSupabaseConfig()
    const executorClient = createTestClient(
      localConfig.apiUrl,
      localConfig.publishableKey,
    )
    const signIn = await executorClient.auth.signInWithPassword({
      email: emails.executor1,
      password,
    })
    expect(signIn.error).toBeNull()
    const hiddenTask = await executorClient
      .from('tasks')
      .select('id')
      .eq('id', taskIds.deletable)
    expect(hiddenTask.error).toBeNull()
    expect(hiddenTask.data).toEqual([])

    await page.goto(`/tasks/${taskIds.deletable}/edit`)
    await expect(
      page.getByRole('heading', {
        name: 'Задача не найдена или недоступна',
      }),
    ).toBeVisible()
  })

  test('task deletion API error does not report false success', async ({
    page,
  }) => {
    await login(page, 'manager')
    await page.goto(`/projects/${projectIds.first}`)
    await page.route('**/rest/v1/tasks*', async (route) => {
      if (route.request().method() === 'PATCH') {
        await route.fulfill({
          body: JSON.stringify({
            code: 'PGRST100',
            details: null,
            hint: null,
            message: 'synthetic failure',
          }),
          contentType: 'application/json',
          status: 400,
        })
        return
      }
      await route.continue()
    })
    page.once('dialog', (dialog) => dialog.accept())
    await page
      .getByRole('button', {
        name: `Удалить задачу «${taskTitles.deleteError}»`,
      })
      .click()
    await expect(taskCard(page, taskTitles.deleteError).getByRole('alert')).toHaveText(
      'Не удалось удалить задачу. Повторите попытку.',
    )
    await expect(taskCard(page, taskTitles.deleteError)).toBeVisible()
    const stored = await adminClient!
      .from('tasks')
      .select('deleted_at')
      .eq('id', taskIds.deleteError)
      .single()
    expect(stored.data?.deleted_at).toBeNull()
  })

  test('task form fits a 360px viewport', async ({ page }) => {
    await page.setViewportSize({ height: 740, width: 360 })
    await login(page, 'manager')
    await page.goto(`/projects/${projectIds.first}/tasks/new`)
    await expect(page.getByRole('heading', { name: 'Новая задача' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Сохранить' })).toBeVisible()
    expect(
      await page.evaluate<boolean>(
        'document.documentElement.scrollWidth <= window.innerWidth',
      ),
    ).toBe(true)
  })
})
