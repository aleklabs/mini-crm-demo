import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import type { Tables } from './database.types.ts'
import { supabase } from './supabase.ts'

type TaskFormMode = 'create' | 'edit'
type ProjectOption = Pick<Tables<'projects'>, 'id' | 'name'>
type ExecutorOption = Pick<Tables<'profiles'>, 'display_name' | 'id'>

interface TaskFormPageProps {
  mode: TaskFormMode
}

type LoadState =
  | { attempt: number; kind: 'loading' | 'not-found'; routeKey: string }
  | { attempt: number; kind: 'error'; routeKey: string }
  | {
      attempt: number
      executors: ExecutorOption[]
      kind: 'loaded'
      projects: ProjectOption[]
      routeKey: string
    }

interface FormMessage {
  routeKey: string
  text: string
}

export function TaskFormPage({ mode }: TaskFormPageProps) {
  const navigate = useNavigate()
  const { projectId, taskId } = useParams()
  const routeKey =
    mode === 'create' ? `create:${projectId ?? ''}` : `edit:${taskId ?? ''}`
  const routeKeyRef = useRef(routeKey)
  const mounted = useRef(true)
  const submissionKey = useRef<string | null>(null)

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [selectedProjectId, setSelectedProjectId] = useState('')
  const [assigneeId, setAssigneeId] = useState('')
  const [cancelProjectId, setCancelProjectId] = useState(projectId ?? '')
  const [attempt, setAttempt] = useState(0)
  const [loadState, setLoadState] = useState<LoadState>({
    attempt: 0,
    kind: 'loading',
    routeKey,
  })
  const [submittingRoute, setSubmittingRoute] = useState<string | null>(null)
  const [validationMessage, setValidationMessage] =
    useState<FormMessage | null>(null)
  const [saveMessage, setSaveMessage] = useState<FormMessage | null>(null)

  const submitting = submittingRoute === routeKey
  const visibleLoadState: LoadState =
    loadState.routeKey === routeKey && loadState.attempt === attempt
      ? loadState
      : { attempt, kind: 'loading', routeKey }
  const visibleValidationMessage =
    validationMessage?.routeKey === routeKey ? validationMessage.text : null
  const visibleSaveMessage =
    saveMessage?.routeKey === routeKey ? saveMessage.text : null

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  useEffect(() => {
    routeKeyRef.current = routeKey
  }, [routeKey])

  useEffect(() => {
    let active = true

    if (
      (mode === 'create' && !projectId) ||
      (mode === 'edit' && !taskId)
    ) {
      void Promise.resolve().then(() => {
        if (active) {
          setLoadState({ attempt, kind: 'not-found', routeKey })
        }
      })
      return () => {
        active = false
      }
    }

    const requestedProjectId = projectId
    const requestedTaskId = taskId

    void (async () => {
      try {
        const [projectsResult, executorsResult] = await Promise.all([
          supabase.from('projects').select('id, name').order('name'),
          supabase
            .from('profiles')
            .select('id, display_name')
            .eq('role', 'executor')
            .order('display_name'),
        ])

        if (!active) {
          return
        }
        if (projectsResult.error || executorsResult.error) {
          setLoadState({ attempt, kind: 'error', routeKey })
          return
        }

        if (mode === 'create') {
          if (
            !requestedProjectId ||
            !projectsResult.data.some(({ id }) => id === requestedProjectId)
          ) {
            setLoadState({ attempt, kind: 'not-found', routeKey })
            return
          }

          setTitle('')
          setDescription('')
          setSelectedProjectId(requestedProjectId)
          setAssigneeId('')
          setCancelProjectId(requestedProjectId)
          setLoadState({
            attempt,
            executors: executorsResult.data,
            kind: 'loaded',
            projects: projectsResult.data,
            routeKey,
          })
          return
        }

        const taskResult = await supabase
          .from('tasks')
          .select('id, title, description, project_id, assignee_id')
          .eq('id', requestedTaskId ?? '')
          .maybeSingle()

        if (!active) {
          return
        }
        if (taskResult.error) {
          setLoadState({ attempt, kind: 'error', routeKey })
          return
        }
        if (!taskResult.data) {
          setLoadState({ attempt, kind: 'not-found', routeKey })
          return
        }

        setTitle(taskResult.data.title)
        setDescription(taskResult.data.description)
        setSelectedProjectId(taskResult.data.project_id)
        setAssigneeId(taskResult.data.assignee_id)
        setCancelProjectId(taskResult.data.project_id)
        setLoadState({
          attempt,
          executors: executorsResult.data,
          kind: 'loaded',
          projects: projectsResult.data,
          routeKey,
        })
      } catch {
        if (active) {
          setLoadState({ attempt, kind: 'error', routeKey })
        }
      }
    })()

    return () => {
      active = false
    }
  }, [attempt, mode, projectId, routeKey, taskId])

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (submissionKey.current === routeKey) {
      return
    }

    const trimmedTitle = title.trim()
    const trimmedDescription = description.trim()
    if (!trimmedTitle || !selectedProjectId || !assigneeId) {
      setValidationMessage({
        routeKey,
        text: 'Заполните название, объект и исполнителя.',
      })
      return
    }

    setTitle(trimmedTitle)
    setDescription(trimmedDescription)
    setValidationMessage(null)
    setSaveMessage(null)
    submissionKey.current = routeKey
    setSubmittingRoute(routeKey)

    try {
      const values = {
        assignee_id: assigneeId,
        description: trimmedDescription,
        project_id: selectedProjectId,
        title: trimmedTitle,
      }
      const result =
        mode === 'create'
          ? await supabase
              .from('tasks')
              .insert(values)
              .select('id, project_id')
              .maybeSingle()
          : taskId
            ? await supabase
                .from('tasks')
                .update(values)
                .eq('id', taskId)
                .select('id, project_id')
                .maybeSingle()
            : { data: null, error: new Error('Task ID is unavailable') }

      if (!mounted.current || routeKeyRef.current !== routeKey) {
        return
      }
      if (result.error || !result.data) {
        setSaveMessage({
          routeKey,
          text: 'Не удалось сохранить задачу. Повторите попытку.',
        })
        return
      }

      navigate(`/projects/${result.data.project_id}`, { replace: true })
    } catch {
      if (mounted.current && routeKeyRef.current === routeKey) {
        setSaveMessage({
          routeKey,
          text: 'Не удалось сохранить задачу. Повторите попытку.',
        })
      }
    } finally {
      if (submissionKey.current === routeKey) {
        submissionKey.current = null
      }
      if (mounted.current && routeKeyRef.current === routeKey) {
        setSubmittingRoute(null)
      }
    }
  }

  const cancelPath = cancelProjectId
    ? `/projects/${cancelProjectId}`
    : '/projects'
  const noExecutors =
    visibleLoadState.kind === 'loaded' &&
    visibleLoadState.executors.length === 0

  return (
    <section aria-labelledby="task-form-title">
      {visibleLoadState.kind === 'loading' ? (
        <p className="message" role="status">
          Загрузка задачи…
        </p>
      ) : null}

      {visibleLoadState.kind === 'error' ? (
        <div className="message error-panel" role="alert">
          <p>Не удалось загрузить данные задачи.</p>
          <button type="button" onClick={() => setAttempt((value) => value + 1)}>
            Повторить
          </button>
        </div>
      ) : null}

      {visibleLoadState.kind === 'not-found' ? (
        <div className="message empty-message">
          <h2 id="task-form-title">
            {mode === 'edit'
              ? 'Задача не найдена или недоступна'
              : 'Объект не найден или недоступен'}
          </h2>
        </div>
      ) : null}

      {visibleLoadState.kind === 'loaded' ? (
        <div className="project-form-card">
          <p className="eyebrow">Задача</p>
          <h2 id="task-form-title">
            {mode === 'create' ? 'Новая задача' : 'Редактирование задачи'}
          </h2>
          <form className="project-form" onSubmit={handleSubmit}>
            <label htmlFor="task-title">Название</label>
            <input
              required
              disabled={submitting}
              id="task-title"
              name="title"
              value={title}
              onChange={(event) => {
                setTitle(event.target.value)
                setValidationMessage(null)
              }}
            />

            <label htmlFor="task-description">Описание</label>
            <textarea
              disabled={submitting}
              id="task-description"
              name="description"
              rows={5}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />

            <label htmlFor="task-project">Объект</label>
            <select
              required
              disabled={submitting}
              id="task-project"
              name="project_id"
              value={selectedProjectId}
              onChange={(event) => {
                setSelectedProjectId(event.target.value)
                setValidationMessage(null)
              }}
            >
              <option value="">Выберите объект</option>
              {visibleLoadState.projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>

            <label htmlFor="task-assignee">Исполнитель</label>
            <select
              required
              disabled={submitting || noExecutors}
              id="task-assignee"
              name="assignee_id"
              value={assigneeId}
              onChange={(event) => {
                setAssigneeId(event.target.value)
                setValidationMessage(null)
              }}
            >
              <option value="">Выберите исполнителя</option>
              {visibleLoadState.executors.map((executor) => (
                <option key={executor.id} value={executor.id}>
                  {executor.display_name}
                </option>
              ))}
            </select>

            {noExecutors ? (
              <p className="error-message form-message" role="alert">
                Нет доступных исполнителей.
              </p>
            ) : null}
            {visibleValidationMessage ? (
              <p className="error-message form-message" role="alert">
                {visibleValidationMessage}
              </p>
            ) : null}
            {visibleSaveMessage ? (
              <p className="error-message form-message" role="alert">
                {visibleSaveMessage}
              </p>
            ) : null}
            {submitting ? (
              <p className="progress-message" role="status">
                Сохранение…
              </p>
            ) : null}

            <div className="form-actions">
              <button disabled={submitting || noExecutors} type="submit">
                {submitting ? 'Сохранение…' : 'Сохранить'}
              </button>
              <button
                className="secondary-button"
                disabled={submitting}
                type="button"
                onClick={() => navigate(cancelPath)}
              >
                Отмена
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </section>
  )
}
