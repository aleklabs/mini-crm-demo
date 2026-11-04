import { createContext, useContext } from 'react'

export type UserRole = 'manager' | 'executor'

export interface UserProfile {
  displayName: string
  id: string
  role: UserRole
}

export type AuthStatus =
  | 'initializing'
  | 'unauthenticated'
  | 'authenticated'
  | 'profile-error'

export type SignInResult =
  | 'success'
  | 'invalid-credentials'
  | 'network-error'

export interface AuthContextValue {
  profile: UserProfile | null
  profileError: string | null
  signIn: (email: string, password: string) => Promise<SignInResult>
  signOut: () => Promise<boolean>
  status: AuthStatus
}

export const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used inside AuthProvider')
  }
  return context
}
