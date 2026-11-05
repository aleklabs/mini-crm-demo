import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAuth, type UserProfile } from './auth-context.ts'
import type { Database } from './database.types.ts'
import { supabase } from './supabase.ts'
import { getTaskStatusLabel } from './task-status.ts'

type TaskHistory =
  Database['public']['Functions']['get_task_history']['Returns'][number]

interface TaskDetails {
  assignee: { display_name: string } | null
  author: { display_name: string } | null
  created_at: string
  description: string
  id: string
  project: { id: string; name: string }
  status: string
  title: string
}

type TaskPageState =
  | { attempt: number; key: string; kind: 'loading' | 'not-found' }
  | { attempt: number; key: string; kind: 'error' }
  | {
      attempt: number
      history: TaskHistory[]
      historyError: boolean
      key: string
      kind: 'loaded'
      task: TaskDetails
    }

type TransitionState =
  | { kind: 'idle' }
  | { kind: 'submitting'; status: string }
  | { kind: 'refreshing' }
  | { kind: 'error' }

interface TaskAction {
  label: string
  status: string
}

const dateTimeFormatter = new Intl.DateTimeFormat('ru-RU', {
  dateStyle: 'long',
  timeStyle: 'short',
})

function formatDateTime(value: string) {
  return dateTimeFormatter.format(new Date(value))
}

function getActions(profile: UserProfile, status: string): TaskAction[] {
  if (profile.role === 'executor') {
    if (status === 'new') {
      return [{ label: 'Взять в работу', status: 'in_progress' }]
    }
    if (status === 'in_progress') {
      return [{ label: 'Отправить на проверку', status: 'in_review' }]
    }
    if (status === 'rework') {
      return [{ label: 'Продолжить работу', status: 'in_progress' }]
    }
  }

  if (profile.role === 'manager' && status === 'in_review') {
    return [
      { label: 'Принять задачу', status: 'accepted' },
      { label: 'Вернуть на доработку', status: 'rework' },
    ]
  }

  return []
}

