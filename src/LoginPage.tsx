import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useAuth } from './auth-context.ts'

export function LoginPage() {
  const { signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setErrorMessage(null)
    setSubmitting(true)

    const result = await signIn(email, password)
    if (!mounted.current) {
      return
    }
    if (result === 'invalid-credentials') {
      setErrorMessage('Неверный email или пароль.')
    } else if (result === 'network-error') {
      setErrorMessage(
        'Не удалось подключиться к серверу. Проверьте соединение и повторите попытку.',
      )
    }
    setSubmitting(false)
  }

  return (
    <main className="auth-page">
      <section className="auth-card" aria-labelledby="login-title">
        <p className="brand">Mini CRM</p>
        <h1 id="login-title">Вход</h1>
        <form onSubmit={handleSubmit} className="login-form">
          <label htmlFor="email">Email</label>
          <input
            autoComplete="username"
            id="email"
            name="email"
            onChange={(event) => setEmail(event.target.value)}
            required
            type="email"
            value={email}
          />

          <label htmlFor="password">Пароль</label>
          <input
            autoComplete="current-password"
            id="password"
            name="password"
            onChange={(event) => setPassword(event.target.value)}
            required
            type="password"
            value={password}
          />

          {errorMessage ? (
            <p className="message error-message" role="alert">
              {errorMessage}
            </p>
          ) : null}

          <button disabled={submitting} type="submit">
            {submitting ? 'Вход…' : 'Войти'}
          </button>
          {submitting ? (
            <p className="progress-message" role="status">
              Выполняется вход…
            </p>
          ) : null}
        </form>
      </section>
    </main>
  )
}
