import { randomBytes, randomUUID } from 'node:crypto'
import { expect, test, type Page, type TestInfo } from '@playwright/test'
import {
  createTestClient,
  loadLocalSupabaseConfig,
  type TestSupabaseClient,
} from '../helpers/localSupabase.ts'

type UserName = 'manager1' | 'manager2' | 'executor1' | 'executor2'

test.describe.serial('Stage 8 task card, history and transitions', () => {
  const runId = randomBytes(8).toString('hex')
  const password = `E2e8-${randomBytes(18).toString('base64url')}!`
  const emails: Record<UserName, string> = {
    executor1: `stage8-${runId}-executor1@example.test`,
    executor2: `stage8-${runId}-executor2@example.test`,
    manager1: `stage8-${runId}-manager1@example.test`,
    manager2: `stage8-${runId}-manager2@example.test`,
  }
  const names: Record<UserName, string> = {
    executor1: `E2E8 Исполнитель Альфа ${runId}`,
    executor2: `E2E8 Исполнитель Бета ${runId}`,
    manager1: `E2E8 Постановщик Альфа ${runId}`,
    manager2: `E2E8 Постановщик Бета ${runId}`,
  }
  const userIds: Record<UserName, string> = {
    executor1: '',
    executor2: '',
    manager1: '',
    manager2: '',
  }
  const projectIds = {
    deleted: randomUUID(),
    first: randomUUID(),
    second: randomUUID(),
  }
  const projectNames = {
    deleted: `E2E8 Удалённый объект ${runId}`,
    first: `E2E8 Основной объект ${runId}`,
    second: `E2E8 Второй объект ${runId}`,
  }
  const taskIds = {
    deleted: randomUUID(),
    deletedProject: randomUUID(),
    foreign: randomUUID(),
    lifecycle: randomUUID(),
    reassigned: randomUUID(),
    stale: randomUUID(),
  }
  const taskTitles = {
    deleted: `E2E8 Удалённая задача ${runId}`,
    deletedProject: `E2E8 Задача удалённого объекта ${runId}`,
    foreign: `E2E8 Чужая задача ${runId}`,
    lifecycle: `E2E8 Полный цикл ${runId}`,
    reassigned: `E2E8 Переназначение ${runId}`,
    stale: `E2E8 Конкурентный статус ${runId}`,
  }
  const descriptions = {
    deleted: `Удалённое описание ${runId}`,
    deletedProject: `Описание удалённого объекта ${runId}`,
    foreign: `Чужое описание ${runId}`,
    lifecycle: `Описание полного цикла ${runId}`,
    reassigned: `Описание переназначения ${runId}`,
    stale: `Описание конкурентного статуса ${runId}`,
  }
  const createdUserIds: string[] = []
  const userClients: Partial<Record<UserName, TestSupabaseClient>> = {}
  let adminClient: TestSupabaseClient | undefined
  let consoleErrors: string[] = []
  let pageErrors: string[] = []

  const userClient = (name: UserName) => {
    const value = userClients[name]
    if (!value) {
      throw new Error(`Stage 8 E2E client ${name} is unavailable`)
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
      throw new Error('Failed to clean Stage 8 E2E history')
    }
    const taskDelete = await adminClient
      .from('tasks')
      .delete()
      .in('id', ownTaskIds)
    if (taskDelete.error) {
      throw new Error('Failed to clean Stage 8 E2E tasks')
    }
    const projectDelete = await adminClient
      .from('projects')
      .delete()
      .in('id', Object.values(projectIds))
    if (projectDelete.error) {
      throw new Error('Failed to clean Stage 8 E2E projects')
    }
    if (createdUserIds.length > 0) {
      const profileDelete = await adminClient
        .from('profiles')
        .delete()
        .in('id', createdUserIds)
      if (profileDelete.error) {
        throw new Error('Failed to clean Stage 8 E2E profiles')
      }
    }
    for (const userId of [...createdUserIds].reverse()) {
      const deletion = await adminClient.auth.admin.deleteUser(userId)
      if (deletion.error) {
        throw new Error('Failed to clean a Stage 8 E2E auth user')
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
      throw new Error('Stage 8 E2E cleanup verification failed')
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

  const openTask = async (page: Page, taskId: string) => {
    await page.goto(`/tasks/${taskId}`)
    await expect(page.getByRole('status')).toHaveCount(0)
  }

  const expectTaskState = async (
    taskId: string,
    status: string,
    historyCount: number,
  ) => {
    const [task, history] = await Promise.all([
      adminClient!.from('tasks').select('status').eq('id', taskId).single(),
      adminClient!
        .from('task_status_history')
        .select('id', { count: 'exact', head: true })
        .eq('task_id', taskId),
    ])
    expect(task.error).toBeNull()
    expect(task.data?.status).toBe(status)
    expect(history.error).toBeNull()
    expect(history.count).toBe(historyCount)
  }

  const expectCardStatus = async (page: Page, status: string) => {
    await expect(page.locator('.task-details-card .status-label')).toHaveText(
      status,
    )
  }

  test.beforeAll(async () => {
    const config = loadLocalSupabaseConfig()
    adminClient = createTestClient(config.apiUrl, config.secretKey)

    try {
      for (const name of [
        'manager1',
        'manager2',
        'executor1',
        'executor2',
      ] as const) {
        const created = await adminClient.auth.admin.createUser({
          email: emails[name],
          email_confirm: true,
          password,
        })
        if (created.error || !created.data.user) {
          throw new Error(`Failed to create Stage 8 E2E user ${name}`)
        }
        userIds[name] = created.data.user.id
        createdUserIds.push(created.data.user.id)

        const client = createTestClient(config.apiUrl, config.publishableKey)
        const signIn = await client.auth.signInWithPassword({
          email: emails[name],
          password,
        })
        if (signIn.error) {
          throw new Error(`Failed to authenticate Stage 8 E2E user ${name}`)
        }
        userClients[name] = client
      }

      const profiles = await adminClient.from('profiles').insert(
        (Object.keys(userIds) as UserName[]).map((name) => ({
          display_name: names[name],
          id: userIds[name],
          role: name.startsWith('manager') ? 'manager' : 'executor',
        })),
      )
      if (profiles.error) {
        throw new Error('Failed to create Stage 8 E2E profiles')
      }

      const projects = await adminClient.from('projects').insert([
        {
          address: `Основной адрес ${runId}`,
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
        throw new Error('Failed to create Stage 8 E2E projects')
      }

      const tasks = await adminClient.from('tasks').insert([
        {
          assignee_id: userIds.executor1,
          created_by: userIds.manager1,
          description: descriptions.lifecycle,
          id: taskIds.lifecycle,
          project_id: projectIds.first,
          title: taskTitles.lifecycle,
        },
        {
          assignee_id: userIds.executor2,
          created_by: userIds.manager2,
          description: descriptions.foreign,
          id: taskIds.foreign,
          project_id: projectIds.second,
          title: taskTitles.foreign,
        },
        {
          assignee_id: userIds.executor1,
          created_by: userIds.manager1,
          description: descriptions.stale,
          id: taskIds.stale,
          project_id: projectIds.first,
          title: taskTitles.stale,
        },
        {
          assignee_id: userIds.executor1,
          created_by: userIds.manager1,
          description: descriptions.reassigned,
          id: taskIds.reassigned,
          project_id: projectIds.first,
          title: taskTitles.reassigned,
        },
        {
          assignee_id: userIds.executor1,
          created_by: userIds.manager1,
          deleted_at: new Date().toISOString(),
          description: descriptions.deleted,
          id: taskIds.deleted,
          project_id: projectIds.first,
          title: taskTitles.deleted,
        },
        {
          assignee_id: userIds.executor1,
          created_by: userIds.manager1,
          description: descriptions.deletedProject,
          id: taskIds.deletedProject,
          project_id: projectIds.deleted,
          title: taskTitles.deletedProject,
        },
      ])
      if (tasks.error) {
        throw new Error('Failed to create Stage 8 E2E tasks')
      }

      for (const [status, comment] of [
        ['in_progress', null],
        ['in_review', 'Готово для конкурентной проверки'],
      ] as const) {
        const transition = await userClient('executor1').rpc(
          'transition_task',
          {
            p_comment: comment,
            p_new_status: status,
            p_task_id: taskIds.stale,
          },
        )
        if (transition.error) {
          throw new Error('Failed to prepare Stage 8 stale task')
        }
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
    const expectsFailedRequest =
      testInfo.title.includes('error') ||
      testInfo.title.includes('concurrent status')
    const unexpected = expectsFailedRequest
      ? consoleErrors.filter(
          (message) =>
            !message.includes(
              'Failed to load resource: the server responded with a status of',
            ),
        )
      : consoleErrors
    expect(unexpected).toEqual([])
    expect(pageErrors).toEqual([])
  })

  test('manager opens a complete card from the project and inaccessible routes stay neutral', async ({
    page,
  }) => {
    await login(page, 'manager1')
    await page.goto(`/projects/${projectIds.first}`)
    await page
      .getByRole('link', { exact: true, name: taskTitles.lifecycle })
      .click()
    await expect(page).toHaveURL(new RegExp(`/tasks/${taskIds.lifecycle}$`))
    await expect(
      page.getByRole('heading', { level: 2, name: taskTitles.lifecycle }),
    ).toBeVisible()
    await expect(page.locator('.task-details-card')).toContainText(
      descriptions.lifecycle,
    )
    await expect(page.locator('.task-details-card')).toContainText(
      projectNames.first,
    )
    await expect(page.locator('.task-details-card')).toContainText(
      names.executor1,
    )
    await expect(page.locator('.task-details-card')).toContainText(
      names.manager1,
    )
    await expect(page.locator('.task-details-card time')).toHaveCount(1)
    await expectCardStatus(page, 'Новая')
    await expect(
      page.getByRole('link', { name: 'Редактировать задачу' }),
    ).toBeVisible()
    await expect(page.locator('.history-event')).toHaveCount(1)
    await expect(page.locator('.history-event')).toContainText(
      'Создание задачи',
    )
    await expect(page.locator('.history-event')).toContainText(
      'Исходный статус: отсутствует · Новый статус: Новая',
    )
    await expect(page.locator('.history-event')).toContainText(names.manager1)
    await expect(page.getByText('Нет доступных действий')).toBeVisible()

    await page.reload()
    await expectCardStatus(page, 'Новая')
    await expect(page.locator('.history-event')).toHaveCount(1)
    await page.getByRole('link', { name: '← К объекту' }).click()
    await expect(page).toHaveURL(new RegExp(`/projects/${projectIds.first}$`))

    for (const taskId of [
      randomUUID(),
      taskIds.deleted,
      taskIds.deletedProject,
    ]) {
      await openTask(page, taskId)
      await expect(
        page.getByRole('heading', {
          name: 'Задача не найдена или недоступна',
        }),
      ).toBeVisible()
      await expect(page.getByRole('heading', { name: 'История изменений' }))
        .toHaveCount(0)
    }

    await page.setViewportSize({ height: 740, width: 360 })
    await openTask(page, taskIds.lifecycle)
    expect(
      await page.evaluate<boolean>(
        'document.documentElement.scrollWidth <= window.innerWidth',
      ),
    ).toBe(true)
  })

  test('executor sees only the assigned card, manager names and executor actions', async ({
    page,
  }) => {
    await login(page, 'executor1')
    await openTask(page, taskIds.lifecycle)
    await expectCardStatus(page, 'Новая')
    await expect(page.locator('.task-details-card')).toContainText(
      names.manager1,
    )
    await expect(page.locator('.history-event')).toContainText(names.manager1)
    await expect(
      page.getByRole('button', { name: 'Взять в работу' }),
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Принять задачу' }),
    ).toHaveCount(0)
    await expect(
      page.getByRole('button', { name: 'Вернуть на доработку' }),
    ).toHaveCount(0)
    await expect(
      page.getByRole('link', { name: 'Редактировать задачу' }),
    ).toHaveCount(0)

    await openTask(page, taskIds.foreign)
    await expect(
      page.getByRole('heading', {
        name: 'Задача не найдена или недоступна',
      }),
    ).toBeVisible()
    await expect(page.getByText(descriptions.foreign)).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'История изменений' }))
      .toHaveCount(0)
  })

  test('history loading error has an explicit retry state', async ({ page }) => {
    await login(page, 'manager1')
    await page.route('**/rest/v1/rpc/get_task_history', async (route) => {
      await route.fulfill({
        body: JSON.stringify({ message: 'synthetic history failure' }),
        contentType: 'application/json',
        status: 500,
      })
    })
    await openTask(page, taskIds.lifecycle)
    await expect(
      page.getByRole('heading', { name: taskTitles.lifecycle }),
    ).toBeVisible()
    await expect(page.getByRole('alert')).toContainText(
      'Не удалось загрузить историю задачи.',
    )
    await page.unroute('**/rest/v1/rpc/get_task_history')
    await page.getByRole('button', { name: 'Повторить' }).click()
    await expect(page.locator('.history-event')).toHaveCount(1)
  })

  test('full lifecycle, validation, error handling and duplicate protection produce seven events', async ({
    page,
  }) => {
    await login(page, 'executor1')
    await openTask(page, taskIds.lifecycle)

    let transitionRequests = 0
    let releaseRequest: (() => void) | undefined
    const requestGate = new Promise<void>((resolve) => {
      releaseRequest = resolve
    })
    await page.route('**/rest/v1/rpc/transition_task', async (route) => {
      transitionRequests += 1
      await requestGate
      await route.continue()
    })
    const startButton = page.getByRole('button', { name: 'Взять в работу' })
    await startButton.click()
    await expect(page.getByRole('status')).toHaveText('Изменение статуса…')
    await page.locator('.transition-actions button').first().dispatchEvent('click')
    expect(transitionRequests).toBe(1)
    releaseRequest?.()
    await expectCardStatus(page, 'В работе')
    await expect(page.locator('.history-event')).toHaveCount(2)
    await expectTaskState(taskIds.lifecycle, 'in_progress', 2)

    await page.getByLabel('Комментарий к переходу').fill('Готово к проверке')
    await page.getByRole('button', { name: 'Отправить на проверку' }).click()
    await expectCardStatus(page, 'На проверке')
    await expect(page.locator('.history-event')).toHaveCount(3)
    await expectTaskState(taskIds.lifecycle, 'in_review', 3)

    await login(page, 'manager1')
    await openTask(page, taskIds.lifecycle)
    await expect(
      page.getByRole('button', { name: 'Принять задачу' }),
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Вернуть на доработку' }),
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Взять в работу' }),
    ).toHaveCount(0)

    const rework = page.getByRole('button', { name: 'Вернуть на доработку' })
    await rework.click()
    await expect(page.getByRole('alert')).toHaveText(
      'Добавьте комментарий для возврата на доработку.',
    )
    await page.getByLabel('Комментарий к переходу').fill('   ')
    await rework.click()
    await expect(page.getByRole('alert')).toHaveText(
      'Добавьте комментарий для возврата на доработку.',
    )
    await expectTaskState(taskIds.lifecycle, 'in_review', 3)

    const reworkComment = `Исправьте узел ${runId}`
    await page.getByLabel('Комментарий к переходу').fill(reworkComment)
    let failOnce = true
    await page.route('**/rest/v1/rpc/transition_task', async (route) => {
      if (failOnce) {
        failOnce = false
        await route.fulfill({
          body: JSON.stringify({ message: 'synthetic transition failure' }),
          contentType: 'application/json',
          status: 409,
        })
        return
      }
      await route.continue()
    })
    await rework.click()
    await expect(page.getByRole('alert')).toContainText(
      'Не удалось изменить статус.',
    )
    await expect(page.getByLabel('Комментарий к переходу')).toHaveValue(
      reworkComment,
    )
    await expectCardStatus(page, 'На проверке')
    await expect(rework).toBeEnabled()
    await expectTaskState(taskIds.lifecycle, 'in_review', 3)

    await rework.click()
    await page.unroute('**/rest/v1/rpc/transition_task')
    await expectCardStatus(page, 'На доработке')
    await expect(page.locator('.history-event')).toHaveCount(4)
    await expect(page.locator('.history-event').last()).toContainText(
      reworkComment,
    )
    await expectTaskState(taskIds.lifecycle, 'rework', 4)

    await login(page, 'executor1')
    await openTask(page, taskIds.lifecycle)
    await page.getByRole('button', { name: 'Продолжить работу' }).click()
    await expectCardStatus(page, 'В работе')
    await expect(page.locator('.history-event')).toHaveCount(5)
    await expectTaskState(taskIds.lifecycle, 'in_progress', 5)

    await page.getByRole('button', { name: 'Отправить на проверку' }).click()
    await expectCardStatus(page, 'На проверке')
    await expect(page.locator('.history-event')).toHaveCount(6)
    await expectTaskState(taskIds.lifecycle, 'in_review', 6)

    await login(page, 'manager1')
    await openTask(page, taskIds.lifecycle)
    await page.getByRole('button', { name: 'Принять задачу' }).click()
    await expectCardStatus(page, 'Принята')
    await expect(page.locator('.history-event')).toHaveCount(7)
    await expect(page.getByText('Нет доступных действий')).toBeVisible()
    await expectTaskState(taskIds.lifecycle, 'accepted', 7)

    const storedHistory = await adminClient!
      .from('task_status_history')
      .select(
        'actor_id, from_status, to_status, comment, created_at',
      )
      .eq('task_id', taskIds.lifecycle)
      .order('created_at')
      .order('id')
    expect(storedHistory.error).toBeNull()
    expect(storedHistory.data).toHaveLength(7)
    expect(storedHistory.data?.map(({ to_status }) => to_status)).toEqual([
      'new',
      'in_progress',
      'in_review',
      'rework',
      'in_progress',
      'in_review',
      'accepted',
    ])
    expect(storedHistory.data?.map(({ from_status }) => from_status)).toEqual([
      null,
      'new',
      'in_progress',
      'in_review',
      'rework',
      'in_progress',
      'in_review',
    ])
    expect(storedHistory.data?.map(({ actor_id }) => actor_id)).toEqual([
      userIds.manager1,
      userIds.executor1,
      userIds.executor1,
      userIds.manager1,
      userIds.executor1,
      userIds.executor1,
      userIds.manager1,
    ])
    expect(
      storedHistory.data?.every(({ created_at }) => Boolean(created_at)),
    ).toBe(true)
    expect(
      storedHistory.data?.find(({ to_status }) => to_status === 'rework')
        ?.comment,
    ).toBe(reworkComment)

    await page.reload()
    await expectCardStatus(page, 'Принята')
    await expect(page.locator('.history-event')).toHaveCount(7)
  })

  test('concurrent status failure keeps stale UI until explicit refresh', async ({
    page,
  }) => {
    await login(page, 'manager1')
    await openTask(page, taskIds.stale)
    await expectCardStatus(page, 'На проверке')
    const accepted = await userClient('manager2').rpc('transition_task', {
      p_comment: null,
      p_new_status: 'accepted',
      p_task_id: taskIds.stale,
    })
    expect(accepted.error).toBeNull()

    const staleComment = `Устаревший комментарий ${runId}`
    await page.getByLabel('Комментарий к переходу').fill(staleComment)
    await page.getByRole('button', { name: 'Вернуть на доработку' }).click()
    await expect(page.getByRole('alert')).toContainText(
      'Состояние задачи могло измениться.',
    )
    await expectCardStatus(page, 'На проверке')
    await expect(page.getByLabel('Комментарий к переходу')).toHaveValue(
      staleComment,
    )
    await expectTaskState(taskIds.stale, 'accepted', 4)

    await page.getByRole('button', { name: 'Обновить данные' }).click()
    await expectCardStatus(page, 'Принята')
    await expect(page.getByText('Нет доступных действий')).toBeVisible()
    await expect(page.locator('.history-event')).toHaveCount(4)
  })

  test('former executor loses the card and history after reassignment', async ({
    page,
  }) => {
    await login(page, 'executor1')
    await openTask(page, taskIds.reassigned)
    await expect(
      page.getByRole('heading', { name: taskTitles.reassigned }),
    ).toBeVisible()
    await expect(page.locator('.history-event')).toContainText(names.manager1)

    const reassignment = await adminClient!
      .from('tasks')
      .update({ assignee_id: userIds.executor2 })
      .eq('id', taskIds.reassigned)
    expect(reassignment.error).toBeNull()
    await page.reload()
    await expect(
      page.getByRole('heading', {
        name: 'Задача не найдена или недоступна',
      }),
    ).toBeVisible()
    await expect(page.getByRole('heading', { name: 'История изменений' }))
      .toHaveCount(0)

    await login(page, 'executor2')
    await openTask(page, taskIds.reassigned)
    await expect(
      page.getByRole('heading', { name: taskTitles.reassigned }),
    ).toBeVisible()
    await expect(page.locator('.history-event')).toContainText(names.manager1)
  })
})
