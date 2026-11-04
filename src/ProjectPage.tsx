import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import type { Tables } from './database.types.ts'
import { supabase } from './supabase.ts'

type Project = Pick<Tables<'projects'>, 'address' | 'id' | 'name'>

interface ProjectTask {
  assignee: { display_name: string } | null
  id: string
  status: string
  title: string
}

type ProjectState =
  | { attempt: number; kind: 'loading'; projectId: string | null }
  | { attempt: number; kind: 'not-found'; projectId: string | null }
  | { attempt: number; kind: 'error'; projectId: string }
  | {
      attempt: number
      kind: 'loaded'
      project: Project
      projectId: string
      tasks: ProjectTask[]
    }

const statusLabels: Record<string, string> = {
  accepted: 'Принята',
  in_progress: 'В работе',
  in_review: 'На проверке',
  new: 'Новая',
  rework: 'На доработке',
}

export function ProjectPage() {
  const { projectId } = useParams()
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<ProjectState>({
    attempt: 0,
    kind: 'loading',
    projectId: projectId ?? null,
  })
  const visibleState: ProjectState =
    state.projectId === projectId && state.attempt === attempt
      ? state
      : { attempt, kind: 'loading', projectId: projectId ?? null }

  useEffect(() => {
    let active = true

    if (!projectId) {
      void Promise.resolve().then(() => {
        if (active) {
          setState({ attempt, kind: 'not-found', projectId: null })
        }
      })
      return () => {
        active = false
      }
    }

    void (async () => {
      try {
        const { data: project, error: projectError } = await supabase
          .from('projects')
          .select('id, name, address')
          .eq('id', projectId)
          .maybeSingle()

        if (!active) {
          return
        }
        if (projectError) {
          setState({ attempt, kind: 'error', projectId })
          return
        }
        if (!project) {
          setState({ attempt, kind: 'not-found', projectId })
          return
        }

        const { data: tasks, error: tasksError } = await supabase
          .from('tasks')
          .select(
            'id, title, status, assignee:profiles!tasks_assignee_fkey(display_name)',
          )
          .eq('project_id', projectId)
          .order('title', { ascending: true })

        if (!active) {
          return
        }
        if (tasksError) {
          setState({ attempt, kind: 'error', projectId })
          return
        }

        setState({ attempt, kind: 'loaded', project, projectId, tasks })
      } catch {
        if (active) {
          setState({ attempt, kind: 'error', projectId })
        }
      }
    })()

    return () => {
      active = false
    }
  }, [attempt, projectId])

  return (
    <section aria-labelledby="project-title">
      <Link className="back-link" to="/projects">
        ← К списку объектов
      </Link>

      {visibleState.kind === 'loading' ? (
        <p className="message" role="status">
          Загрузка объекта…
        </p>
      ) : null}

      {visibleState.kind === 'error' ? (
        <div className="message error-panel" role="alert">
          <p>Не удалось загрузить объект.</p>
          <button type="button" onClick={() => setAttempt((value) => value + 1)}>
            Повторить
          </button>
        </div>
      ) : null}

      {visibleState.kind === 'not-found' ? (
        <div className="message empty-message">
          <h2 id="project-title">Объект не найден или недоступен</h2>
        </div>
      ) : null}

      {visibleState.kind === 'loaded' ? (
        <>
          <div className="project-summary">
            <p className="eyebrow">Объект</p>
            <h2 id="project-title">{visibleState.project.name}</h2>
            <p>{visibleState.project.address}</p>
          </div>

          <section aria-labelledby="tasks-title" className="tasks-section">
            <h3 id="tasks-title">Задачи</h3>
            {visibleState.tasks.length === 0 ? (
              <p className="message empty-message">Нет задач</p>
            ) : (
              <ul className="task-list">
                {visibleState.tasks.map((task) => (
                  <li key={task.id}>
                    <article className="task-card">
                      <div>
                        <h4>{task.title}</h4>
                        {task.assignee ? (
                          <p>Исполнитель: {task.assignee.display_name}</p>
                        ) : null}
                      </div>
                      <span className="status-label">
                        {statusLabels[task.status] ?? task.status}
                      </span>
                    </article>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      ) : null}
    </section>
  )
}
