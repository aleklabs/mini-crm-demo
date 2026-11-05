import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from './supabase.ts'

type ProjectFormMode = 'create' | 'edit'

interface ProjectFormPageProps {
  mode: ProjectFormMode
}

type EditLoadState =
  | {
      attempt: number
      kind: 'loading' | 'loaded' | 'not-found'
      projectId: string | null
    }
  | { attempt: number; kind: 'error'; projectId: string }

interface FormMessage {
  routeKey: string
  text: string
}

export function ProjectFormPage({ mode }: ProjectFormPageProps) {
  const navigate = useNavigate()
  const { projectId } = useParams()
  const routeKey = mode === 'create' ? 'create' : `edit:${projectId ?? ''}`
  const routeKeyRef = useRef(routeKey)

  const mounted = useRef(true)
  const submissionKey = useRef<string | null>(null)
  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [loadState, setLoadState] = useState<EditLoadState>({
    attempt: 0,
    kind: mode === 'create' ? 'loaded' : 'loading',
    projectId: projectId ?? null,
  })
  const [submittingRoute, setSubmittingRoute] = useState<string | null>(null)
  const [validationMessage, setValidationMessage] =
    useState<FormMessage | null>(null)
  const [saveMessage, setSaveMessage] = useState<FormMessage | null>(null)

  const submitting = submittingRoute === routeKey
  const visibleLoadState: EditLoadState =
    mode === 'create'
      ? { attempt, kind: 'loaded', projectId: null }
      : loadState.projectId === projectId && loadState.attempt === attempt
        ? loadState
        : { attempt, kind: 'loading', projectId: projectId ?? null }
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
    if (mode === 'create') {
      return
    }

    let active = true

    if (!projectId) {
      void Promise.resolve().then(() => {
        if (active) {
          setLoadState({ attempt, kind: 'not-found', projectId: null })
        }
      })
      return () => {
        active = false
      }
    }

    const requestedProjectId = projectId
    void (async () => {
      try {
        const { data, error } = await supabase
          .from('projects')
          .select('id, name, address')
          .eq('id', requestedProjectId)
          .maybeSingle()

        if (!active) {
          return
        }
        if (error) {
          setLoadState({
            attempt,
            kind: 'error',
            projectId: requestedProjectId,
          })
          return
        }
        if (!data) {
          setLoadState({
            attempt,
            kind: 'not-found',
            projectId: requestedProjectId,
          })
          return
        }

        setName(data.name)
        setAddress(data.address)
        setLoadState({
          attempt,
          kind: 'loaded',
          projectId: requestedProjectId,
        })
      } catch {
        if (active) {
          setLoadState({
            attempt,
            kind: 'error',
            projectId: requestedProjectId,
          })
        }
      }
    })()

    return () => {
      active = false
    }
  }, [attempt, mode, projectId])

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (submissionKey.current === routeKey) {
      return
    }

    const trimmedName = name.trim()
    const trimmedAddress = address.trim()
    if (!trimmedName || !trimmedAddress) {
      setValidationMessage({
        routeKey,
        text: 'Заполните название объекта и адрес.',
      })
      return
    }

    setName(trimmedName)
    setAddress(trimmedAddress)
    setValidationMessage(null)
    setSaveMessage(null)
    submissionKey.current = routeKey
    setSubmittingRoute(routeKey)

    try {
      const result =
        mode === 'create'
          ? await supabase
              .from('projects')
              .insert({ address: trimmedAddress, name: trimmedName })
              .select('id')
              .maybeSingle()
          : projectId
            ? await supabase
                .from('projects')
                .update({ address: trimmedAddress, name: trimmedName })
                .eq('id', projectId)
                .select('id')
                .maybeSingle()
            : { data: null, error: new Error('Project ID is unavailable') }

      if (!mounted.current || routeKeyRef.current !== routeKey) {
        return
      }

      if (result.error || !result.data) {
        setSaveMessage({
          routeKey,
          text: 'Не удалось сохранить объект. Повторите попытку.',
        })
        return
      }

      navigate(`/projects/${result.data.id}`, { replace: true })
    } catch {
      if (mounted.current && routeKeyRef.current === routeKey) {
        setSaveMessage({
          routeKey,
          text: 'Не удалось сохранить объект. Повторите попытку.',
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

  const cancelPath =
    mode === 'edit' && projectId ? `/projects/${projectId}` : '/projects'

  return (
    <section aria-labelledby="project-form-title">
      {visibleLoadState.kind === 'loading' ? (
        <p className="message" role="status">
          Загрузка объекта…
        </p>
      ) : null}

      {visibleLoadState.kind === 'error' ? (
        <div className="message error-panel" role="alert">
          <p>Не удалось загрузить объект.</p>
          <button type="button" onClick={() => setAttempt((value) => value + 1)}>
            Повторить
          </button>
        </div>
      ) : null}

      {visibleLoadState.kind === 'not-found' ? (
        <div className="message empty-message">
          <h2 id="project-form-title">Объект не найден или недоступен</h2>
        </div>
      ) : null}

      {visibleLoadState.kind === 'loaded' ? (
        <div className="project-form-card">
          <p className="eyebrow">Объект строительства</p>
          <h2 id="project-form-title">
            {mode === 'create' ? 'Новый объект' : 'Редактирование объекта'}
          </h2>
          <form className="project-form" onSubmit={handleSubmit}>
            <label htmlFor="project-name">Название объекта</label>
            <input
              required
              disabled={submitting}
              id="project-name"
              name="name"
              value={name}
              onChange={(event) => {
                setName(event.target.value)
                setValidationMessage(null)
              }}
            />

            <label htmlFor="project-address">Адрес</label>
            <input
              required
              disabled={submitting}
              id="project-address"
              name="address"
              value={address}
              onChange={(event) => {
                setAddress(event.target.value)
                setValidationMessage(null)
              }}
            />

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
              <button disabled={submitting} type="submit">
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
