'use client'

import { useState } from 'react'
import './globals.css'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8423'

type Mode = 'login' | 'register'

export default function LoginPage() {
  const [mode, setMode] = useState<Mode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const url = mode === 'login' ? `${API_URL}/auth/login` : `${API_URL}/auth/register`
      const body = mode === 'login'
        ? { email, password }
        : { email, password, name: name || undefined }
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.detail || (typeof data.detail === 'string' ? data.detail : 'Login or registration failed.'))
        return
      }
      // Persist token/user and navigate to dashboard.
      localStorage.setItem('token', data.access_token)
      localStorage.setItem('user', JSON.stringify(data.user))
      alert(`Welcome, ${data.user.name || data.user.email}!`)
      window.location.href = '/dashboard'
    } catch (err) {
      setError('Could not connect to the server. Is backend running?')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
    }}>
      <div className="card">
        <h1 style={{ marginTop: 0, marginBottom: 8, fontSize: '1.75rem' }}>Vox Trader</h1>
        <p style={{ color: '#a1a1aa', marginBottom: 24, fontSize: '0.95rem' }}>
          {mode === 'login' ? 'Sign in to your account' : 'Create a new account'}
        </p>

        <form onSubmit={submit}>
          {mode === 'register' && (
            <div className="form-group">
              <label className="label">Name (optional)</label>
              <input
                type="text"
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name"
                autoComplete="name"
              />
            </div>
          )}
          <div className="form-group">
            <label className="label">Email</label>
            <input
              type="email"
              className="input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="example@email.com"
              required
              autoComplete="email"
            />
          </div>
          <div className="form-group">
            <label className="label">Password</label>
            <input
              type="password"
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            />
          </div>
          {error && <p className="error">{error}</p>}
          <div className="form-group" style={{ marginTop: 24 }}>
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? '...' : mode === 'login' ? 'Sign in' : 'Sign up'}
            </button>
          </div>
        </form>

        <p style={{ textAlign: 'center', marginTop: 20, color: '#a1a1aa', fontSize: '0.9rem' }}>
          {mode === 'login' ? (
            <>
              Don't have an account?{' '}
              <button
                type="button"
                className="link"
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                onClick={() => { setMode('register'); setError('') }}
              >
                Sign up
              </button>
            </>
          ) : (
            <>
              Already have an account?{' '}
              <button
                type="button"
                className="link"
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                onClick={() => { setMode('login'); setError('') }}
              >
                Sign in
              </button>
            </>
          )}
        </p>
      </div>
    </div>
  )
}