export function TaskPage() {
  const { taskId } = useParams()
  const { profile } = useAuth()
  const key = `${profile?.id ?? ''}:${taskId ?? ''}`
  const keyRef = useRef(key)
  const mounted = useRef(true)
  const transitionInFlight = useRef(false)
  const pendingRefresh = useRef<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [comment, setComment] = useState('')
  const [validationError, setValidationError] = useState(false)
  const [transitionState, setTransitionState] = useState<TransitionState>({
    kind: 'idle',
  })
  const [state, setState] = useState<TaskPageState>({
    attempt: 0,
    key,
    kind: 'loading',
  })
  const visibleState: TaskPageState =
    state.key === key && state.attempt === attempt
      ? state
      : { attempt, key, kind: 'loading' }

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      transitionInFlight.current = false
      pendingRefresh.current = null
    }
  }, [])

  useEffect(() => {
    keyRef.current = key
    transitionInFlight.current = false
    pendingRefresh.current = null
    let active = true
    void Promise.resolve().then(() => {
      if (active && keyRef.current === key) {
        setComment('')
        setValidationError(false)
        setTransitionState({ kind: 'idle' })
      }
    })
    return () => {
      active = false
    }
  }, [key])

  useEffect(() => {
    let active = true

    if (!taskId || !profile) {
      void Promise.resolve().then(() => {
        if (active) {
          setState({ attempt, key, kind: 'not-found' })
        }
      })
      return () => {
        active = false
      }
    }

    void (async () => {
      try {
        const [taskResult, historyResult] = await Promise.all([
          supabase
            .from('tasks')
            .select(
              'id, title, description, status, created_at, project:projects!tasks_project_fkey(id, name), assignee:profiles!tasks_assignee_fkey(display_name), author:profiles!tasks_created_by_fkey(display_name)',
            )
            .eq('id', taskId)
            .maybeSingle(),
          supabase.rpc('get_task_history', { p_task_id: taskId }),
        ])

        if (!active) {
          return
        }
        if (taskResult.error) {
          setState({ attempt, key, kind: 'error' })
          return
        }
        if (!taskResult.data) {
          setState({ attempt, key, kind: 'not-found' })
          return
        }

        setState({
          attempt,
          history: historyResult.data ?? [],
          historyError: historyResult.error !== null,
          key,
          kind: 'loaded',
          task: taskResult.data,
        })

        if (pendingRefresh.current === key) {
          pendingRefresh.current = null
          transitionInFlight.current = false
          setComment('')
          setTransitionState({ kind: 'idle' })
        }
      } catch {
        if (active) {
          setState({ attempt, key, kind: 'error' })
        }
      }
    })()

    return () => {
      active = false
    }
  }, [attempt, key, profile, taskId])

  const retryLoad = () => {
    pendingRefresh.current = null
    transitionInFlight.current = false
    setTransitionState({ kind: 'idle' })
    setAttempt((value) => value + 1)
  }

  const handleTransition = async (newStatus: string) => {
    if (!taskId || transitionInFlight.current) {
      return
    }

    const trimmedComment = comment.trim()
    if (newStatus === 'rework' && !trimmedComment) {
      setValidationError(true)
      return
    }

    const requestedKey = key
    transitionInFlight.current = true
    setValidationError(false)
    setTransitionState({ kind: 'submitting', status: newStatus })

    try {
      const { error } = await supabase.rpc('transition_task', {
        p_comment: trimmedComment || null,
        p_new_status: newStatus,
        p_task_id: taskId,
      })

      if (!mounted.current || keyRef.current !== requestedKey) {
        return
      }
      if (error) {
        transitionInFlight.current = false
        setTransitionState({ kind: 'error' })
        return
      }

      pendingRefresh.current = requestedKey
      setTransitionState({ kind: 'refreshing' })
      setAttempt((value) => value + 1)
    } catch {
      if (mounted.current && keyRef.current === requestedKey) {
        transitionInFlight.current = false
        setTransitionState({ kind: 'error' })
      }
    }
  }

  const task = visibleState.kind === 'loaded' ? visibleState.task : null
  const actions = task && profile ? getActions(profile, task.status) : []
  const initialEvent =
    visibleState.kind === 'loaded'
      ? visibleState.history.find(
          (event) => event.from_status === null && event.to_status === 'new',
        )
      : undefined
  const authorName = task
    ? (task.author?.display_name ??
      initialEvent?.actor_display_name ??
      'Недоступно')
    : ''
  const busy =
    transitionState.kind === 'submitting' ||
    transitionState.kind === 'refreshing'

  return (
    <section aria-labelledby="task-title">
      {visibleState.kind === 'loading' ? (
        <p className="message" role="status">
          Загрузка задачи…
        </p>
      ) : null}

      {visibleState.kind === 'error' ? (
        <div className="message error-panel" role="alert">
          <p>Не удалось загрузить задачу.</p>
          <button type="button" onClick={retryLoad}>
            Повторить
          </button>
        </div>
      ) : null}

      {visibleState.kind === 'not-found' ? (
        <div className="message empty-message">
          <h2 id="task-title">Задача не найдена или недоступна</h2>
        </div>
      ) : null}

      {task && visibleState.kind === 'loaded' ? (
        <>
          <div className="task-back-links">
            {profile?.role === 'executor' ? (
              <Link className="back-link" to="/my-tasks">
                ← К моим задачам
              </Link>
            ) : null}
            <Link className="back-link" to={`/projects/${task.project.id}`}>
              ← К объекту
            </Link>
          </div>
          <article className="task-details-card">
            <div className="task-details-heading">
              <div>
                <p className="eyebrow">Задача</p>
                <h2 id="task-title">{task.title}</h2>
              </div>
              <span className="status-label">
                {getTaskStatusLabel(task.status)}
              </span>
            </div>
            <p className="task-description">
              {task.description || 'Описание отсутствует'}
            </p>
            <dl className="task-metadata">
              <div>
                <dt>Объект</dt>
                <dd>
                  <Link to={`/projects/${task.project.id}`}>
                    {task.project.name}
                  </Link>
                </dd>
              </div>
              <div>
                <dt>Исполнитель</dt>
                <dd>{task.assignee?.display_name ?? 'Недоступно'}</dd>
              </div>
              <div>
                <dt>Автор</dt>
                <dd>{authorName}</dd>
              </div>
              <div>
                <dt>Создана</dt>
                <dd>
                  <time dateTime={task.created_at}>
                    {formatDateTime(task.created_at)}
                  </time>
                </dd>
              </div>
            </dl>
            {profile?.role === 'manager' ? (
              <Link className="button-link" to={`/tasks/${task.id}/edit`}>
                Редактировать задачу
              </Link>
            ) : null}
          </article>

          <section aria-labelledby="task-actions-title" className="task-panel">
            <h3 id="task-actions-title">Доступные действия</h3>
            {actions.length === 0 ? (
              <p className="empty-message">Нет доступных действий</p>
            ) : (
              <div className="transition-form">
                <label htmlFor="transition-comment">
                  Комментарий к переходу
                </label>
                <textarea
                  disabled={busy}
                  id="transition-comment"
                  rows={4}
                  value={comment}
                  onChange={(event) => {
                    setComment(event.target.value)
                    setValidationError(false)
                  }}
                />
                {validationError ? (
                  <p className="error-message form-message" role="alert">
                    Добавьте комментарий для возврата на доработку.
                  </p>
                ) : null}
                {transitionState.kind === 'error' ? (
                  <div className="transition-error" role="alert">
                    <p>
                      Не удалось изменить статус. Состояние задачи могло
                      измениться.
                    </p>
                    <button type="button" onClick={retryLoad}>
                      Обновить данные
                    </button>
                  </div>
                ) : null}
                {busy ? (
                  <p className="progress-message" role="status">
                    {transitionState.kind === 'refreshing'
                      ? 'Обновление данных…'
                      : 'Изменение статуса…'}
                  </p>
                ) : null}
                <div className="transition-actions">
                  {actions.map((action) => (
                    <button
                      disabled={busy}
                      key={action.status}
                      type="button"
                      onClick={() => handleTransition(action.status)}
                    >
                      {transitionState.kind === 'submitting' &&
                      transitionState.status === action.status
                        ? 'Выполнение…'
                        : action.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </section>

          <section aria-labelledby="task-history-title" className="task-panel">
            <h3 id="task-history-title">История изменений</h3>
            {visibleState.historyError ? (
              <div className="message error-panel" role="alert">
                <p>Не удалось загрузить историю задачи.</p>
                <button type="button" onClick={retryLoad}>
                  Повторить
                </button>
              </div>
            ) : visibleState.history.length === 0 ? (
              <p className="message empty-message">История пока пуста</p>
            ) : (
              <ol className="history-list">
                {visibleState.history.map((event) => (
                  <li key={event.id}>
                    <article className="history-event">
                      <h4>
                        {event.from_status === null
                          ? 'Создание задачи'
                          : `${getTaskStatusLabel(event.from_status)} → ${getTaskStatusLabel(event.to_status)}`}
                      </h4>
                      {event.from_status === null ? (
                        <p>
                          Исходный статус: отсутствует · Новый статус:{' '}
                          {getTaskStatusLabel(event.to_status)}
                        </p>
                      ) : null}
                      <p>Автор действия: {event.actor_display_name}</p>
                      <p>
                        <time dateTime={event.created_at}>
                          {formatDateTime(event.created_at)}
                        </time>
                      </p>
                      {event.comment ? (
                        <p className="history-comment">
                          Комментарий: {event.comment}
                        </p>
                      ) : null}
                    </article>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </>
      ) : null}
    </section>
  )
}
