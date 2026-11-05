import { useEffect, useRef, useState } from 'react'
import {
  Link,
  Navigate,
  Outlet,
  Route,
  Routes,
} from 'react-router-dom'
import { useAuth, type UserRole } from './auth-context.ts'
import { LoginPage } from './LoginPage.tsx'
import { MyTasksPage } from './MyTasksPage.tsx'
import { ProjectFormPage } from './ProjectFormPage.tsx'
import { ProjectPage } from './ProjectPage.tsx'
import { ProjectsPage } from './ProjectsPage.tsx'
import { TaskFormPage } from './TaskFormPage.tsx'
import { TaskPage } from './TaskPage.tsx'

const roleLabels: Record<UserRole, string> = {
  executor: 'Исполнитель',
  manager: 'Постановщик',
}

function SessionLoading() {
  return (
    <main className="app-state">
      <p className="brand">Mini CRM</p>
      <p role="status">Проверка сессии…</p>
    </main>
  )
}

function SignOutButton() {
  const { signOut } = useAuth()
  const [signingOut, setSigningOut] = useState(false)
  const [error, setError] = useState(false)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const handleSignOut = async () => {
    setError(false)
    setSigningOut(true)
    const success = await signOut()
    if (!mounted.current) {
      return
    }
    setSigningOut(false)
    setError(!success)
  }

  return (
    <div className="sign-out-control">
      <button disabled={signingOut} type="button" onClick={handleSignOut}>
        {signingOut ? 'Выход…' : 'Выйти'}
      </button>
      {error ? (
        <p className="inline-error" role="alert">
          Не удалось выйти. Повторите попытку.
        </p>
      ) : null}
    </div>
  )
}

function ProfileErrorPage() {
  const { profileError } = useAuth()

  return (
    <main className="app-state">
      <section className="auth-card">
        <p className="brand">Mini CRM</p>
        <h1>Доступ к CRM недоступен</h1>
        <p className="message error-message" role="alert">
          {profileError}
        </p>
        <SignOutButton />
      </section>
    </main>
  )
}

function RootRoute() {
  const { status } = useAuth()

  if (status === 'initializing') {
    return <SessionLoading />
  }
  if (status === 'profile-error') {
    return <ProfileErrorPage />
  }
  return (
    <Navigate
      replace
      to={status === 'authenticated' ? '/projects' : '/login'}
    />
  )
}

function LoginRoute() {
  const { status } = useAuth()

  if (status === 'initializing') {
    return <SessionLoading />
  }
  if (status === 'authenticated') {
    return <Navigate replace to="/projects" />
  }
  if (status === 'profile-error') {
    return <ProfileErrorPage />
  }
  return <LoginPage />
}

function AppLayout() {
  const { profile } = useAuth()

  if (!profile) {
    return null
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <Link className="logo" to="/projects">
            Mini CRM
          </Link>
          <nav aria-label="Основная навигация">
            <Link to="/projects">Объекты</Link>
            {profile.role === 'executor' ? (
              <Link to="/my-tasks">Мои задачи</Link>
            ) : null}
          </nav>
        </div>
        <div className="user-panel">
          <div>
            <p className="user-name">{profile.displayName}</p>
            <p className="user-role">{roleLabels[profile.role]}</p>
          </div>
          <SignOutButton />
        </div>
      </header>
      <main className="app-content">
        <Outlet />
      </main>
    </div>
  )
}

function ProtectedRoutes() {
  const { status } = useAuth()

  if (status === 'initializing') {
    return <SessionLoading />
  }
  if (status === 'unauthenticated') {
    return <Navigate replace to="/login" />
  }
  if (status === 'profile-error') {
    return <ProfileErrorPage />
  }
  return <AppLayout />
}

function ManagerRoutes() {
  const { profile } = useAuth()

  if (profile?.role !== 'manager') {
    return (
      <section className="message access-denied">
        <h2>Недостаточно прав</h2>
      </section>
    )
  }

  return <Outlet />
}

function ExecutorRoutes() {
  const { profile } = useAuth()

  if (profile?.role !== 'executor') {
    return (
      <section className="message access-denied">
        <h2>Недостаточно прав</h2>
      </section>
    )
  }

  return <Outlet />
}

function NotFoundPage() {
  return (
    <main className="app-state">
      <h1>Страница не найдена</h1>
      <Link to="/">На главную</Link>
    </main>
  )
}

function App() {
  return (
    <Routes>
      <Route path="/" element={<RootRoute />} />
      <Route path="/login" element={<LoginRoute />} />
      <Route element={<ProtectedRoutes />}>
        <Route path="/projects" element={<ProjectsPage />} />
        <Route path="/projects/:projectId" element={<ProjectPage />} />
        <Route path="/tasks/:taskId" element={<TaskPage />} />
        <Route element={<ExecutorRoutes />}>
          <Route path="/my-tasks" element={<MyTasksPage />} />
        </Route>
        <Route element={<ManagerRoutes />}>
          <Route
            path="/projects/new"
            element={<ProjectFormPage key="create" mode="create" />}
          />
          <Route
            path="/projects/:projectId/edit"
            element={<ProjectFormPage key="edit" mode="edit" />}
          />
          <Route
            path="/projects/:projectId/tasks/new"
            element={<TaskFormPage key="create" mode="create" />}
          />
          <Route
            path="/tasks/:taskId/edit"
            element={<TaskFormPage key="edit" mode="edit" />}
          />
        </Route>
      </Route>
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  )
}

export default App
