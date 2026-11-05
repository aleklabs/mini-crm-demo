import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from './auth-context.ts'
import { supabase } from './supabase.ts'
import { getTaskStatusLabel } from './task-status.ts'

interface MyTask {
  created_at: string
  id: string
  project: { id: string; name: string }
  project_id: string
  status: string
  title: string
}

type MyTasksState =
  | { attempt: number; kind: 'loading'; profileId: string | null }
  | { attempt: number; kind: 'error'; profileId: string }
  | {
      attempt: number
      kind: 'loaded'
      profileId: string
      tasks: MyTask[]
    }

const dateTimeFormatter = new Intl.DateTimeFormat('ru-RU', {
  dateStyle: 'long',
  timeStyle: 'short',
})

export function MyTasksPage() {
  const { profile } = useAuth()
  const profileId = profile?.id
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<MyTasksState>({
    attempt: 0,
    kind: 'loading',
    profileId: profileId ?? null,
  })
  const visibleState: MyTasksState =
    state.profileId === profileId && state.attempt === attempt
      ? state
      : { attempt, kind: 'loading', profileId: profileId ?? null }

  useEffect(() => {
    if (!profileId) {
      return
    }

    let active = true
    const requestedProfileId = profileId

    void (async () => {
      try {
        const { data, error } = await supabase
          .from('tasks')
          .select(
            'id, title, status, created_at, project_id, project:projects!tasks_project_fkey(id, name)',
          )
          .order('created_at', { ascending: false })
          .order('id', { ascending: true })

        if (!active) {
          return
        }
        setState(
          error
            ? { attempt, kind: 'error', profileId: requestedProfileId }
            : {
                attempt,
                kind: 'loaded',
                profileId: requestedProfileId,
                tasks: data,
              },
        )
      } catch {
        if (active) {
          setState({
            attempt,
            kind: 'error',
            profileId: requestedProfileId,
          })
        }
      }
    })()

    return () => {
      active = false
    }
  }, [attempt, profileId])

  return (
    <section aria-labelledby="my-tasks-title">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Работа исполнителя</p>
          <h2 id="my-tasks-title">Мои задачи</h2>
        </div>
      </div>

      {visibleState.kind === 'loading' ? (
        <p className="message" role="status">
          Загрузка задач…
        </p>
      ) : null}

      {visibleState.kind === 'error' ? (
        <div className="message error-panel" role="alert">
          <p>Не удалось загрузить задачи</p>
          <button type="button" onClick={() => setAttempt((value) => value + 1)}>
            Повторить
          </button>
        </div>
      ) : null}

      {visibleState.kind === 'loaded' && visibleState.tasks.length === 0 ? (
        <p className="message empty-message">У вас пока нет задач</p>
      ) : null}

      {visibleState.kind === 'loaded' && visibleState.tasks.length > 0 ? (
        <ul className="my-task-list">
          {visibleState.tasks.map((task) => (
            <li key={task.id}>
              <article className="my-task-card">
                <div className="my-task-heading">
                  <h3>
                    <Link to={`/tasks/${task.id}`}>{task.title}</Link>
                  </h3>
                  <span className="status-label">
                    {getTaskStatusLabel(task.status)}
                  </span>
                </div>
                <p>
                  Объект:{' '}
                  <Link to={`/projects/${task.project_id}`}>
                    {task.project.name}
                  </Link>
                </p>
                <p>
                  Создана:{' '}
                  <time dateTime={task.created_at}>
                    {dateTimeFormatter.format(new Date(task.created_at))}
                  </time>
                </p>
              </article>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}
