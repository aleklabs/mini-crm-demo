import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from './auth-context.ts'
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
  const navigate = useNavigate()
  const { projectId } = useParams()
  const { profile } = useAuth()
  const [attempt, setAttempt] = useState(0)
  const [deleteState, setDeleteState] = useState<{
    kind: 'idle' | 'deleting' | 'error'
    projectId: string | null
  }>({ kind: 'idle', projectId: projectId ?? null })
  const [taskDeleteState, setTaskDeleteState] = useState<{
    kind: 'idle' | 'deleting' | 'error'
    taskId: string | null
  }>({ kind: 'idle', taskId: null })
  const mounted = useRef(true)
  const deleteRequestId = useRef(0)
  const taskDeleteRequestId = useRef(0)
  const taskDeleteInFlight = useRef<string | null>(null)
  const currentProjectId = useRef(projectId)
  const [state, setState] = useState<ProjectState>({
    attempt: 0,
    kind: 'loading',
    projectId: projectId ?? null,
  })
  const visibleState: ProjectState =
    state.projectId === projectId && state.attempt === attempt
      ? state
      : { attempt, kind: 'loading', projectId: projectId ?? null }
  const visibleDeleteState =
    deleteState.projectId === projectId
      ? deleteState.kind
      : ('idle' as const)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      deleteRequestId.current += 1
      taskDeleteRequestId.current += 1
    }
  }, [])

  useEffect(() => {
    currentProjectId.current = projectId
  }, [projectId])

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

  const handleProjectDelete = async () => {
    if (!projectId || visibleDeleteState === 'deleting') {
      return
    }
    if (!window.confirm('Удалить объект?')) {
      return
    }

    const requestedProjectId = projectId
    const requestId = deleteRequestId.current + 1
    deleteRequestId.current = requestId
    setDeleteState({ kind: 'deleting', projectId: requestedProjectId })

    try {
      const deletion = await supabase
        .from('projects')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', requestedProjectId)

      if (
        !mounted.current ||
        deleteRequestId.current !== requestId ||
        currentProjectId.current !== requestedProjectId
      ) {
        return
      }
      if (deletion.error) {
        setDeleteState({ kind: 'error', projectId: requestedProjectId })
        return
      }

      const verification = await supabase
        .from('projects')
        .select('id')
        .eq('id', requestedProjectId)
        .maybeSingle()

      if (
        !mounted.current ||
        deleteRequestId.current !== requestId ||
        currentProjectId.current !== requestedProjectId
      ) {
        return
      }
      if (verification.error || verification.data) {
        setDeleteState({ kind: 'error', projectId: requestedProjectId })
        return
      }

      navigate('/projects', { replace: true })
    } catch {
      if (
        mounted.current &&
        deleteRequestId.current === requestId &&
        currentProjectId.current === requestedProjectId
      ) {
        setDeleteState({ kind: 'error', projectId: requestedProjectId })
      }
    }
  }

  const handleTaskDelete = async (task: ProjectTask) => {
    if (
      !projectId ||
      taskDeleteInFlight.current === task.id
    ) {
      return
    }
    if (!window.confirm(`Удалить задачу «${task.title}»?`)) {
      return
    }

    const requestedProjectId = projectId
    const requestedTaskId = task.id
    const requestId = taskDeleteRequestId.current + 1
    taskDeleteRequestId.current = requestId
    taskDeleteInFlight.current = requestedTaskId
    setTaskDeleteState({ kind: 'deleting', taskId: requestedTaskId })

    try {
      const deletion = await supabase
        .from('tasks')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', requestedTaskId)

      if (
        !mounted.current ||
        taskDeleteRequestId.current !== requestId ||
        currentProjectId.current !== requestedProjectId
      ) {
        return
      }
      if (deletion.error) {
        setTaskDeleteState({ kind: 'error', taskId: requestedTaskId })
        return
      }

      const verification = await supabase
        .from('tasks')
        .select('id')
        .eq('id', requestedTaskId)
        .maybeSingle()

      if (
        !mounted.current ||
        taskDeleteRequestId.current !== requestId ||
        currentProjectId.current !== requestedProjectId
      ) {
        return
      }
      if (verification.error || verification.data) {
        setTaskDeleteState({ kind: 'error', taskId: requestedTaskId })
        return
      }

      setTaskDeleteState({ kind: 'idle', taskId: null })
      setAttempt((value) => value + 1)
    } catch {
      if (
        mounted.current &&
        taskDeleteRequestId.current === requestId &&
        currentProjectId.current === requestedProjectId
      ) {
        setTaskDeleteState({ kind: 'error', taskId: requestedTaskId })
      }
    } finally {
      if (taskDeleteInFlight.current === requestedTaskId) {
        taskDeleteInFlight.current = null
      }
    }
  }

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
            {profile?.role === 'manager' ? (
              <div className="project-actions">
                <Link
                  className="button-link"
                  to={`/projects/${visibleState.project.id}/edit`}
                >
                  Редактировать
                </Link>
                <button
                  className="danger-button"
                  disabled={visibleDeleteState === 'deleting'}
                  type="button"
                  onClick={handleProjectDelete}
                >
                  {visibleDeleteState === 'deleting'
                    ? 'Удаление…'
                    : 'Удалить объект'}
                </button>
              </div>
            ) : null}
            {visibleDeleteState === 'error' ? (
              <p className="error-message form-message" role="alert">
                Не удалось удалить объект. Повторите попытку.
              </p>
            ) : null}
          </div>

          <section aria-labelledby="tasks-title" className="tasks-section">
            <div className="section-heading">
              <h3 id="tasks-title">Задачи</h3>
              {profile?.role === 'manager' ? (
                <Link
                  className="button-link"
                  to={`/projects/${visibleState.project.id}/tasks/new`}
                >
                  Создать задачу
                </Link>
              ) : null}
            </div>
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
                      <div className="task-card-side">
                        <span className="status-label">
                          {statusLabels[task.status] ?? task.status}
                        </span>
                        {profile?.role === 'manager' ? (
                          <div className="task-actions">
                            <Link
                              aria-label={`Редактировать задачу «${task.title}»`}
                              to={`/tasks/${task.id}/edit`}
                            >
                              Редактировать задачу
                            </Link>
                            <button
                              aria-label={`Удалить задачу «${task.title}»`}
                              className="danger-link"
                              disabled={
                                taskDeleteState.kind === 'deleting' &&
                                taskDeleteState.taskId === task.id
                              }
                              type="button"
                              onClick={() => handleTaskDelete(task)}
                            >
                              {taskDeleteState.kind === 'deleting' &&
                              taskDeleteState.taskId === task.id
                                ? 'Удаление…'
                                : 'Удалить задачу'}
                            </button>
                          </div>
                        ) : null}
                        {taskDeleteState.kind === 'error' &&
                        taskDeleteState.taskId === task.id ? (
                          <p className="error-message task-error" role="alert">
                            Не удалось удалить задачу. Повторите попытку.
                          </p>
                        ) : null}
                      </div>
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
