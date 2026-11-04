import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from './auth-context.ts'
import type { Tables } from './database.types.ts'
import { supabase } from './supabase.ts'

type Project = Pick<Tables<'projects'>, 'address' | 'id' | 'name'>

type ProjectsState =
  | { attempt: number; kind: 'loading'; profileId: string | null }
  | {
      attempt: number
      kind: 'loaded'
      profileId: string
      projects: Project[]
    }
  | { attempt: number; kind: 'error'; profileId: string }

export function ProjectsPage() {
  const { profile } = useAuth()
  const profileId = profile?.id
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<ProjectsState>({
    attempt: 0,
    kind: 'loading',
    profileId: profileId ?? null,
  })
  const visibleState: ProjectsState =
    state.profileId === profileId && state.attempt === attempt
      ? state
      : { attempt, kind: 'loading', profileId: profileId ?? null }

  useEffect(() => {
    if (!profileId) {
      return
    }

    let active = true
    const requestProfileId = profileId

    void (async () => {
      try {
        const { data, error } = await supabase
          .from('projects')
          .select('id, name, address')
          .order('name', { ascending: true })

        if (!active) {
          return
        }
        setState(
          error
            ? { attempt, kind: 'error', profileId: requestProfileId }
            : {
                attempt,
                kind: 'loaded',
                profileId: requestProfileId,
                projects: data,
              },
        )
      } catch {
        if (active) {
          setState({ attempt, kind: 'error', profileId: requestProfileId })
        }
      }
    })()

    return () => {
      active = false
    }
  }, [attempt, profileId])

  return (
    <section aria-labelledby="projects-title">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Объекты строительства</p>
          <h2 id="projects-title">Объекты</h2>
        </div>
      </div>

      {visibleState.kind === 'loading' ? (
        <p className="message" role="status">
          Загрузка объектов…
        </p>
      ) : null}

      {visibleState.kind === 'error' ? (
        <div className="message error-panel" role="alert">
          <p>Не удалось загрузить объекты.</p>
          <button type="button" onClick={() => setAttempt((value) => value + 1)}>
            Повторить
          </button>
        </div>
      ) : null}

      {visibleState.kind === 'loaded' && visibleState.projects.length === 0 ? (
        <p className="message empty-message">Объектов нет.</p>
      ) : null}

      {visibleState.kind === 'loaded' && visibleState.projects.length > 0 ? (
        <ul className="project-list">
          {visibleState.projects.map((project) => (
            <li key={project.id}>
              <article className="project-card">
                <h3>{project.name}</h3>
                <p>{project.address}</p>
                <Link to={`/projects/${project.id}`}>Открыть объект</Link>
              </article>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}
