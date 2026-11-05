import { randomBytes, randomUUID } from 'node:crypto'
import { expect, test, type Page, type TestInfo } from '@playwright/test'
import {
  createTestClient,
  loadLocalSupabaseConfig,
  type TestSupabaseClient,
} from '../helpers/localSupabase.ts'

type UserName = 'manager' | 'executor1' | 'executor2' | 'withoutProfile'

test.describe.serial('Mini CRM authentication and project browsing', () => {
  const runId = randomBytes(8).toString('hex')
  const password = `E2e-${randomBytes(18).toString('base64url')}!`
  const emails: Record<UserName, string> = {
    executor1: `stage5-${runId}-executor1@example.test`,
    executor2: `stage5-${runId}-executor2@example.test`,
    manager: `stage5-${runId}-manager@example.test`,
    withoutProfile: `stage5-${runId}-without-profile@example.test`,
  }
  const userIds: Record<UserName, string> = {
    executor1: '',
    executor2: '',
    manager: '',
    withoutProfile: '',
  }
  const projectIds = {
    deleted: randomUUID(),
    empty: randomUUID(),
    executor1: randomUUID(),
    executor2: randomUUID(),
  }
  const taskIds = {
    accepted: randomUUID(),
    deletedProject: randomUUID(),
    executor2: randomUUID(),
    inProgress: randomUUID(),
    inReview: randomUUID(),
    new: randomUUID(),
    rework: randomUUID(),
  }
  const projectNames = {
    deleted: `Удалённый объект ${runId}`,
    empty: `Гамма пустой объект ${runId}`,
    executor1: `Альфа объект ${runId}`,
    executor2: `Бета объект ${runId}`,
  }
  const projectAddresses = {
    empty: 'Пустая улица, 3',
    executor1: 'Первая улица, 1',
    executor2: 'Вторая улица, 2',
  }
  const createdUserIds: string[] = []
  const createdProjectIds = Object.values(projectIds)
  const createdTaskIds = Object.values(taskIds)

  let adminClient: TestSupabaseClient | undefined
  let consoleErrors: string[] = []
  let pageErrors: string[] = []

  const cleanupFixtures = async () => {
    if (!adminClient) {
      return
    }

    if (createdTaskIds.length > 0) {
      const historyDelete = await adminClient
        .from('task_status_history')
        .delete()
        .in('task_id', createdTaskIds)
      if (historyDelete.error) {
        throw new Error('Failed to clean E2E task history')
      }
      const historyCheck = await adminClient
        .from('task_status_history')
        .select('id', { count: 'exact', head: true })
        .in('task_id', createdTaskIds)
      if (historyCheck.error || historyCheck.count !== 0) {
        throw new Error('E2E task history cleanup verification failed')
      }

      const taskDelete = await adminClient
        .from('tasks')
        .delete()
        .in('id', createdTaskIds)
      if (taskDelete.error) {
        throw new Error('Failed to clean E2E tasks')
      }
      const taskCheck = await adminClient
        .from('tasks')
        .select('id', { count: 'exact', head: true })
        .in('id', createdTaskIds)
      if (taskCheck.error || taskCheck.count !== 0) {
        throw new Error('E2E task cleanup verification failed')
      }
    }

    if (createdProjectIds.length > 0) {
      const projectDelete = await adminClient
        .from('projects')
        .delete()
        .in('id', createdProjectIds)
      if (projectDelete.error) {
        throw new Error('Failed to clean E2E projects')
      }
      const projectCheck = await adminClient
        .from('projects')
        .select('id', { count: 'exact', head: true })
        .in('id', createdProjectIds)
      if (projectCheck.error || projectCheck.count !== 0) {
        throw new Error('E2E project cleanup verification failed')
      }
    }

    if (createdUserIds.length > 0) {
      const profileDelete = await adminClient
        .from('profiles')
        .delete()
        .in('id', createdUserIds)
      if (profileDelete.error) {
        throw new Error('Failed to clean E2E profiles')
      }
      const profileCheck = await adminClient
        .from('profiles')
        .select('id', { count: 'exact', head: true })
        .in('id', createdUserIds)
      if (profileCheck.error || profileCheck.count !== 0) {
        throw new Error('E2E profile cleanup verification failed')
      }
    }

    while (createdUserIds.length > 0) {
      const userId = createdUserIds.at(-1)
      if (!userId) {
        break
      }
      const { error } = await adminClient.auth.admin.deleteUser(userId)
      if (error) {
        throw new Error('Failed to clean an E2E auth user')
      }
      createdUserIds.pop()
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

  const expectedConsoleErrors = (testInfo: TestInfo) => {
    const expectedStatus =
      testInfo.title.includes('wrong password') ||
      testInfo.title.includes('API error')
      ? '400'
      : testInfo.title.includes('network error')
        ? '503'
        : null
    if (expectedStatus) {
      return consoleErrors.filter(
        (message) =>
          !message.includes(
            `Failed to load resource: the server responded with a status of ${expectedStatus}`,
          ),
      )
    }
    return consoleErrors
  }

  test.beforeAll(async () => {
    const localConfig = loadLocalSupabaseConfig()
    adminClient = createTestClient(localConfig.apiUrl, localConfig.secretKey)

    try {
      for (const name of [
        'manager',
        'executor1',
        'executor2',
        'withoutProfile',
      ] as const) {
        const { data, error } = await adminClient.auth.admin.createUser({
          email: emails[name],
          email_confirm: true,
          password,
        })
        if (error || !data.user) {
          throw new Error(`Failed to create E2E user ${name}`)
        }
        userIds[name] = data.user.id
        createdUserIds.push(data.user.id)
      }

      const profiles = await adminClient.from('profiles').insert([
        {
          display_name: 'E2E Постановщик',
          id: userIds.manager,
          role: 'manager',
        },
        {
          display_name: 'E2E Исполнитель Один',
          id: userIds.executor1,
          role: 'executor',
        },
        {
          display_name: 'E2E Исполнитель Два',
          id: userIds.executor2,
          role: 'executor',
        },
      ])
      if (profiles.error) {
        throw new Error('Failed to create E2E profiles')
      }

      const projects = await adminClient.from('projects').insert([
        {
          address: projectAddresses.executor1,
          id: projectIds.executor1,
          name: projectNames.executor1,
        },
        {
          address: projectAddresses.executor2,
          id: projectIds.executor2,
          name: projectNames.executor2,
        },
        {
          address: projectAddresses.empty,
          id: projectIds.empty,
          name: projectNames.empty,
        },
        {
          address: 'Удалённая улица, 4',
          deleted_at: new Date().toISOString(),
          id: projectIds.deleted,
          name: projectNames.deleted,
        },
      ])
      if (projects.error) {
        throw new Error('Failed to create E2E projects')
      }

      const tasks = await adminClient.from('tasks').insert([
        {
          assignee_id: userIds.executor1,
          created_by: userIds.manager,
          description: 'Новая задача',
          id: taskIds.new,
          project_id: projectIds.executor1,
          status: 'new',
          title: 'Задача 1 — новая',
        },
        {
          assignee_id: userIds.executor1,
          created_by: userIds.manager,
          description: 'Задача в работе',
          id: taskIds.inProgress,
          project_id: projectIds.executor1,
          status: 'in_progress',
          title: 'Задача 2 — в работе',
        },
        {
          assignee_id: userIds.executor1,
          created_by: userIds.manager,
          description: 'Задача на проверке',
          id: taskIds.inReview,
          project_id: projectIds.executor1,
          status: 'in_review',
          title: 'Задача 3 — на проверке',
        },
        {
          assignee_id: userIds.executor1,
          created_by: userIds.manager,
          description: 'Принятая задача',
          id: taskIds.accepted,
          project_id: projectIds.executor1,
          status: 'accepted',
          title: 'Задача 4 — принята',
        },
        {
          assignee_id: userIds.executor1,
          created_by: userIds.manager,
          description: 'Задача на доработке',
          id: taskIds.rework,
          project_id: projectIds.executor1,
          status: 'rework',
          title: 'Задача 5 — на доработке',
        },
        {
          assignee_id: userIds.executor2,
          created_by: userIds.manager,
          description: 'Задача второго исполнителя',
          id: taskIds.executor2,
          project_id: projectIds.executor2,
          status: 'new',
          title: 'Задача второго исполнителя',
        },
        {
          assignee_id: userIds.executor1,
          created_by: userIds.manager,
          description: 'Задача удалённого объекта',
          id: taskIds.deletedProject,
          project_id: projectIds.deleted,
          status: 'new',
          title: 'Скрытая задача',
        },
      ])
      if (tasks.error) {
        throw new Error('Failed to create E2E tasks')
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
    expect(expectedConsoleErrors(testInfo)).toEqual([])
    expect(pageErrors).toEqual([])
  })

  test('redirects an unauthenticated user to the login form', async ({
    page,
  }) => {
    const response = await page.goto('/')
    expect(response?.ok()).toBe(true)
    await expect(page.locator('link[rel="icon"]')).toHaveAttribute(
      'href',
      '/favicon.svg',
    )
    const faviconResponse = await page.request.get('/favicon.svg')
    expect(faviconResponse.ok()).toBe(true)
    expect(faviconResponse.headers()['content-type']).toContain(
      'image/svg+xml',
    )
    await expect(page).toHaveURL(/\/login$/)
    await expect(page.getByText('Mini CRM')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Вход' })).toBeVisible()
    await expect(page.getByLabel('Email')).toBeVisible()
    await expect(page.getByLabel('Пароль')).toBeVisible()

    await page.goto('/projects')
    await expect(page).toHaveURL(/\/login$/)
  })

  test('requires fields and shows an error for a wrong password submitted by Enter', async ({
    page,
  }) => {
    await page.goto('/login')
    await page.getByRole('button', { name: 'Войти' }).click()
    expect(await page.getByLabel('Email').evaluate((input) => input.matches(':invalid'))).toBe(true)

    await page.getByLabel('Email').fill(emails.manager)
    await page.getByLabel('Пароль').fill(`${password}-wrong`)
    await page.getByLabel('Пароль').press('Enter')
    await expect(page.getByRole('alert')).toHaveText(
      'Неверный email или пароль.',
    )
    await expect(page.getByRole('button', { name: 'Войти' })).toBeEnabled()
  })

  test('shows a friendly login network error and stops the progress state', async ({
    page,
  }) => {
    await page.route('**/auth/v1/token?grant_type=password', async (route) => {
      await route.fulfill({
        body: JSON.stringify({ message: 'synthetic failure' }),
        contentType: 'application/json',
        status: 503,
      })
    })
    await page.goto('/login')
    await page.getByLabel('Email').fill(emails.manager)
    await page.getByLabel('Пароль').fill(password)
    await page.getByRole('button', { name: 'Войти' }).click()
    await expect(page.getByRole('alert')).toContainText(
      'Не удалось подключиться к серверу',
    )
    await expect(page.getByRole('button', { name: 'Войти' })).toBeEnabled()
    await expect(page.getByRole('status')).toHaveCount(0)
  })

  test('signs a manager in and shows the manager profile and role', async ({
    page,
  }) => {
    await login(page, 'manager')
    await expect(page.getByText('E2E Постановщик')).toBeVisible()
    await expect(page.getByText('Постановщик', { exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Объекты' })).toBeVisible()
  })

  test('signs an executor in and shows the executor profile and role', async ({
    page,
  }) => {
    await login(page, 'executor1')
    await expect(page.getByText('E2E Исполнитель Один')).toBeVisible()
    await expect(page.getByText('Исполнитель', { exact: true })).toBeVisible()
  })

  test('restores the session after reload', async ({ page }) => {
    await login(page, 'manager')
    await page.reload()
    await expect(page).toHaveURL(/\/projects$/)
    await expect(page.getByText('E2E Постановщик')).toBeVisible()
    await expect(
      page.getByRole('heading', { level: 2, name: 'Объекты' }),
    ).toBeVisible()
  })

  test('opens protected routes directly and redirects authenticated login route', async ({
    page,
  }) => {
    await login(page, 'manager')
    await page.goto('/projects')
    await expect(
      page.getByRole('heading', { level: 2, name: 'Объекты' }),
    ).toBeVisible()
    await page.goto('/login')
    await expect(page).toHaveURL(/\/projects$/)
  })

  test('signs out, blocks protected routes and does not retain previous user data', async ({
    page,
  }) => {
    await login(page, 'manager')
    await page.getByRole('button', { name: 'Выйти' }).click()
    await expect(page).toHaveURL(/\/login$/)
    await page.goto('/projects')
    await expect(page).toHaveURL(/\/login$/)

    await page.getByLabel('Email').fill(emails.executor1)
    await page.getByLabel('Пароль').fill(password)
    await page.getByRole('button', { name: 'Войти' }).click()
    await expect(page).toHaveURL(/\/projects$/)
    await expect(page.getByText('E2E Исполнитель Один')).toBeVisible()
    await expect(page.getByText('E2E Постановщик')).toHaveCount(0)
  })

  test('blocks an authenticated user without a profile', async ({ page }) => {
    await page.goto('/login')
    await page.getByLabel('Email').fill(emails.withoutProfile)
    await page.getByLabel('Пароль').fill(password)
    await page.getByRole('button', { name: 'Войти' }).click()
    await expect(
      page.getByRole('heading', { name: 'Доступ к CRM недоступен' }),
    ).toBeVisible()
    await expect(page.getByRole('alert')).toContainText(
      'Профиль пользователя не найден',
    )
    await expect(page.getByRole('link', { name: 'Объекты' })).toHaveCount(0)
  })

  test('shows every active project to the manager in name order', async ({
    page,
  }) => {
    await login(page, 'manager')
    const headings = page.locator('.project-card h3').filter({ hasText: runId })
    await expect(headings).toHaveText([
      projectNames.executor1,
      projectNames.executor2,
      projectNames.empty,
    ])
    await expect(page.getByText(projectNames.deleted)).toHaveCount(0)
  })

  test('shows only executor1 projects through RLS', async ({ page }) => {
    await login(page, 'executor1')
    await expect(page.getByText(projectNames.executor1)).toBeVisible()
    await expect(page.getByText(projectNames.executor2)).toHaveCount(0)
    await expect(page.getByText(projectNames.empty)).toHaveCount(0)
    await expect(page.getByText(projectNames.deleted)).toHaveCount(0)
  })

  test('shows only executor2 projects through RLS', async ({ page }) => {
    await login(page, 'executor2')
    await expect(page.getByText(projectNames.executor2)).toBeVisible()
    await expect(page.getByText(projectNames.executor1)).toHaveCount(0)
    await expect(page.getByText(projectNames.empty)).toHaveCount(0)
  })

  test('shows an accessible project, tasks, assignee and translated statuses', async ({
    page,
  }) => {
    await login(page, 'manager')
    await page
      .locator('.project-card')
      .filter({ hasText: projectNames.executor1 })
      .getByRole('link', { name: 'Открыть объект' })
      .click()
    await expect(
      page.getByRole('heading', { level: 2, name: projectNames.executor1 }),
    ).toBeVisible()
    await expect(page.getByText(projectAddresses.executor1)).toBeVisible()
    await expect(page.getByText('Задача 1 — новая')).toBeVisible()
    await expect(
      page.getByText('Исполнитель: E2E Исполнитель Один').first(),
    ).toBeVisible()
    for (const status of [
      'Новая',
      'В работе',
      'На проверке',
      'Принята',
      'На доработке',
    ]) {
      await expect(page.getByText(status, { exact: true })).toBeVisible()
    }
    await expect(
      page.getByRole('link', { name: 'К списку объектов' }),
    ).toBeVisible()
  })

  test('does not disclose another executor project by known UUID', async ({
    page,
  }) => {
    await login(page, 'executor1')
    await page.goto(`/projects/${projectIds.executor2}`)
    await expect(
      page.getByRole('heading', {
        name: 'Объект не найден или недоступен',
      }),
    ).toBeVisible()
    await expect(page.getByText(projectNames.executor2)).toHaveCount(0)
    await expect(page.getByText(projectAddresses.executor2)).toHaveCount(0)
  })

  test('shows a neutral message for a nonexistent project UUID', async ({
    page,
  }) => {
    await login(page, 'manager')
    await page.goto(`/projects/${randomUUID()}`)
    await expect(
      page.getByRole('heading', {
        name: 'Объект не найден или недоступен',
      }),
    ).toBeVisible()
  })

  test('shows an empty task state for an active project without tasks', async ({
    page,
  }) => {
    await login(page, 'manager')
    await page.goto(`/projects/${projectIds.empty}`)
    await expect(
      page.getByRole('heading', { level: 2, name: projectNames.empty }),
    ).toBeVisible()
    await expect(page.getByText('Нет задач', { exact: true })).toBeVisible()
  })

  test('shows project loading while the API request is pending', async ({
    page,
  }) => {
    let releaseRequest: (() => void) | undefined
    const requestGate = new Promise<void>((resolve) => {
      releaseRequest = resolve
    })
    await page.route('**/rest/v1/projects*', async (route) => {
      await requestGate
      await route.continue()
    })

    await page.goto('/login')
    await page.getByLabel('Email').fill(emails.manager)
    await page.getByLabel('Пароль').fill(password)
    await page.getByRole('button', { name: 'Войти' }).click()
    await expect(page).toHaveURL(/\/projects$/)
    await expect(page.getByRole('status')).toHaveText('Загрузка объектов…')
    releaseRequest?.()
    await expect(page.getByText(projectNames.executor1)).toBeVisible()
  })

  test('recovers from a project API error without infinite loading', async ({
    page,
  }) => {
    let failRequest = true
    await page.route('**/rest/v1/projects*', async (route) => {
      if (failRequest) {
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

    await page.goto('/login')
    await page.getByLabel('Email').fill(emails.manager)
    await page.getByLabel('Пароль').fill(password)
    await page.getByRole('button', { name: 'Войти' }).click()
    await expect(page.getByRole('alert')).toContainText(
      'Не удалось загрузить объекты',
    )
    await expect(page.getByRole('status')).toHaveCount(0)
    failRequest = false
    await page.getByRole('button', { name: 'Повторить' }).click()
    await expect(page.getByText(projectNames.executor1)).toBeVisible()
  })

  test('works at a 360px mobile viewport', async ({ page }) => {
    await page.setViewportSize({ height: 740, width: 360 })
    await login(page, 'executor1')
    await expect(page.getByText('E2E Исполнитель Один')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Выйти' })).toBeVisible()
    await expect(page.getByText(projectNames.executor1)).toBeVisible()
    expect(
      await page.evaluate<boolean>(
        'document.documentElement.scrollWidth <= window.innerWidth',
      ),
    ).toBe(true)
  })

  test('shows a simple page for an unknown route', async ({ page }) => {
    await page.goto('/unknown-route')
    await expect(
      page.getByRole('heading', { name: 'Страница не найдена' }),
    ).toBeVisible()
  })
})
