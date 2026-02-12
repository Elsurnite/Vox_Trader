'use client'

import { useEffect, useState } from 'react'
import '../../globals.css'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8423'

function getToken() {
  if (typeof window === 'undefined') return null
  return localStorage.getItem('token')
}

export default function SettingsPage() {
  const [binanceApiKey, setBinanceApiKey] = useState('')
  const [binanceApiSecret, setBinanceApiSecret] = useState('')
  const [hasKeys, setHasKeys] = useState(false)
  const [apiKeyMasked, setApiKeyMasked] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ type: 'ok' | 'error'; text: string } | null>(null)
  const [demoMode, setDemoMode] = useState(false)
  const [demoModeSaving, setDemoModeSaving] = useState(false)

  useEffect(() => {
    const token = getToken()
    if (!token) {
      window.location.href = '/'
      return
    }
    Promise.all([
      fetch(`${API_URL}/settings/binance`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => (r.ok ? r.json() : Promise.reject())),
      fetch(`${API_URL}/settings/demo-mode`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => (r.ok ? r.json() : { demo_mode: false })),
    ])
      .then(([binanceData, demoData]: [{ has_keys: boolean; api_key_masked?: string | null }, { demo_mode?: boolean }]) => {
        setHasKeys(binanceData.has_keys)
        setApiKeyMasked(binanceData.api_key_masked ?? null)
        setDemoMode(!!demoData.demo_mode)
      })
      .catch(() => setHasKeys(false))
      .finally(() => setLoading(false))
  }, [])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const token = getToken()
    if (!token) return
    setMessage(null)
    setSaving(true)
    try {
      const res = await fetch(`${API_URL}/settings/binance`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          api_key: binanceApiKey.trim(),
          api_secret: binanceApiSecret.trim(),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setMessage({ type: 'error', text: data.detail || 'Save failed.' })
        return
      }
      setMessage({ type: 'ok', text: 'Binance API credentials were saved securely.' })
      setHasKeys(true)
      setApiKeyMasked(binanceApiKey.trim().length >= 8 ? binanceApiKey.trim().slice(0, 4) + '...' + binanceApiKey.trim().slice(-4) : '****')
      setBinanceApiKey('')
      setBinanceApiSecret('')
    } catch {
      setMessage({ type: 'error', text: 'Could not connect to server.' })
    } finally {
      setSaving(false)
    }
  }

  const setDemoModeToggle = async (enabled: boolean) => {
    const token = getToken()
    if (!token) return
    setDemoModeSaving(true)
    setMessage(null)
    try {
      const res = await fetch(`${API_URL}/settings/demo-mode`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ enabled }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setMessage({ type: 'error', text: data.detail || 'Could not save' })
        return
      }
      setDemoMode(!!data.demo_mode)
      setMessage({ type: 'ok', text: enabled ? "Demo mode enabled. Your demo balance will be shown on Dashboard." : 'Demo mode disabled. Your real balance will be shown.' })
    } catch {
      setMessage({ type: 'error', text: 'Could not connect to server.' })
    } finally {
      setDemoModeSaving(false)
    }
  }

  if (loading) return <div style={{ padding: 48, textAlign: 'center' }}>Loading...</div>

  return (
    <div>
      <h1 style={{ marginBottom: 8, fontSize: '1.5rem' }}>Settings</h1>
      <p style={{ color: '#a1a1aa', marginBottom: 32 }}>
        Manage account and exchange settings.
      </p>

      <div className="card" style={{ maxWidth: 520, marginBottom: 24 }}>
        <h2 style={{ marginTop: 0, marginBottom: 4, fontSize: '1.15rem' }}>Demo mode</h2>
        <p style={{ color: '#71717a', fontSize: '0.9rem', marginBottom: 16 }}>
          When enabled, only your demo balance is shown on Dashboard (real Binance balance is hidden). Agent demo trades use this balance.
        </p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            type="button"
            className={demoMode ? 'btn btn-primary' : 'btn btn-secondary'}
            onClick={() => setDemoModeToggle(true)}
            disabled={demoModeSaving || demoMode}
            style={{ width: 'auto', paddingLeft: 20, paddingRight: 20 }}
          >
            On
          </button>
          <button
            type="button"
            className={!demoMode ? 'btn btn-primary' : 'btn btn-secondary'}
            onClick={() => setDemoModeToggle(false)}
            disabled={demoModeSaving || !demoMode}
            style={{ width: 'auto', paddingLeft: 20, paddingRight: 20 }}
          >
            Off
          </button>
          {demoModeSaving && <span style={{ color: '#71717a', fontSize: '0.9rem' }}>Saving...</span>}
        </div>
      </div>

      <div className="card" style={{ maxWidth: 520 }}>
        <h2 style={{ marginTop: 0, marginBottom: 4, fontSize: '1.15rem' }}>Binance API</h2>
        <p style={{ color: '#71717a', fontSize: '0.9rem', marginBottom: 24 }}>
          API key and secret are stored encrypted in the database. They are used only for trading operations.
        </p>
        {hasKeys && apiKeyMasked && (
          <p style={{ color: '#a1a1aa', fontSize: '0.9rem', marginBottom: 16 }}>
            Saved key: <code style={{ background: '#27272a', padding: '2px 6px', borderRadius: 4 }}>{apiKeyMasked}</code>
            {' '}Enter a new key to update.
          </p>
        )}
        <form onSubmit={submit}>
          <div className="form-group">
            <label className="label">API Key</label>
            <input
              type="password"
              className="input"
              value={binanceApiKey}
              onChange={(e) => setBinanceApiKey(e.target.value)}
              placeholder="Binance API Key"
              autoComplete="off"
            />
          </div>
          <div className="form-group">
            <label className="label">API Secret</label>
            <input
              type="password"
              className="input"
              value={binanceApiSecret}
              onChange={(e) => setBinanceApiSecret(e.target.value)}
              placeholder="Binance API Secret"
              autoComplete="off"
            />
          </div>
          {message && (
            <p className={message.type === 'error' ? 'error' : ''} style={message.type === 'ok' ? { color: '#4ade80', marginBottom: 16 } : undefined}>
              {message.text}
            </p>
          )}
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'Saving...' : hasKeys ? 'Update' : 'Save'}
          </button>
        </form>
      </div>
    </div>
  )
}
