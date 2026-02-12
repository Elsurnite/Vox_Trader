'use client'

import { useEffect, useState, useRef, useCallback } from 'react'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8423'

type Trade = {
  symbol: string
  id: number
  orderId: number
  price: string
  qty: string
  quoteQty: string
  commission: string
  commissionAsset: string
  time: number
  isBuyer: boolean
  isMaker: boolean
}

type FuturesPosition = {
  id: number
  symbol: string
  side: string
  quantity: number
  entry_price: number
  leverage: number
  margin_used: number
  current_price: number
  unrealized_pnl: number
  created_at: string
}

type FuturesTrade = {
  symbol: string
  side: string
  quantity: number
  entry_price: number
  exit_price: number
  pnl_usdt: number
  commission_usdt: number
  created_at: string
}

type SymbolOption = { symbol: string; label: string; logo?: string }

function getToken() {
  if (typeof window === 'undefined') return null
  return localStorage.getItem('token')
}

export default function RecentTrades({ symbol, onSymbolChange, symbols, demoMode = false }: { symbol: string; onSymbolChange: (s: string) => void; symbols: SymbolOption[]; demoMode?: boolean }) {
  const [trades, setTrades] = useState<Trade[]>([])
  const [positions, setPositions] = useState<FuturesPosition[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const [listMode, setListMode] = useState<'trades' | 'positions'>('trades')
  const [historyType, setHistoryType] = useState<'spot' | 'futures'>('spot')
  const [futuresTrades, setFuturesTrades] = useState<FuturesTrade[]>([])
  const [closingId, setClosingId] = useState<number | null>(null)
  const stopPollingRef = useRef(false)

  const currentCoin = symbols.find((c) => c.symbol === symbol) || symbols[0]
  const getLogo = (sym: string) => symbols.find((c) => c.symbol === sym)?.logo

  const fetchPositions = useCallback((showLoading = false) => {
    if (stopPollingRef.current) return
    const token = getToken()
    if (!token) return
    if (showLoading) setLoading(true)
    fetch(`${API_URL}/demo/futures-account`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => {
        if (r.status === 401) {
          stopPollingRef.current = true
          if (typeof window !== 'undefined') localStorage.removeItem('token')
          setError('Session expired. Please sign in again.')
          setPositions([])
          return null
        }
        if (!r.ok) throw new Error('Failed to fetch positions')
        return r.json()
      })
      .then((data: { positions?: FuturesPosition[] } | null) => {
        if (data != null) {
          setPositions(data.positions || [])
          setError(null)
        }
      })
      .catch((e) => {
        setError(e.message)
        setPositions([])
      })
      .finally(() => { if (showLoading) setLoading(false) })
  }, [])

  const handleClosePosition = useCallback((positionId: number) => {
    const token = getToken()
    if (!token) return
    setClosingId(positionId)
    fetch(`${API_URL}/demo/futures-close`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ position_id: positionId }),
    })
      .then((r) => r.json().then((d) => ({ ok: r.ok, data: d })))
      .then(({ ok, data }) => {
        if (ok) {
          fetchPositions(false)
        } else {
          setError(data.detail || 'Failed to close position')
        }
      })
      .catch(() => setError('Failed to close position'))
      .finally(() => setClosingId(null))
  }, [fetchPositions])

  useEffect(() => {
    const token = getToken()
    if (!token) return
    if (demoMode && listMode === 'positions') {
      stopPollingRef.current = false
      setError(null)
      fetchPositions(true)
      const interval = setInterval(() => {
        if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
        fetchPositions(false)
      }, 2000)
      return () => clearInterval(interval)
    }
    setLoading(true)
    setError(null)
    if (demoMode && listMode === 'trades' && historyType === 'futures') {
      fetch(`${API_URL}/demo/futures-trades?limit=50`, { headers: { Authorization: `Bearer ${token}` } })
        .then((r) => {
          if (!r.ok) throw new Error('Failed to load futures history')
          return r.json()
        })
        .then(setFuturesTrades)
        .catch((e) => {
          setError(e.message)
          setFuturesTrades([])
        })
        .finally(() => setLoading(false))
      return
    }
    const url = demoMode
      ? `${API_URL}/demo/my-trades?symbol=${encodeURIComponent(symbol)}&limit=30`
      : `${API_URL}/binance/my-trades?symbol=${encodeURIComponent(symbol)}&limit=30`
    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => {
        if (!r.ok) throw new Error(r.status === 400 ? (demoMode ? 'Failed to load trades.' : 'Add your Binance API keys in Settings.') : 'Failed to load trades')
        return r.json()
      })
      .then(setTrades)
      .catch((e) => {
        setError(e.message)
        setTrades([])
      })
      .finally(() => setLoading(false))
  }, [symbol, demoMode, listMode, historyType, fetchPositions])

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setDropdownOpen(false)
    }
    if (dropdownOpen) document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [dropdownOpen])

  return (
    <div className="card" style={{ maxWidth: 'none', padding: 16, height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <h3 style={{ margin: 0, fontSize: '1rem' }}>Recent trades</h3>
          {demoMode && (
            <div style={{ display: 'flex', gap: 4 }}>
              <button
                type="button"
                onClick={() => setListMode('positions')}
                style={{
                  padding: '6px 10px',
                  fontSize: '0.75rem',
                  border: '1px solid #3f3f46',
                  borderRadius: 6,
                  background: listMode === 'positions' ? '#6366f1' : '#27272a',
                  color: '#fff',
                  cursor: 'pointer',
                }}
              >
                Open positions
              </button>
              <button
                type="button"
                onClick={() => setListMode('trades')}
                style={{
                  padding: '6px 10px',
                  fontSize: '0.75rem',
                  border: '1px solid #3f3f46',
                  borderRadius: 6,
                  background: listMode === 'trades' ? '#6366f1' : '#27272a',
                  color: '#fff',
                  cursor: 'pointer',
                }}
              >
                Trade history
              </button>
            </div>
          )}
        </div>
        {listMode === 'trades' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {demoMode && (
              <div style={{ display: 'flex', gap: 4 }}>
                <button
                  type="button"
                  onClick={() => setHistoryType('spot')}
                  style={{
                    padding: '6px 10px',
                    fontSize: '0.75rem',
                    border: '1px solid #3f3f46',
                    borderRadius: 6,
                    background: historyType === 'spot' ? '#6366f1' : '#27272a',
                    color: '#fff',
                    cursor: 'pointer',
                  }}
                >
                  Spot
                </button>
                <button
                  type="button"
                  onClick={() => setHistoryType('futures')}
                  style={{
                    padding: '6px 10px',
                    fontSize: '0.75rem',
                    border: '1px solid #3f3f46',
                    borderRadius: 6,
                    background: historyType === 'futures' ? '#6366f1' : '#27272a',
                    color: '#fff',
                    cursor: 'pointer',
                  }}
                >
                  Futures
                </button>
              </div>
            )}
            {(!demoMode || historyType === 'spot') && (
            <div ref={dropdownRef} style={{ position: 'relative' }}>
            <button
              type="button"
              className="input"
              onClick={() => setDropdownOpen((o) => !o)}
              style={{
                width: 'auto',
                minWidth: 140,
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              {currentCoin?.logo && (
                <img src={currentCoin.logo} alt="" width={22} height={22} style={{ borderRadius: '50%', objectFit: 'cover' }} />
              )}
              <span>{currentCoin?.label ?? symbol}</span>
              <span style={{ marginLeft: 'auto', opacity: 0.7 }}>▾</span>
            </button>
            {dropdownOpen && (
              <div
                style={{
                  position: 'absolute',
                  top: '100%',
                  right: 0,
                  marginTop: 4,
                  background: '#18181b',
                  border: '1px solid #3f3f46',
                  borderRadius: 12,
                  boxShadow: '0 10px 40px rgba(0,0,0,0.4)',
                  zIndex: 50,
                  maxHeight: 320,
                  overflowY: 'auto',
                  minWidth: 200,
                }}
              >
                {symbols.map((c) => (
                  <button
                    key={c.symbol}
                    type="button"
                    onClick={() => {
                      onSymbolChange(c.symbol)
                      setDropdownOpen(false)
                    }}
                    style={{
                      width: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      padding: '10px 14px',
                      background: c.symbol === symbol ? 'rgba(99, 102, 241, 0.2)' : 'transparent',
                      border: 'none',
                      color: '#e4e4e7',
                      cursor: 'pointer',
                      fontSize: '0.95rem',
                      textAlign: 'left',
                    }}
                  >
                    {c.logo && <img src={c.logo} alt="" width={24} height={24} style={{ borderRadius: '50%', objectFit: 'cover' }} />}
                    {c.label}
                  </button>
                ))}
              </div>
            )}
          </div>
            )}
          </div>
        )}
      </div>
      {error && <p className="error" style={{ flexShrink: 0 }}>{error}</p>}
      {loading ? (
        <p style={{ color: '#71717a', margin: 0 }}>Loading...</p>
      ) : listMode === 'positions' ? (
        positions.length === 0 ? (
          <p style={{ color: '#71717a', margin: 0 }}>No open futures positions.</p>
        ) : (
          <div style={{ overflow: 'auto', flex: 1, minHeight: 0 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #3f3f46', color: '#71717a' }}>
                  <th style={{ textAlign: 'left', padding: '8px 12px' }}>Symbol</th>
                  <th style={{ textAlign: 'right', padding: '8px 12px' }}>Side</th>
                  <th style={{ textAlign: 'right', padding: '8px 12px' }}>Entry</th>
                  <th style={{ textAlign: 'right', padding: '8px 12px' }}>Current</th>
                  <th style={{ textAlign: 'right', padding: '8px 12px' }}>Amount</th>
                  <th style={{ textAlign: 'right', padding: '8px 12px' }}>Leverage</th>
                  <th style={{ textAlign: 'right', padding: '8px 12px' }}>Margin</th>
                  <th style={{ textAlign: 'right', padding: '8px 12px' }}>PnL</th>
                  <th style={{ textAlign: 'center', padding: '8px 12px' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {positions.map((p, i) => (
                  <tr key={p.id} style={{ borderBottom: '1px solid #27272a' }}>
                    <td style={{ padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
                      {getLogo(p.symbol) && <img src={getLogo(p.symbol)} alt="" width={20} height={20} style={{ borderRadius: '50%', objectFit: 'cover' }} />}
                      {p.symbol}
                    </td>
                    <td style={{ textAlign: 'right', padding: '8px 12px', color: p.side === 'LONG' ? '#22c55e' : '#ef4444' }}>{p.side}</td>
                    <td style={{ textAlign: 'right', padding: '8px 12px' }}>{p.entry_price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 8 })}</td>
                    <td style={{ textAlign: 'right', padding: '8px 12px' }}>{p.current_price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 8 })}</td>
                    <td style={{ textAlign: 'right', padding: '8px 12px' }}>{p.quantity.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 8 })}</td>
                    <td style={{ textAlign: 'right', padding: '8px 12px' }}>{p.leverage}x</td>
                    <td style={{ textAlign: 'right', padding: '8px 12px', color: '#a1a1aa' }}>{p.margin_used.toFixed(2)} USDT</td>
                    <td style={{ textAlign: 'right', padding: '8px 12px', color: p.unrealized_pnl >= 0 ? '#22c55e' : '#f87171' }}>
                      {p.unrealized_pnl >= 0 ? '+' : ''}{p.unrealized_pnl.toFixed(2)} USDT
                    </td>
                    <td style={{ textAlign: 'center', padding: '8px 12px' }}>
                      <button
                        type="button"
                        onClick={() => handleClosePosition(p.id)}
                        disabled={closingId === p.id}
                        style={{
                          padding: '4px 10px',
                          fontSize: '0.75rem',
                          border: '1px solid #3f3f46',
                          borderRadius: 6,
                          background: closingId === p.id ? '#3f3f46' : '#27272a',
                          color: '#f87171',
                          cursor: closingId === p.id ? 'not-allowed' : 'pointer',
                        }}
                      >
                        {closingId === p.id ? 'Closing...' : 'Close'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : demoMode && historyType === 'futures' ? (
        futuresTrades.length === 0 ? (
          <p style={{ color: '#71717a', margin: 0 }}>No closed futures trades.</p>
        ) : (
          <div style={{ overflow: 'auto', flex: 1, minHeight: 0 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #3f3f46', color: '#71717a' }}>
                  <th style={{ textAlign: 'left', padding: '8px 12px' }}>Date</th>
                  <th style={{ textAlign: 'left', padding: '8px 12px' }}>Symbol</th>
                  <th style={{ textAlign: 'right', padding: '8px 12px' }}>Side</th>
                  <th style={{ textAlign: 'right', padding: '8px 12px' }}>Amount</th>
                  <th style={{ textAlign: 'right', padding: '8px 12px' }}>Entry</th>
                  <th style={{ textAlign: 'right', padding: '8px 12px' }}>Exit</th>
                  <th style={{ textAlign: 'right', padding: '8px 12px' }}>PnL</th>
                  <th style={{ textAlign: 'right', padding: '8px 12px' }}>Komisyon</th>
                </tr>
              </thead>
              <tbody>
                {futuresTrades.map((t, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid #27272a' }}>
                    <td style={{ padding: '8px 12px', color: '#a1a1aa' }}>
                      {new Date(t.created_at).toLocaleString('en-US')}
                    </td>
                    <td style={{ padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
                      {getLogo(t.symbol) && <img src={getLogo(t.symbol)} alt="" width={20} height={20} style={{ borderRadius: '50%', objectFit: 'cover' }} />}
                      {t.symbol}
                    </td>
                    <td style={{ textAlign: 'right', padding: '8px 12px', color: t.side === 'LONG' ? '#22c55e' : '#ef4444' }}>{t.side}</td>
                    <td style={{ textAlign: 'right', padding: '8px 12px' }}>{t.quantity.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 8 })}</td>
                    <td style={{ textAlign: 'right', padding: '8px 12px' }}>{t.entry_price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 8 })}</td>
                    <td style={{ textAlign: 'right', padding: '8px 12px' }}>{t.exit_price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 8 })}</td>
                    <td style={{ textAlign: 'right', padding: '8px 12px', color: t.pnl_usdt >= 0 ? '#22c55e' : '#f87171' }}>
                      {t.pnl_usdt >= 0 ? '+' : ''}{t.pnl_usdt.toFixed(2)} USDT
                    </td>
                    <td style={{ textAlign: 'right', padding: '8px 12px', color: '#71717a' }}>{t.commission_usdt.toFixed(2)} USDT</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : trades.length === 0 ? (
          <p style={{ color: '#71717a', margin: 0 }}>No trades yet.</p>
      ) : (
        <div style={{ overflow: 'auto', flex: 1, minHeight: 0 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #3f3f46', color: '#71717a' }}>
                <th style={{ textAlign: 'left', padding: '8px 12px' }}>Time</th>
                <th style={{ textAlign: 'left', padding: '8px 12px' }}>Symbol</th>
                <th style={{ textAlign: 'right', padding: '8px 12px' }}>Side</th>
                <th style={{ textAlign: 'right', padding: '8px 12px' }}>Price</th>
                <th style={{ textAlign: 'right', padding: '8px 12px' }}>Amount</th>
                <th style={{ textAlign: 'right', padding: '8px 12px' }}>Commission</th>
              </tr>
            </thead>
            <tbody>
              {trades.map((t) => (
                <tr key={t.id} style={{ borderBottom: '1px solid #27272a' }}>
                  <td style={{ padding: '8px 12px', color: '#a1a1aa' }}>
                    {new Date(t.time).toLocaleString('en-US')}
                  </td>
                  <td style={{ padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
                    {getLogo(t.symbol) ? (
                      <img src={getLogo(t.symbol)} alt="" width={20} height={20} style={{ borderRadius: '50%', objectFit: 'cover' }} />
                    ) : null}
                    {t.symbol}
                  </td>
                  <td style={{ textAlign: 'right', padding: '8px 12px', color: t.isBuyer ? '#22c55e' : '#ef4444' }}>
                    {t.isBuyer ? 'BUY' : 'SELL'}
                  </td>
                  <td style={{ textAlign: 'right', padding: '8px 12px' }}>{Number(t.price).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 8 })}</td>
                  <td style={{ textAlign: 'right', padding: '8px 12px' }}>{Number(t.qty).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 8 })}</td>
                  <td style={{ textAlign: 'right', padding: '8px 12px', color: '#71717a' }}>{t.commission} {t.commissionAsset}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
