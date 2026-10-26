import { createContext, useContext, useEffect, useState } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { getProfile } from '../lib/supabaseApi'

const AuthContext = createContext(null)

const DEACTIVATED = 'This account is deactivated. Contact your administrator.'

// Combine the Supabase session with the user's profile (name, role, active)
async function resolveUser(session) {
  if (!session) return null
  const profile = await getProfile(session.user.id).catch(() => null)
  if (!profile?.active) {
    await supabase.auth.signOut()
    return null
  }
  return { id: session.user.id, email: session.user.email, name: profile.name, role: profile.role }
}

export function AuthProvider({ children }) {
  // undefined = still checking, null = signed out
  const [user, setUser] = useState(undefined)

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => setUser(await resolveUser(data.session)))
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      // Defer: calling Supabase inside this callback can deadlock
      setTimeout(async () => setUser(await resolveUser(session)), 0)
    })
    return () => subscription.unsubscribe()
  }, [])

  async function signIn(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      return { error: /banned/i.test(error.message) ? { message: DEACTIVATED } : error }
    }
    const resolved = await resolveUser(data.session)
    if (!resolved) return { error: { message: DEACTIVATED } }
    setUser(resolved)
    return { error: null }
  }

  const value = {
    user: user ?? null,
    loading: user === undefined,
    isAdmin: user?.role === 'admin',
    signIn,
    signOut: () => supabase.auth.signOut(),
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export const useAuth = () => useContext(AuthContext)

export function RequireAuth({ children, adminOnly = false }) {
  const { user, loading, isAdmin } = useAuth()
  const location = useLocation()

  if (loading) return <div className="screen-center"><div className="spinner" /></div>
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />
  if (adminOnly && !isAdmin) return <Navigate to="/" replace />
  return children
}
