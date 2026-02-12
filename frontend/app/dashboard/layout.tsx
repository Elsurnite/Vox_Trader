'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState, useEffect } from 'react'
import '../globals.css'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8423'
const TOPUP_PRESETS = [3, 5, 10, 25]

function getToken() {
  if (typeof window === 'undefined') return null
  return localStorage.getItem('token')
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const [balance, setBalance] = useState<number | null>(null)
  const [showTopupModal, setShowTopupModal] = useState(false)
  const [topupLoading, setTopupLoading] = useState(false)
  const [topupError, setTopupError] = useState<string | null>(null)
  const [topupPreset, setTopupPreset] = useState<string>('10')
  const [topupForm, setTopupForm] = useState({
    amount_usd: '10',
    customer_name: '',
    customer_email: '',
    customer_phone: '',
    card_holder: '',
    card_number: '',
    expire_month: '',
    expire_year: '',
    cvc: '',
  })

  const loadBalance = async () => {
    const token = getToken()
    if (!token) return
    try {
      const res = await fetch(`${API_URL}/ai/balance`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      })
      const data = await res.json().catch(() => null)
      if (res.ok && data && typeof data.balance === 'number') {
        setBalance(data.balance)
        return
      }
    } catch {}
    // Fallback: legacy endpoint
    fetch(`${API_URL}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (data && typeof data.balance === 'number') setBalance(data.balance) })
      .catch(() => {})
  }

  useEffect(() => {
    const token = getToken()
    if (token) {
      fetch(`${API_URL}/auth/me`, { headers: { Authorization: `Bearer ${token}` } })
        .then((r) => (r.ok ? r.json() : null))
        .then((u) => {
          if (!u) return
          setTopupForm((prev) => ({
            ...prev,
            customer_email: u?.email || '',
          }))
        })
        .catch(() => {})
    }

    let inFlight = false
    const syncBalance = () => {
      if (inFlight) return
      inFlight = true
      loadBalance().finally(() => { inFlight = false })
    }

    syncBalance()
    const iv = setInterval(syncBalance, 4000)
    const onFocus = () => syncBalance()
    const onVisibility = () => {
      if (document.visibilityState === 'visible') syncBalance()
    }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      clearInterval(iv)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    const status = params.get('topup')
    if (!status) return
    loadBalance()
    if (status === 'success') {
      alert('Balance top-up successful.')
    } else if (status === 'failed') {
      alert('Balance top-up failed.')
    }
    params.delete('topup')
    params.delete('order_number')
    params.delete('amount')
    params.delete('error')
    const url = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ''}`
    window.history.replaceState({}, '', url)
  }, [])

  const startTopup = async () => {
    const token = getToken()
    if (!token) return
    const amount = parseFloat(topupForm.amount_usd || '0')
    if (!Number.isFinite(amount) || amount <= 0) {
      setTopupError('Enter a valid amount.')
      return
    }
    if (!topupForm.customer_name.trim() || !topupForm.customer_email.trim()) {
      setTopupError('Full name and email are required.')
      return
    }
    if (!topupForm.card_holder.trim() || !topupForm.card_number.trim() || !topupForm.expire_month.trim() || !topupForm.expire_year.trim() || !topupForm.cvc.trim()) {
      setTopupError('Please fill in all card fields.')
      return
    }
    setTopupLoading(true)
    setTopupError(null)
    try {
      const res = await fetch(`${API_URL}/billing/topup/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          ...topupForm,
          amount_usd: amount,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setTopupError(data.detail || 'Failed to start payment.')
        return
      }
      const html = data.threeds_html || ''
      if (!html) {
        setTopupError('Failed to open 3D verification page.')
        return
      }
      const w = window.open('', '_blank', 'width=520,height=760')
      if (!w) {
        setTopupError('Popup blocked. Please allow popups.')
        return
      }
      w.document.open()
      w.document.write(html)
      w.document.close()
      setShowTopupModal(false)
    } catch {
      setTopupError('Connection error.')
    } finally {
      setTopupLoading(false)
    }
  }

  const openTopupModal = () => {
    setTopupError(null)
    setTopupForm((prev) => ({
      ...prev,
      customer_name: '',
      card_holder: '',
      card_number: '',
      expire_month: '',
      expire_year: '',
      cvc: '',
    }))
    setShowTopupModal(true)
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh', height: '100vh', overflow: 'hidden' }}>
      <aside
        style={{
          width: 240,
          background: 'rgba(24, 24, 27, 0.95)',
          borderRight: '1px solid #3f3f46',
          padding: '24px 0',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div style={{ padding: '0 20px 20px', borderBottom: '1px solid #3f3f46', marginBottom: 16 }}>
          <Link href="/dashboard" style={{ color: '#fff', textDecoration: 'none', fontWeight: 700, fontSize: '1.1rem' }}>
            Vox Trader
          </Link>
        </div>
        <nav>
          <Link
            href="/dashboard"
            style={{
              display: 'block',
              padding: '12px 20px',
              color: pathname === '/dashboard' ? '#818cf8' : '#a1a1aa',
              textDecoration: 'none',
              borderLeft: pathname === '/dashboard' ? '3px solid #6366f1' : '3px solid transparent',
              marginLeft: -3,
            }}
          >
            Dashboard
          </Link>
          <Link
            href="/dashboard/settings"
            style={{
              display: 'block',
              padding: '12px 20px',
              color: pathname === '/dashboard/settings' ? '#818cf8' : '#a1a1aa',
              textDecoration: 'none',
              borderLeft: pathname === '/dashboard/settings' ? '3px solid #6366f1' : '3px solid transparent',
              marginLeft: -3,
            }}
          >
            Settings
          </Link>
        </nav>
        <div style={{ marginTop: 'auto', padding: '0 20px 20px' }}>
          {balance !== null && (
            <div style={{ marginBottom: 12, padding: '10px 12px', background: '#27272a', borderRadius: 8, fontSize: '0.9rem', color: '#a1a1aa' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <div>
                  <span style={{ color: '#e4e4e7' }}>Balance: </span>
                  <strong style={{ color: '#fff' }}>${balance.toFixed(2)}</strong>
                </div>
                <button
                  type="button"
                  onClick={openTopupModal}
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: 6,
                    border: '1px solid #52525b',
                    background: '#3f3f46',
                    color: '#fff',
                    cursor: 'pointer',
                    lineHeight: 1,
                    fontWeight: 700,
                  }}
                  title="Top up balance"
                >
                  +
                </button>
              </div>
            </div>
          )}
          <button
            type="button"
            className="btn btn-secondary"
            style={{ width: '100%' }}
            onClick={() => {
              localStorage.removeItem('token')
              localStorage.removeItem('user')
              window.location.href = '/'
            }}
          >
            Log out
          </button>
        </div>
      </aside>
      <main style={{ flex: 1, minHeight: 0, padding: 32, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {children}
      </main>

      {showTopupModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.65)',
            zIndex: 1200,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
          onClick={() => setShowTopupModal(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '100%',
              maxWidth: 540,
              background: '#18181b',
              border: '1px solid #3f3f46',
              borderRadius: 14,
              maxHeight: '90vh',
              overflow: 'auto',
              padding: 18,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <h3 style={{ margin: 0, color: '#fff', fontSize: '1.05rem' }}>Top Up Balance (USD)</h3>
              <button
                type="button"
                onClick={() => setShowTopupModal(false)}
                style={{ border: 'none', background: '#3f3f46', color: '#fff', borderRadius: 8, width: 30, height: 30, cursor: 'pointer' }}
              >
                ×
              </button>
            </div>

            <div style={{ marginBottom: 12, color: '#a1a1aa', fontSize: '0.85rem' }}>
              Select an amount and enter card details.
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 8, marginBottom: 12 }}>
              {TOPUP_PRESETS.map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => {
                    setTopupPreset(String(v))
                    setTopupForm((p) => ({ ...p, amount_usd: String(v) }))
                  }}
                  style={{
                    border: topupPreset === String(v) ? '1px solid #6366f1' : '1px solid #3f3f46',
                    background: topupPreset === String(v) ? 'rgba(99,102,241,0.2)' : '#27272a',
                    color: '#fff',
                    borderRadius: 10,
                    padding: '10px 8px',
                    cursor: 'pointer',
                    fontWeight: 600,
                  }}
                >
                  ${v}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setTopupPreset('custom')}
                style={{
                  border: topupPreset === 'custom' ? '1px solid #6366f1' : '1px solid #3f3f46',
                  background: topupPreset === 'custom' ? 'rgba(99,102,241,0.2)' : '#27272a',
                  color: '#fff',
                  borderRadius: 10,
                  padding: '10px 8px',
                  cursor: 'pointer',
                  fontWeight: 600,
                }}
              >
                Custom
              </button>
            </div>

            {topupPreset === 'custom' && (
              <div style={{ marginBottom: 12 }}>
                <input
                  className="input"
                  placeholder="Amount (USD)"
                  value={topupForm.amount_usd}
                  onChange={(e) => setTopupForm((p) => ({ ...p, amount_usd: e.target.value }))}
                />
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <input className="input" placeholder="Full Name" value={topupForm.customer_name} onChange={(e) => setTopupForm((p) => ({ ...p, customer_name: e.target.value }))} />
              <input className="input" placeholder="Email" value={topupForm.customer_email} onChange={(e) => setTopupForm((p) => ({ ...p, customer_email: e.target.value }))} />
              <input className="input" placeholder="Phone" value={topupForm.customer_phone} onChange={(e) => setTopupForm((p) => ({ ...p, customer_phone: e.target.value }))} />
              <input className="input" placeholder="Cardholder Name" value={topupForm.card_holder} onChange={(e) => setTopupForm((p) => ({ ...p, card_holder: e.target.value }))} />
            </div>

            <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: '1.6fr 1fr 1fr 1fr', gap: 10 }}>
              <input className="input" placeholder="Card Number" value={topupForm.card_number} onChange={(e) => setTopupForm((p) => ({ ...p, card_number: e.target.value }))} />
              <input className="input" placeholder="Month" value={topupForm.expire_month} onChange={(e) => setTopupForm((p) => ({ ...p, expire_month: e.target.value }))} />
              <input className="input" placeholder="Year" value={topupForm.expire_year} onChange={(e) => setTopupForm((p) => ({ ...p, expire_year: e.target.value }))} />
              <input className="input" placeholder="CVC" value={topupForm.cvc} onChange={(e) => setTopupForm((p) => ({ ...p, cvc: e.target.value }))} />
            </div>

            {topupError && <div style={{ marginTop: 10, color: '#f87171', fontSize: '0.85rem' }}>{topupError}</div>}

            <button
              type="button"
              className="btn btn-primary"
              onClick={startTopup}
              disabled={topupLoading}
              style={{ width: '100%', marginTop: 14 }}
            >
              {topupLoading ? 'Starting...' : 'Start Payment in USD'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
