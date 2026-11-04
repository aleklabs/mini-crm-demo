import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { Session } from '@supabase/supabase-js'
import {
  AuthContext,
  type AuthContextValue,
  type AuthStatus,
  type UserProfile,
} from './auth-context.ts'
import { supabase } from './supabase.ts'

interface AuthProviderProps {
  children: ReactNode
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [session, setSession] = useState<Session | null>(null)
  const [sessionReady, setSessionReady] = useState(false)
  const [status, setStatus] = useState<AuthStatus>('initializing')
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [profileError, setProfileError] = useState<string | null>(null)
  const currentUserId = useRef<string | null>(null)
  const profileRequestId = useRef(0)

  useEffect(() => {
    let active = true

    const applySession = (nextSession: Session | null) => {
      if (!active) {
        return
      }

      const nextUserId = nextSession?.user.id ?? null
      if (nextUserId === null) {
        currentUserId.current = null
        profileRequestId.current += 1
        setProfile(null)
        setProfileError(null)
        setStatus('unauthenticated')
      } else if (currentUserId.current !== nextUserId) {
        currentUserId.current = nextUserId
        profileRequestId.current += 1
        setProfile(null)
        setProfileError(null)
        setStatus('initializing')
      }

      setSession(nextSession)
      setSessionReady(true)
    }

    const { data: authListener } = supabase.auth.onAuthStateChange(
      (_event, nextSession) => {
        applySession(nextSession)
      },
    )

    void supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (!active) {
          return
        }

        if (error) {
          currentUserId.current = null
          setSession(null)
          setProfile(null)
          setProfileError(null)
          setStatus('unauthenticated')
          setSessionReady(true)
          return
        }

        applySession(data.session)
      })
      .catch(() => {
        if (!active) {
          return
        }
        currentUserId.current = null
        setSession(null)
        setProfile(null)
        setProfileError(null)
        setStatus('unauthenticated')
        setSessionReady(true)
      })

    return () => {
      active = false
      authListener.subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!sessionReady) {
      return
    }

    const userId = session?.user.id
    if (!userId) {
      profileRequestId.current += 1
      return
    }

    const requestId = profileRequestId.current + 1
    profileRequestId.current = requestId
    let active = true

    void (async () => {
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('id, display_name, role')
          .eq('id', userId)
          .maybeSingle()

        if (!active || profileRequestId.current !== requestId) {
          return
        }

        if (error) {
          setProfileError(
            'Не удалось загрузить профиль. Повторите попытку позднее.',
          )
          setStatus('profile-error')
          return
        }

        if (!data || (data.role !== 'manager' && data.role !== 'executor')) {
          setProfileError(
            'Профиль пользователя не найден. Обратитесь к администратору.',
          )
          setStatus('profile-error')
          return
        }

        setProfile({
          displayName: data.display_name,
          id: data.id,
          role: data.role,
        })
        setProfileError(null)
        setStatus('authenticated')
      } catch {
        if (!active || profileRequestId.current !== requestId) {
          return
        }
        setProfileError(
          'Не удалось загрузить профиль. Повторите попытку позднее.',
        )
        setStatus('profile-error')
      }
    })()

    return () => {
      active = false
    }
  }, [session?.user.id, sessionReady])

  const value = useMemo<AuthContextValue>(
    () => ({
      profile,
      profileError,
      signIn: async (email, password) => {
        try {
          const { error } = await supabase.auth.signInWithPassword({
            email,
            password,
          })
          if (!error) {
            return 'success'
          }
          return error.status === 0 || error.name === 'AuthRetryableFetchError'
            ? 'network-error'
            : 'invalid-credentials'
        } catch {
          return 'network-error'
        }
      },
      signOut: async () => {
        try {
          const { error } = await supabase.auth.signOut()
          return error === null
        } catch {
          return false
        }
      },
      status,
    }),
    [profile, profileError, status],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
