import { randomBytes, randomUUID } from 'node:crypto'
import { expect, test, type Page, type TestInfo } from '@playwright/test'
import {
  createTestClient,
  loadLocalSupabaseConfig,
  type TestSupabaseClient,
} from '../helpers/localSupabase.ts'

type UserName = 'manager' | 'executor'

test.describe('project management', () => {
  const runId = randomBytes(8).toString('hex')
  const password = `E2e6-${randomBytes(18).toString('base64url')}!`
  const emails: Record<UserName, string> = {
    executor: `stage6-${runId}-executor@example.test`,
    manager: `stage6-${runId}-manager@example.test`,
  }
  const userIds: Record<UserName, string> = { executor: '', manager: '' }
  const projectIds = {
    cancel: randomUUID(),
    deleteError: randomUUID(),
    deletable: randomUUID(),
    editable: randomUUID(),
    permission: randomUUID(),
  }
  const taskIds = {
    deletable: randomUUID(),
    permission: randomUUID(),
  }
  const projectNames = {
    cancel: `Отмена редактирования ${runId}`,
    deleteError: `Ошибка удаления ${runId}`,
    deletable: `Удаляемый объект ${runId}`,
    editable: `Редактируемый объект ${runId}`,
    permission: `Объект исполнителя ${runId}`,
  }
  const projectAddresses = {
    cancel: `Адрес отмены ${runId}`,
    deleteError: `Адрес ошибки удаления ${runId}`,
    deletable: `Адрес удаления ${runId}`,
    editable: `Адрес редактирования ${runId}`,
    permission: `Адрес исполнителя ${runId}`,
  }
  const createdUserIds: string[] = []
  const fixtureTaskIds = Object.values(taskIds)

  let adminClient: TestSupabaseClient | undefined
  let consoleErrors: string[] = []
  let pageErrors: string[] = []

  const cleanupFixtures = async () => {
    if (!adminClient) {
      return
    }

    const historyDelete = await adminClient
      .from('task_status_history')
      .delete()
      .in('task_id', fixtureTaskIds)
    if (historyDelete.error) {
      throw new Error('Failed to clean Stage 6 task history')
    }

    const taskDelete = await adminClient
      .from('tasks')
      .delete()
      .in('id', fixtureTaskIds)
    if (taskDelete.error) {
      throw new Error('Failed to clean Stage 6 tasks')
    }

    const ownProjects = await adminClient
      .from('projects')
      .select('id')
      .like('name', `%${runId}%`)
    if (ownProjects.error) {
      throw new Error('Failed to find Stage 6 projects for cleanup')
    }
    const ownProjectIds = ownProjects.data.map(({ id }) => id)
    if (ownProjectIds.length > 0) {
      const projectDelete = await adminClient
        .from('projects')
        .delete()
        .in('id', ownProjectIds)
      if (projectDelete.error) {
        throw new Error('Failed to clean Stage 6 projects')
      }
    }

    if (createdUserIds.length > 0) {
      const profileDelete = await adminClient
        .from('profiles')
        .delete()
        .in('id', createdUserIds)
      if (profileDelete.error) {
        throw new Error('Failed to clean Stage 6 profiles')
      }
    }

    while (createdUserIds.length > 0) {
      const userId = createdUserIds.at(-1)
      if (!userId) {
        break
      }
      const { error } = await adminClient.auth.admin.deleteUser(userId)
      if (error) {
        throw new Error('Failed to clean a Stage 6 auth user')
      }
      createdUserIds.pop()
    }

    const historyCheck = await adminClient
      .from('task_status_history')
      .select('id', { count: 'exact', head: true })
      .in('task_id', fixtureTaskIds)
    const taskCheck = await adminClient
      .from('tasks')
      .select('id', { count: 'exact', head: true })
      .in('id', fixtureTaskIds)
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
      throw new Error('Stage 6 database cleanup verification failed')
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
      for (const name of ['manager', 'executor'] as const) {
        const { data, error } = await adminClient.auth.admin.createUser({
          email: emails[name],
          email_confirm: true,
          password,
        })
        if (error || !data.user) {
          throw new Error(`Failed to create Stage 6 user ${name}`)
        }
        userIds[name] = data.user.id
        createdUserIds.push(data.user.id)
      }

      const profiles = await adminClient.from('profiles').insert([
        {
          display_name: `E2E6 Постановщик ${runId}`,
          id: userIds.manager,
          role: 'manager',
        },
        {
          display_name: `E2E6 Исполнитель ${runId}`,
          id: userIds.executor,
          role: 'executor',
        },
      ])
      if (profiles.error) {
        throw new Error('Failed to create Stage 6 profiles')
      }

      const projects = await adminClient.from('projects').insert(
        (Object.keys(projectIds) as Array<keyof typeof projectIds>).map(
          (key) => ({
            address: projectAddresses[key],
            id: projectIds[key],
            name: projectNames[key],
          }),
        ),
      )
      if (projects.error) {
        throw new Error('Failed to create Stage 6 projects')
      }

      const tasks = await adminClient.from('tasks').insert([
        {
          assignee_id: userIds.executor,
          created_by: userIds.manager,
          description: `Связанная задача ${runId}`,
          id: taskIds.deletable,
          project_id: projectIds.deletable,
          title: `Задача удаляемого объекта ${runId}`,
        },
        {
          assignee_id: userIds.executor,
          created_by: userIds.manager,
          description: `Задача для проверки прав ${runId}`,
          id: taskIds.permission,
          project_id: projectIds.permission,
          title: `Задача исполнителя ${runId}`,
        },
      ])
      if (tasks.error) {
        throw new Error('Failed to create Stage 6 tasks')
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

  test('manager sees project management actions', async ({ page }) => {
    await login(page, 'manager')
    await expect(
      page.getByRole('link', { name: 'Создать объект' }),
    ).toBeVisible()

    await page.goto(`/projects/${projectIds.permission}`)
    await expect(
      page.getByRole('link', { name: 'Редактировать', exact: true }),
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Удалить объект' }),
    ).toBeVisible()
  })

  test('executor cannot see actions or open management routes', async ({
    page,
  }) => {
    await login(page, 'executor')
    await expect(
      page.getByRole('link', { name: 'Создать объект' }),
    ).toHaveCount(0)

    await page.goto(`/projects/${projectIds.permission}`)
    await expect(
      page.getByRole('heading', { name: projectNames.permission }),
    ).toBeVisible()
    await expect(
      page.getByRole('link', { name: 'Редактировать' }),
    ).toHaveCount(0)
    await expect(
      page.getByRole('button', { name: 'Удалить объект' }),
    ).toHaveCount(0)

    for (const path of [
      '/projects/new',
      `/projects/${projectIds.permission}/edit`,
    ]) {
      await page.goto(path)
      await expect(
        page.getByRole('heading', { name: 'Недостаточно прав' }),
      ).toBeVisible()
      await expect(page.getByLabel('Название объекта')).toHaveCount(0)
      await expect(page.getByLabel('Адрес')).toHaveCount(0)
    }
  })

  test('manager validates and creates a trimmed project once', async ({
    page,
  }) => {
    const createdName = `Созданный объект ${runId}`
    const createdAddress = `Новый адрес ${runId}`
    await login(page, 'manager')
    await page.getByRole('link', { name: 'Создать объект' }).click()
    await expect(page).toHaveURL(/\/projects\/new$/)
    await expect(
      page.getByRole('heading', { name: 'Новый объект' }),
    ).toBeVisible()

    await page.getByRole('button', { name: 'Сохранить' }).click()
    expect(
      await page
        .getByLabel('Название объекта')
        .evaluate((input) => input.matches(':invalid')),
    ).toBe(true)

    await page.getByLabel('Название объекта').fill('   ')
    await page.getByLabel('Адрес').fill('   ')
    await page.getByLabel('Адрес').press('Enter')
    await expect(page.getByRole('alert')).toHaveText(
      'Заполните название объекта и адрес.',
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
    await page.route('**/rest/v1/projects*', async (route) => {
      if (route.request().method() === 'POST') {
        insertCount += 1
        markInsertStarted?.()
        await insertGate
      }
      await route.continue()
    })

    await page.getByLabel('Название объекта').fill(`  ${createdName}  `)
    await page.getByLabel('Адрес').fill(`  ${createdAddress}  `)
    await page.getByLabel('Адрес').press('Enter')
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

    await expect(page).toHaveURL(/\/projects\/[0-9a-f-]+$/)
    await expect(
      page.getByRole('heading', { level: 2, name: createdName }),
    ).toBeVisible()
    await expect(page.getByText(createdAddress)).toBeVisible()
    expect(insertCount).toBe(1)

    const stored = await adminClient!
      .from('projects')
      .select('id, name, address, deleted_at')
      .eq('name', createdName)
      .single()
    expect(stored.error).toBeNull()
    expect(stored.data).toMatchObject({
      address: createdAddress,
      deleted_at: null,
      name: createdName,
    })

    await page.reload()
    await expect(
      page.getByRole('heading', { level: 2, name: createdName }),
    ).toBeVisible()
    await expect(page.getByText(createdAddress)).toBeVisible()
  })

  test('manager edits a project and persisted values survive reload', async ({
    page,
  }) => {
    const updatedName = `Обновлённый объект ${runId}`
    const updatedAddress = `Обновлённый адрес ${runId}`
    await login(page, 'manager')
    await page.goto(`/projects/${projectIds.editable}/edit`)
    await expect(page.getByLabel('Название объекта')).toHaveValue(
      projectNames.editable,
    )
    await expect(page.getByLabel('Адрес')).toHaveValue(
      projectAddresses.editable,
    )

    await page.getByLabel('Название объекта').fill(` ${updatedName} `)
    await page.getByLabel('Адрес').fill(` ${updatedAddress} `)
    await page.getByLabel('Адрес').press('Enter')
    await expect(page).toHaveURL(
      new RegExp(`/projects/${projectIds.editable}$`),
    )
    await expect(
      page.getByRole('heading', { level: 2, name: updatedName }),
    ).toBeVisible()
    await expect(page.getByText(updatedAddress)).toBeVisible()

    const stored = await adminClient!
      .from('projects')
      .select('name, address')
      .eq('id', projectIds.editable)
      .single()
    expect(stored.error).toBeNull()
    expect(stored.data).toEqual({
      address: updatedAddress,
      name: updatedName,
    })

    await page.reload()
    await expect(
      page.getByRole('heading', { level: 2, name: updatedName }),
    ).toBeVisible()
    await expect(page.getByText(updatedAddress)).toBeVisible()
  })

  test('canceling edit leaves the project unchanged', async ({ page }) => {
    await login(page, 'manager')
    await page.goto(`/projects/${projectIds.cancel}/edit`)
    await page.getByLabel('Название объекта').fill(`Не сохранять ${runId}`)
    await page.getByLabel('Адрес').fill(`Не сохранять адрес ${runId}`)
    await page.getByRole('button', { name: 'Отмена' }).click()

    await expect(page).toHaveURL(
      new RegExp(`/projects/${projectIds.cancel}$`),
    )
    await expect(
      page.getByRole('heading', { level: 2, name: projectNames.cancel }),
    ).toBeVisible()
    const stored = await adminClient!
      .from('projects')
      .select('name, address')
      .eq('id', projectIds.cancel)
      .single()
    expect(stored.data).toEqual({
      address: projectAddresses.cancel,
      name: projectNames.cancel,
    })
  })

  test('edit API error preserves values and allows retry', async ({ page }) => {
    const retriedName = `После повтора ${runId}`
    const retriedAddress = `Адрес после повтора ${runId}`
    let failUpdate = true
    await login(page, 'manager')
    await page.goto(`/projects/${projectIds.deleteError}/edit`)
    await expect(page.getByLabel('Название объекта')).toHaveValue(
      projectNames.deleteError,
    )
    await page.route('**/rest/v1/projects*', async (route) => {
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

    await page.getByLabel('Название объекта').fill(retriedName)
    await page.getByLabel('Адрес').fill(retriedAddress)
    await page.getByRole('button', { name: 'Сохранить' }).click()
    await expect(page.getByRole('alert')).toHaveText(
      'Не удалось сохранить объект. Повторите попытку.',
    )
    await expect(page.getByLabel('Название объекта')).toHaveValue(retriedName)
    await expect(page.getByLabel('Адрес')).toHaveValue(retriedAddress)
    await expect(
      page.getByRole('button', { name: 'Сохранить' }),
    ).toBeEnabled()
    await expect(page.getByRole('status')).toHaveCount(0)

    failUpdate = false
    await page.getByRole('button', { name: 'Сохранить' }).click()
    await expect(
      page.getByRole('heading', { level: 2, name: retriedName }),
    ).toBeVisible()
    const stored = await adminClient!
      .from('projects')
      .select('name, address')
      .eq('id', projectIds.deleteError)
      .single()
    expect(stored.data).toEqual({
      address: retriedAddress,
      name: retriedName,
    })
  })

  test('missing project edit shows a neutral message', async ({ page }) => {
    await login(page, 'manager')
    await page.goto(`/projects/${randomUUID()}/edit`)
    await expect(
      page.getByRole('heading', {
        name: 'Объект не найден или недоступен',
      }),
    ).toBeVisible()
    await expect(page.getByLabel('Название объекта')).toHaveCount(0)
  })

  test('stale edit request cannot replace a newly opened project', async ({
    page,
  }) => {
    let releaseFirstRequest: (() => void) | undefined
    const firstRequestGate = new Promise<void>((resolve) => {
      releaseFirstRequest = resolve
    })
    await login(page, 'manager')
    await page.route('**/rest/v1/projects*', async (route) => {
      if (
        route.request().method() === 'GET' &&
        route.request().url().includes(projectIds.editable)
      ) {
        await firstRequestGate
      }
      await route.continue()
    })

    await page.goto(`/projects/${projectIds.editable}/edit`)
    await expect(page.getByRole('status')).toHaveText('Загрузка объекта…')
    await page.goto(`/projects/${projectIds.cancel}/edit`)
    await expect(page.getByLabel('Название объекта')).toHaveValue(
      projectNames.cancel,
    )
    await expect(page.getByLabel('Адрес')).toHaveValue(
      projectAddresses.cancel,
    )
    releaseFirstRequest?.()
    await expect(page.getByLabel('Название объекта')).toHaveValue(
      projectNames.cancel,
    )
    await expect(page.getByLabel('Адрес')).toHaveValue(
      projectAddresses.cancel,
    )
  })

  test('deletion API error keeps the current project available', async ({
    page,
  }) => {
    await login(page, 'manager')
    await page.goto(`/projects/${projectIds.cancel}`)
    await page.route('**/rest/v1/projects*', async (route) => {
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
    await page.getByRole('button', { name: 'Удалить объект' }).click()
    await expect(page.getByRole('alert')).toHaveText(
      'Не удалось удалить объект. Повторите попытку.',
    )
    await expect(page).toHaveURL(
      new RegExp(`/projects/${projectIds.cancel}$`),
    )
    await expect(
      page.getByRole('button', { name: 'Удалить объект' }),
    ).toBeEnabled()
    const stored = await adminClient!
      .from('projects')
      .select('deleted_at')
      .eq('id', projectIds.cancel)
      .single()
    expect(stored.data?.deleted_at).toBeNull()
  })

  test('manager cancels and then confirms project soft-delete', async ({
    page,
  }) => {
    let patchRequests = 0
    await login(page, 'manager')
    await page.goto(`/projects/${projectIds.deletable}`)
    page.on('request', (request) => {
      if (
        request.method() === 'PATCH' &&
        request.url().includes('/rest/v1/projects')
      ) {
        patchRequests += 1
      }
    })

    page.once('dialog', (dialog) => dialog.dismiss())
    await page.getByRole('button', { name: 'Удалить объект' }).click()
    expect(patchRequests).toBe(0)
    await expect(
      page.getByRole('heading', { name: projectNames.deletable }),
    ).toBeVisible()
    const beforeDelete = await adminClient!
      .from('projects')
      .select('deleted_at')
      .eq('id', projectIds.deletable)
      .single()
    expect(beforeDelete.data?.deleted_at).toBeNull()

    page.once('dialog', (dialog) => dialog.accept())
    await page.getByRole('button', { name: 'Удалить объект' }).click()
    await expect(page).toHaveURL(/\/projects$/)
    await expect(page.getByText(projectNames.deletable)).toHaveCount(0)
    expect(patchRequests).toBe(1)

    const projectState = await adminClient!
      .from('projects')
      .select('id, deleted_at')
      .eq('id', projectIds.deletable)
      .single()
    expect(projectState.error).toBeNull()
    expect(projectState.data?.id).toBe(projectIds.deletable)
    expect(projectState.data?.deleted_at).not.toBeNull()

    const taskState = await adminClient!
      .from('tasks')
      .select('id, project_id')
      .eq('id', taskIds.deletable)
      .single()
    expect(taskState.data).toEqual({
      id: taskIds.deletable,
      project_id: projectIds.deletable,
    })

    const localConfig = loadLocalSupabaseConfig()
    const executorClient = createTestClient(
      localConfig.apiUrl,
      localConfig.publishableKey,
    )
    const signIn = await executorClient.auth.signInWithPassword({
      email: emails.executor,
      password,
    })
    expect(signIn.error).toBeNull()
    const hiddenTask = await executorClient
      .from('tasks')
      .select('id')
      .eq('id', taskIds.deletable)
    expect(hiddenTask.error).toBeNull()
    expect(hiddenTask.data).toEqual([])

    await page.goto(`/projects/${projectIds.deletable}`)
    await expect(
      page.getByRole('heading', {
        name: 'Объект не найден или недоступен',
      }),
    ).toBeVisible()
  })

  test('project form fits a 360px viewport', async ({ page }) => {
    await page.setViewportSize({ height: 740, width: 360 })
    await login(page, 'manager')
    await page.goto('/projects/new')
    await expect(
      page.getByRole('heading', { name: 'Новый объект' }),
    ).toBeVisible()
    await expect(page.getByRole('button', { name: 'Сохранить' })).toBeVisible()
    expect(
      await page.evaluate<boolean>(
        'document.documentElement.scrollWidth <= window.innerWidth',
      ),
    ).toBe(true)
  })
})
