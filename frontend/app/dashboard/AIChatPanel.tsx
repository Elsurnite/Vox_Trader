'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import html2canvas from 'html2canvas'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8423'

function getToken() {
  if (typeof window === 'undefined') return null
  return localStorage.getItem('token')
}

type AgentResult = {
  analysis: string
  action: 'BUY' | 'SELL' | 'HOLD'
  buy_at: number | null
  sell_at: number | null
  message: string
  time?: string
}

const STRATEGIES = [
  { value: 'agresif', label: 'Aggressive (short-term)' },
  { value: 'pasif', label: 'Passive (low risk)' },
  { value: 'uzun_vade', label: 'Long-term' },
  { value: 'kisa_vade', label: 'Short-term (daily)' },
] as const

const AGENT_INTERVALS = [
  { value: 5, label: '5 seconds' },
  { value: 10, label: '10 seconds' },
  { value: 30, label: '30 seconds' },
  { value: 60, label: '1 minute' },
  { value: 300, label: '5 minutes' },
]

const BALANCE_OPTIONS = [
  { value: 'demo', label: 'Demo balance' },
] as const

function AnalysisModalContent({
  selected,
  onClose,
  getToken,
  apiUrl,
}: {
  selected: { analysisId?: number; fullAnalysis?: string }
  onClose: () => void
  getToken: () => string | null
  apiUrl: string
}) {
  const [text, setText] = useState<string | null>(selected.fullAnalysis ?? null)
  const [loading, setLoading] = useState(!selected.fullAnalysis && !!selected.analysisId)
  useEffect(() => {
    if (selected.fullAnalysis) {
      setText(selected.fullAnalysis)
      return
    }
    if (selected.analysisId) {
      const token = getToken()
      if (!token) return
      setLoading(true)
      fetch(`${apiUrl}/ai/agent/analyses/${selected.analysisId}`, { headers: { Authorization: `Bearer ${token}` } })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => (d ? setText(d.analysis_text || d.message_short || '') : setText('')))
        .finally(() => setLoading(false))
    }
  }, [selected.analysisId, selected.fullAnalysis, getToken, apiUrl])
  return (
    <>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid #3f3f46', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontWeight: 600, color: '#e4e4e7' }}>Analysis</span>
        <button type="button" onClick={onClose} style={{ background: '#3f3f46', border: 'none', color: '#fff', width: 32, height: 32, borderRadius: 8, cursor: 'pointer' }}>×</button>
      </div>
      <div style={{ padding: 16, overflow: 'auto', flex: 1, fontSize: '0.9rem', color: '#e4e4e7', whiteSpace: 'pre-wrap' }}>
        {loading ? 'Loading...' : (text || '—')}
      </div>
    </>
  )
}

function EquityChart({ data, initial }: { data: { t: string; equity: number }[]; initial: number }) {
  if (data.length < 2) return null
  const values = data.map((d) => d.equity)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  const padding = 4
  const w = 280
  const h = 72
  const points = data.map((d, i) => {
    const x = padding + (i / (data.length - 1)) * (w - 2 * padding)
    const y = h - padding - ((d.equity - min) / range) * (h - 2 * padding)
    return `${x},${y}`
  }).join(' ')
  const lineColor = (data[data.length - 1]?.equity ?? 0) >= initial ? '#22c55e' : '#f87171'
  return (
    <svg width="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ display: 'block' }}>
      <polyline fill="none" stroke={lineColor} strokeWidth="1.5" points={points} />
    </svg>
  )
}

type AIChatPanelProps = {
  chartContainerRef?: React.RefObject<HTMLDivElement | null>
  chartInfoRef?: React.RefObject<{ symbol: string; interval: string } | null>
}

export default function AIChatPanel({ chartContainerRef, chartInfoRef }: AIChatPanelProps) {
  const [tab, setTab] = useState<'chat' | 'agent'>('chat')
  const [messages, setMessages] = useState<{ role: 'user' | 'ai'; text: string }[]>([
    { role: 'ai', text: 'Hi! I am your Vox Trader AI assistant. I run on GLM-4.6V-Flash. You can ask about markets, trading, or portfolio topics. I can also analyze charts in Agent mode.' },
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  // Agent state
  const [agentRunning, setAgentRunning] = useState(false)
  const [agentStrategy, setAgentStrategy] = useState<typeof STRATEGIES[number]['value']>('kisa_vade')
  const [agentIntervalSec, setAgentIntervalSec] = useState(60)
  const [agentPrompt, setAgentPrompt] = useState('')
  const [agentLoading, setAgentLoading] = useState(false)
  const [agentResult, setAgentResult] = useState<AgentResult | null>(null)
  const [showAgentInfo, setShowAgentInfo] = useState(false)
  const [agentTradeEnabled, setAgentTradeEnabled] = useState(false)
  const [agentBalanceType, setAgentBalanceType] = useState<typeof BALANCE_OPTIONS[number]['value']>('demo')
  const [agentMarketType, setAgentMarketType] = useState<'spot' | 'futures'>('spot')
  const [agentLeverage, setAgentLeverage] = useState(10)
  const [agentOrderAmountInput, setAgentOrderAmountInput] = useState('100')
  const [agentOrderAmountMode, setAgentOrderAmountMode] = useState<'fixed' | 'max'>('fixed')
  const [agentMaxOpenPositions, setAgentMaxOpenPositions] = useState(1)
  const [agentMinTradeIntervalSec, setAgentMinTradeIntervalSec] = useState(0)
  const [agentSingleTradeIfMax, setAgentSingleTradeIfMax] = useState(true)
  const [showAgentStartModal, setShowAgentStartModal] = useState(false)
  const [lastOrderMessage, setLastOrderMessage] = useState<string | null>(null)
  const [lastOrderError, setLastOrderError] = useState(false)
  const [performance, setPerformance] = useState<{
    total_trades: number
    buy_count: number
    sell_count: number
    total_commission: number
    initial_balance: number
    current_balance: number
    total_equity?: number
    equity_change?: number
    equity_curve?: { t: string; equity: number }[]
    last_trades: { side: string; symbol: string; quantity: number; price_usdt: number; usdt_amount: number; commission_usdt?: number; created_at: string }[]
  } | null>(null)
  const [futuresPerformance, setFuturesPerformance] = useState<{
    margin_available: number
    positions: { symbol: string; side: string; quantity: number; entry_price: number; leverage: number; margin_used: number; current_price: number; unrealized_pnl: number; created_at: string }[]
    total_unrealized_pnl: number
    realized_pnl: number
    total_commission: number
    initial_balance: number
    total_equity: number
    equity_change: number
    last_trades: { symbol: string; side: string; quantity: number; entry_price: number; exit_price: number; pnl_usdt: number; commission_usdt: number; created_at: string }[]
  } | null>(null)
  const [agentLog, setAgentLog] = useState<{ id: number; time: string; message: string; fullAnalysis?: string; analysisId?: number }[]>([])
  const agentLogIdRef = useRef(0)
  const [agentSectionOpen, setAgentSectionOpen] = useState({ output: true, performance: true, result: true })
  const [selectedAnalysis, setSelectedAnalysis] = useState<{ analysisId?: number; fullAnalysis?: string } | null>(null)
  const [agentModel, setAgentModel] = useState('GLM-4.6V-Flash')
  const [agentModelsList, setAgentModelsList] = useState<{ id: string; label: string }[]>([])
  const [resettingFutures, setResettingFutures] = useState(false)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    if (tab !== 'agent') return
    const token = getToken()
    if (!token) return
    fetch(`${API_URL}/ai/models`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.models?.length) setAgentModelsList(d.models.map((m: { id: string; label: string }) => ({ id: m.id, label: m.label }))) })
      .catch(() => {})
    fetch(`${API_URL}/demo/performance`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : null))
      .then(setPerformance)
      .catch(() => setPerformance(null))
    fetch(`${API_URL}/demo/futures-performance`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : null))
      .then(setFuturesPerformance)
      .catch(() => setFuturesPerformance(null))
  }, [tab, lastOrderMessage])

  useEffect(() => {
    if (tab !== 'agent') return
    const token = getToken()
    if (!token) return
    const syncPerformance = () => {
      Promise.all([
        fetch(`${API_URL}/demo/performance`, { headers: { Authorization: `Bearer ${token}` } })
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
        fetch(`${API_URL}/demo/futures-performance`, { headers: { Authorization: `Bearer ${token}` } })
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
      ]).then(([spot, futures]) => {
        if (spot) setPerformance(spot)
        if (futures) setFuturesPerformance(futures)
      })
    }
    syncPerformance()
    const interval = setInterval(syncPerformance, 4000)
    return () => clearInterval(interval)
  }, [tab])

  const addAgentLog = useCallback((message: string, fullAnalysis?: string, analysisId?: number) => {
    const t = new Date().toLocaleTimeString('en-US')
    setAgentLog((prev) => [...prev, { id: ++agentLogIdRef.current, time: t, message, fullAnalysis, analysisId }])
  }, [])

  const runAgentAnalysis = useCallback(async () => {
    const token = getToken()
    if (!token) return
    const el = chartContainerRef?.current
    const info = chartInfoRef?.current
    if (!el && !info) {
      setError('Chart area not found.')
      return
    }

    setAgentLoading(true)
    setError(null)
    addAgentLog('Analyzing chart...')
    let imageBase64 = ''
    try {
      if (el) {
        const canvas = await html2canvas(el, {
          useCORS: true,
          scale: 1,
          backgroundColor: '#18181b',
          logging: false,
        })
        imageBase64 = canvas.toDataURL('image/png').split(',')[1] || ''
      }
      const symbol = info?.symbol || 'BTCUSDT'
      const interval = info?.interval || '1m'
      const res = await fetch(`${API_URL}/ai/agent/analyze`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          image_base64: imageBase64 || undefined,
          symbol,
          interval,
          strategy: agentStrategy,
          custom_prompt: agentPrompt.trim() || undefined,
          market_type: agentMarketType,
          model: agentModel,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.detail || 'Failed to get analysis.')
        return
      }
      const result: AgentResult = {
        analysis: data.analysis || '',
        action: data.action || 'HOLD',
        buy_at: data.buy_at ?? null,
        sell_at: data.sell_at ?? null,
        message: data.message || '',
        time: new Date().toISOString(),
      }
      setAgentResult(result)
      const fullText = result.analysis || result.message || ''
      const aid = data.analysis_id ?? undefined
      if (result.action === 'BUY') addAgentLog('Suggestion: Buy signal / buy is possible.', fullText, aid)
      else if (result.action === 'SELL') addAgentLog('Suggestion: Sell signal / sell is possible.', fullText, aid)
      else addAgentLog('Suggestion: Hold (do not open position).', fullText, aid)

      // If trading is enabled and balance type is demo: execute demo buy/sell from AI result.
      if (agentTradeEnabled && agentBalanceType === 'demo' && (result.action === 'BUY' || result.action === 'SELL')) {
        const symbol = info?.symbol || 'BTCUSDT'
        const marginOrQty = (parseFloat(agentOrderAmountInput) || 0) > 0 ? parseFloat(agentOrderAmountInput) : 100
        try {
          if (agentMarketType === 'futures') {
            const orderRes = await fetch(`${API_URL}/demo/futures-order`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({
                side: result.action === 'BUY' ? 'LONG' : 'SHORT',
                symbol,
                margin_usdt: marginOrQty,
                leverage: agentLeverage,
              }),
            })
            const orderData = await orderRes.json().catch(() => ({}))
            if (orderRes.ok && orderData.message) {
              setLastOrderMessage(orderData.message)
              setLastOrderError(false)
              addAgentLog(result.action === 'BUY' ? 'Long opened.' : 'Short opened.')
            } else {
              setLastOrderMessage(orderData.detail || 'Trade could not be executed')
              setLastOrderError(true)
              addAgentLog('Trade could not be executed.')
            }
          } else {
            const orderRes = await fetch(`${API_URL}/demo/order`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify(
                result.action === 'BUY'
                  ? { side: 'BUY', symbol, quote_order_qty: marginOrQty }
                  : { side: 'SELL', symbol }
              ),
            })
            const orderData = await orderRes.json().catch(() => ({}))
            if (orderRes.ok && orderData.message) {
              setLastOrderMessage(orderData.message)
              setLastOrderError(false)
              if (result.action === 'BUY') addAgentLog('Buy order executed.')
              else addAgentLog('Sell order executed.')
            } else {
              setLastOrderMessage(orderData.detail || 'Trade could not be executed')
              setLastOrderError(true)
              addAgentLog('Trade could not be executed.')
            }
          }
        } catch {
          setLastOrderMessage('Demo trade error')
          setLastOrderError(true)
          addAgentLog('Demo trade error.')
        }
      } else {
        setLastOrderMessage(null)
        setLastOrderError(false)
      }
    } catch {
      setError('Connection error.')
    } finally {
      setAgentLoading(false)
    }
  }, [agentStrategy, agentPrompt, agentModel, chartContainerRef, chartInfoRef, agentTradeEnabled, agentBalanceType, agentOrderAmountInput, agentMarketType, agentLeverage, addAgentLog])

  // Background agent runs server-side and continues even when page is closed. Sync with status API.
  useEffect(() => {
    if (tab !== 'agent') return
    const token = getToken()
    if (!token) return
    const fetchStatus = () => {
      fetch(`${API_URL}/ai/agent/status`, { headers: { Authorization: `Bearer ${token}` } })
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (!data) return
          setAgentRunning(!!data.is_running)
          if (data.is_running && data.job) {
            if (data.job.market_type === 'spot' || data.job.market_type === 'futures') setAgentMarketType(data.job.market_type)
            setAgentTradeEnabled(!!data.job.trade_enabled)
            if (data.job.order_amount != null) setAgentOrderAmountInput(String(data.job.order_amount))
            if (data.job.order_amount_mode === 'fixed' || data.job.order_amount_mode === 'max') setAgentOrderAmountMode(data.job.order_amount_mode)
            if (data.job.max_open_positions != null) setAgentMaxOpenPositions(Math.max(1, Math.min(50, Number(data.job.max_open_positions) || 1)))
            if (data.job.min_trade_interval_sec != null) setAgentMinTradeIntervalSec(Math.max(0, Math.min(86400, Number(data.job.min_trade_interval_sec) || 0)))
            setAgentSingleTradeIfMax(data.job.single_trade_if_max !== false && Number(data.job.single_trade_if_max) !== 0)
            if (data.job.leverage != null) setAgentLeverage(Math.max(1, Math.min(125, Number(data.job.leverage) || 10)))
            if (data.job.model) setAgentModel(data.job.model)
          }
          if (data.logs && Array.isArray(data.logs)) {
            setAgentLog(
              data.logs.map((e: { id: number; time: string; message: string; analysis_id?: number }) => ({
                id: e.id,
                time: e.time || '',
                message: e.message,
                analysisId: e.analysis_id,
              }))
            )
          }
          if (data.last_analysis) {
            const la = data.last_analysis as { action: string; analysis?: string; message?: string; buy_at?: number | null; sell_at?: number | null; time?: string }
            setAgentResult({
              action: (la.action === 'BUY' || la.action === 'SELL' ? la.action : 'HOLD') as 'BUY' | 'SELL' | 'HOLD',
              analysis: la.analysis ?? '',
              message: la.message ?? la.analysis ?? '',
              buy_at: la.buy_at ?? null,
              sell_at: la.sell_at ?? null,
              time: la.time,
            })
          }
        })
        .catch(() => {})
    }
    fetchStatus()
    const interval = setInterval(fetchStatus, 4000)
    return () => clearInterval(interval)
  }, [tab])

  const startAgent = async () => {
    const token = getToken()
    if (!token) return
    const symbol = chartInfoRef?.current?.symbol || 'BTCUSDT'
    const interval = chartInfoRef?.current?.interval || '1m'
    setError(null)
    if (agentTradeEnabled && agentOrderAmountMode === 'fixed') {
      const amount = parseFloat(agentOrderAmountInput || '0')
      if (!Number.isFinite(amount) || amount <= 0) {
        setError('Enter a valid trade amount.')
        return
      }
    }
    try {
      setAgentLoading(true)
      const res = await fetch(`${API_URL}/ai/agent/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          symbol,
          interval,
          strategy: agentStrategy,
          custom_prompt: agentPrompt.trim() || '',
          market_type: agentMarketType,
          trade_enabled: agentTradeEnabled,
          order_amount: agentOrderAmountMode === 'max' ? 0 : (parseFloat(agentOrderAmountInput) || 100),
          order_amount_mode: agentOrderAmountMode,
          max_open_positions: Math.max(1, Math.min(50, Number(agentMaxOpenPositions) || 1)),
          min_trade_interval_sec: Math.max(0, Math.min(86400, Number(agentMinTradeIntervalSec) || 0)),
          single_trade_if_max: !!agentSingleTradeIfMax,
          leverage: agentLeverage,
          interval_sec: agentIntervalSec,
          model: agentModel,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.detail || 'Failed to start agent.')
        return
      }
      setAgentRunning(true)
      setShowAgentStartModal(false)
      // Status poll will update log
    } catch {
      setError('Connection error.')
    } finally {
      setAgentLoading(false)
    }
  }

  const stopAgent = async () => {
    const token = getToken()
    if (!token) return
    try {
      await fetch(`${API_URL}/ai/agent/stop`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } })
      setAgentRunning(false)
      // Status poll will update log
    } catch {}
  }

  const resetFuturesPerformance = async () => {
    const token = getToken()
    if (!token) return
    if (!window.confirm('Reset futures performance? (Open positions and futures history will be cleared)')) return
    setResettingFutures(true)
    setError(null)
    try {
      const res = await fetch(`${API_URL}/demo/futures-performance/reset`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.detail || 'Reset failed.')
        return
      }
      setLastOrderError(false)
      setLastOrderMessage(data.message || 'Futures performance reset.')
      const [pRes, fRes] = await Promise.all([
        fetch(`${API_URL}/demo/performance`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${API_URL}/demo/futures-performance`, { headers: { Authorization: `Bearer ${token}` } }),
      ])
      if (pRes.ok) setPerformance(await pRes.json())
      if (fRes.ok) setFuturesPerformance(await fRes.json())
    } catch {
      setError('Connection error.')
    } finally {
      setResettingFutures(false)
    }
  }

  const send = async () => {
    const text = input.trim()
    if (!text || loading) return
    setMessages((m) => [...m, { role: 'user', text }])
    setInput('')
    setLoading(true)
    setError(null)
    const token = getToken()
    try {
      const history = messages.map((m) => ({
        role: m.role === 'user' ? 'user' as const : 'assistant' as const,
        content: m.text,
      }))
      history.push({ role: 'user' as const, content: text })
      const res = await fetch(`${API_URL}/ai/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ messages: history }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setMessages((m) => [...m, { role: 'ai', text: data.detail || 'Failed to get response.' }])
        setError(data.detail || 'Error')
        return
      }
      setMessages((m) => [...m, { role: 'ai', text: data.content || '' }])
    } catch {
      setMessages((m) => [...m, { role: 'ai', text: 'Connection error. Please try again.' }])
      setError('Connection error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className="card"
      style={{
        maxWidth: 'none',
        flex: 1,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        padding: 16,
      }}
    >
      <div
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 5,
          background: '#18181b',
          marginBottom: 10,
          paddingBottom: 10,
          borderBottom: '1px solid #27272a',
        }}
      >
        <div style={{ display: 'flex', border: '1px solid #3f3f46', borderRadius: 12, overflow: 'hidden' }}>
          <button
            type="button"
            onClick={() => setTab('chat')}
            style={{
              flex: 1,
              padding: '10px 12px',
              fontSize: '0.9rem',
              fontWeight: 600,
              border: 'none',
              background: tab === 'chat' ? '#6366f1' : '#27272a',
              color: '#fff',
              cursor: 'pointer',
            }}
          >
            Chat
          </button>
          <button
            type="button"
            onClick={() => setTab('agent')}
            style={{
              flex: 1,
              padding: '10px 12px',
              fontSize: '0.9rem',
              fontWeight: 600,
              border: 'none',
              borderLeft: '1px solid #3f3f46',
              background: tab === 'agent' ? '#6366f1' : '#27272a',
              color: '#fff',
              cursor: 'pointer',
            }}
          >
            Agent
          </button>
        </div>
        <div style={{ marginTop: 10 }}>
          {tab === 'agent' ? (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'auto minmax(180px, 1fr) auto',
                alignItems: 'center',
                gap: 10,
                border: '1px solid #3f3f46',
                background: '#27272a',
                borderRadius: 10,
                padding: '8px 10px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
                <span style={{ width: 9, height: 9, borderRadius: '50%', background: agentRunning ? '#22c55e' : '#71717a' }} />
                <span style={{ fontSize: '0.78rem', color: '#a1a1aa', fontWeight: 600 }}>{agentRunning ? 'Agent active' : 'Agent ready'}</span>
              </div>
              <select
                className="input"
                value={agentModel}
                onChange={(e) => setAgentModel(e.target.value)}
                disabled={agentRunning}
                title={agentRunning ? 'Stop agent to change model.' : 'Select agent model'}
                style={{
                  marginBottom: 0,
                  width: '100%',
                  height: 34,
                  padding: '4px 10px',
                  fontSize: '0.88rem',
                  background: '#18181b',
                  border: '1px solid #3f3f46',
                  borderRadius: 8,
                }}
              >
                {agentModelsList.length ? agentModelsList.map((m) => (
                  <option key={m.id} value={m.id}>{`AI (${m.label})`}</option>
                )) : (
                  <option value="GLM-4.6V-Flash">AI (GLM-4.6V-Flash)</option>
                )}
              </select>
              <button
                type="button"
                onClick={() => setShowAgentInfo(true)}
                title="Model pricing and agent info"
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 8,
                  border: '1px solid #3f3f46',
                  background: '#18181b',
                  color: '#818cf8',
                  fontSize: '0.9rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: 0,
                  lineHeight: 1,
                }}
              >
                i
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#22c55e' }} />
              <h3 style={{ margin: 0, fontSize: '1rem' }}>AI Assistant</h3>
            </div>
          )}
        </div>
      </div>

      {tab === 'chat' && (
        <>
          {error && <p className="error" style={{ marginBottom: 8 }}>{error}</p>}
          <div
            style={{
              flex: 1,
              overflow: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
              paddingRight: 4,
            }}
          >
            {messages.map((msg, i) => (
              <div
                key={i}
                style={{
                  alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
                  maxWidth: '85%',
                  padding: '10px 14px',
                  borderRadius: 12,
                  background: msg.role === 'user' ? '#6366f1' : '#27272a',
                  color: '#fff',
                  fontSize: '0.9rem',
                }}
              >
                {msg.text}
              </div>
            ))}
            {loading && (
              <div style={{ alignSelf: 'flex-start', padding: '10px 14px', background: '#27272a', borderRadius: 12 }}>
                ...
              </div>
            )}
            <div ref={bottomRef} />
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <input
              type="text"
              className="input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && send()}
              placeholder="Type a message..."
              style={{ flex: 1, marginBottom: 0 }}
            />
            <button type="button" className="btn btn-primary" onClick={send} style={{ width: 'auto', paddingLeft: 20, paddingRight: 20 }}>
              Send
            </button>
          </div>
        </>
      )}

      {tab === 'agent' && (
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
            <span style={{ fontSize: '0.85rem', color: '#a1a1aa' }}>Chart analysis and buy/sell suggestions</span>
            {!agentRunning ? (
              <button type="button" className="btn btn-primary" onClick={() => setShowAgentStartModal(true)} style={{ padding: '8px 16px', fontSize: '0.9rem' }}>
                Start Agent
              </button>
            ) : (
              <button type="button" className="btn btn-secondary" onClick={stopAgent} style={{ padding: '8px 16px', fontSize: '0.9rem' }}>
                Stop Agent
              </button>
            )}
          </div>
          {agentRunning && (
            <div style={{ marginBottom: 10, fontSize: '0.78rem', color: '#a1a1aa' }}>
              Market: <strong style={{ color: '#e4e4e7' }}>{agentMarketType === 'futures' ? 'Futures' : 'Spot'}</strong>
              {'  '}|{'  '}Trading mode: <strong style={{ color: agentTradeEnabled ? '#22c55e' : '#f87171' }}>{agentTradeEnabled ? 'On' : 'Off'}</strong>
              {'  '}|{'  '}Amount: <strong style={{ color: '#e4e4e7' }}>{agentOrderAmountMode === 'max' ? 'Maximum balance' : `${agentOrderAmountInput || '100'} USDT`}</strong>
              {agentMarketType === 'futures' ? <> {'  '}|{'  '}Leverage: <strong style={{ color: '#e4e4e7' }}>{agentLeverage}x</strong></> : null}
              {agentTradeEnabled ? <> {'  '}|{'  '}Limit: <strong style={{ color: '#e4e4e7' }}>max {agentMaxOpenPositions} positions</strong></> : null}
            </div>
          )}
          {showAgentInfo && (
            <div
              style={{
                position: 'fixed',
                inset: 0,
                zIndex: 1000,
                background: 'rgba(0,0,0,0.7)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 24,
              }}
              onClick={() => setShowAgentInfo(false)}
            >
              <div
                style={{
                  background: '#18181b',
                  border: '1px solid #3f3f46',
                  borderRadius: 16,
                  maxWidth: 480,
                  maxHeight: '85vh',
                  overflow: 'hidden',
                  display: 'flex',
                  flexDirection: 'column',
                  boxShadow: '0 25px 50px rgba(0,0,0,0.5)',
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <div style={{ padding: '16px 20px', borderBottom: '1px solid #3f3f46', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <h3 style={{ margin: 0, fontSize: '1.1rem' }}>What is Agent? How does it work?</h3>
                  <button
                    type="button"
                    onClick={() => setShowAgentInfo(false)}
                    style={{
                      background: '#3f3f46',
                      border: 'none',
                      color: '#fff',
                      width: 32,
                      height: 32,
                      borderRadius: 8,
                      cursor: 'pointer',
                      fontSize: '1.2rem',
                      lineHeight: 1,
                    }}
                  >
                    ×
                  </button>
                </div>
                <div style={{ padding: 20, overflow: 'auto', flex: 1, fontSize: '0.9rem', lineHeight: 1.65, color: '#e4e4e7' }}>
                  <p style={{ marginTop: 0, marginBottom: 12 }}>
                    <strong>Agent</strong> is an AI mode that reviews the chart on the left at fixed intervals and gives <strong>BUY</strong>, <strong>SELL</strong>, or <strong>HOLD</strong> suggestions. It performs technical analysis on real-time price movement and can optionally suggest target prices like "buy at this level" or "sell at this level."
                  </p>

                  <h4 style={{ margin: '16px 0 8px', fontSize: '0.95rem', color: '#a1a1aa' }}>How does it work?</h4>
                  <ol style={{ margin: 0, paddingLeft: 20 }}>
                    <li style={{ marginBottom: 8 }}><strong>Chart snapshot:</strong> At your selected interval (e.g. every 1 minute), a screenshot of the candlestick chart is taken.</li>
                    <li style={{ marginBottom: 8 }}><strong>AI analysis:</strong> The image is sent to the selected model together with symbol (e.g. BTCUSDT) and timeframe (1m, 5m, 1h, etc.).</li>
                    <li style={{ marginBottom: 8 }}><strong>Strategy and instruction:</strong> Your selected strategy (aggressive, passive, long-term, short-term) and optional prompt guide the model.</li>
                    <li style={{ marginBottom: 8 }}><strong>Suggestion:</strong> The model evaluates the chart and returns <strong>BUY</strong>, <strong>SELL</strong>, or <strong>HOLD</strong>. Target prices can also be included and are extracted automatically.</li>
                  </ol>

                  <h4 style={{ margin: '16px 0 8px', fontSize: '0.95rem', color: '#a1a1aa' }}>What do strategies mean?</h4>
                  <ul style={{ margin: 0, paddingLeft: 20 }}>
                    <li style={{ marginBottom: 6 }}><strong>Aggressive:</strong> Short-term and more frequent trades. Focuses on scalping and intraday opportunities with tighter stop-losses.</li>
                    <li style={{ marginBottom: 6 }}><strong>Passive:</strong> Lower risk. Suggests fewer trades and acts only on stronger signals.</li>
                    <li style={{ marginBottom: 6 }}><strong>Long-term:</strong> Focuses on weekly/monthly trend direction and swing-like decisions.</li>
                    <li style={{ marginBottom: 6 }}><strong>Short-term:</strong> Intraday-oriented with clearer entry/exit levels and technical pattern focus.</li>
                  </ul>

                  <h4 style={{ margin: '16px 0 8px', fontSize: '0.95rem', color: '#a1a1aa' }}>Example usage</h4>
                  <p style={{ marginBottom: 8 }}>
                    You have BTCUSDT 1-minute candles open on the chart. Click <strong>Start Agent</strong>, choose strategy as "Short-term", and interval as "1 minute". Optional prompt example: <em>"Only suggest buys on clear support levels; otherwise return HOLD."</em>
                  </p>
                  <p style={{ marginBottom: 8 }}>
                    Every minute, the chart is captured and analyzed. Example output: <strong>BUY</strong>, "buy at 94,200, target 95,500". The panel shows a green <strong>BUY</strong> tag and <strong>Buy: 94200</strong>. If trend changes next cycle, you may get <strong>SELL</strong> or <strong>HOLD</strong>.
                  </p>

                  <h4 style={{ margin: '16px 0 8px', fontSize: '0.95rem', color: '#a1a1aa' }}>Important notes</h4>
                  <ul style={{ margin: 0, paddingLeft: 20 }}>
                    <li style={{ marginBottom: 6 }}><strong>Agent runs on server:</strong> It keeps running even if you leave the page; status/history appears when you return.</li>
                    <li style={{ marginBottom: 6 }}><strong>Execute trades</strong> off: only suggestions are produced. If on and balance type is <strong>Demo balance</strong>, AI <strong>BUY</strong> triggers demo buy and AI <strong>SELL</strong> triggers demo sell (no real funds).</li>
                    <li style={{ marginBottom: 6 }}>Symbol and timeframe are saved when starting; analysis runs periodically on server with those settings.</li>
                    <li style={{ marginBottom: 6 }}>Price levels are extracted from model text automatically; check the analysis text if number formatting prevents display.</li>
                  </ul>

                  <h4 style={{ margin: '16px 0 8px', fontSize: '0.95rem', color: '#a1a1aa' }}>Model pricing (1M tokens)</h4>
                  <div style={{ border: '1px solid #3f3f46', borderRadius: 10, overflow: 'hidden', fontSize: '0.82rem' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr 1fr', background: '#27272a', color: '#a1a1aa', padding: '8px 10px', fontWeight: 600 }}>
                      <span>Model</span><span>Input</span><span>Output</span>
                    </div>
                    {[
                      ['GLM-4.6V-Flash', 'Free', 'Free'],
                      ['GLM-4.6V', '$0.30', '$0.90'],
                      ['GLM-4.6V-FlashX', '$0.04', '$0.40'],
                      ['GLM-4.5V', '$0.60', '$1.80'],
                      ['GLM-OCR', '$0.03', '$0.03'],
                      ['gpt-5.2', '$1.75', '$14.00'],
                      ['gpt-5.1', '$1.25', '$10.00'],
                      ['gpt-5', '$1.25', '$10.00'],
                      ['gpt-5-mini', '$0.25', '$2.00'],
                      ['gpt-5-nano', '$0.05', '$0.40'],
                    ].map((r, idx) => (
                      <div key={r[0]} style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr 1fr', padding: '8px 10px', borderTop: idx === 0 ? 'none' : '1px solid #27272a' }}>
                        <span>{r[0]}</span><span>{r[1]}</span><span>{r[2]}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div style={{ padding: '12px 20px', borderTop: '1px solid #3f3f46' }}>
                  <button type="button" className="btn btn-primary" onClick={() => setShowAgentInfo(false)} style={{ width: '100%' }}>
                    OK
                  </button>
                </div>
              </div>
            </div>
          )}
          {showAgentStartModal && !agentRunning && (
            <div
              style={{
                position: 'fixed',
                inset: 0,
                zIndex: 1100,
                background: 'rgba(0,0,0,0.72)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 16,
              }}
              onClick={() => setShowAgentStartModal(false)}
            >
              <div
                onClick={(e) => e.stopPropagation()}
                style={{
                  width: '100%',
                  maxWidth: 620,
                  maxHeight: '90vh',
                  overflow: 'auto',
                  background: '#18181b',
                  border: '1px solid #3f3f46',
                  borderRadius: 14,
                  padding: 16,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                  <h3 style={{ margin: 0, fontSize: '1.02rem', color: '#fff' }}>Agent Start Settings</h3>
                  <button
                    type="button"
                    onClick={() => setShowAgentStartModal(false)}
                    style={{ border: 'none', background: '#3f3f46', color: '#fff', borderRadius: 8, width: 30, height: 30, cursor: 'pointer' }}
                  >
                    ×
                  </button>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.8rem', color: '#a1a1aa', marginBottom: 4 }}>Strategy</label>
                    <select className="input" value={agentStrategy} onChange={(e) => setAgentStrategy(e.target.value as typeof agentStrategy)} style={{ width: '100%', marginBottom: 0 }}>
                      {STRATEGIES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.8rem', color: '#a1a1aa', marginBottom: 4 }}>Market</label>
                    <select className="input" value={agentMarketType} onChange={(e) => setAgentMarketType(e.target.value as 'spot' | 'futures')} style={{ width: '100%', marginBottom: 0 }}>
                      <option value="spot">Spot</option>
                      <option value="futures">Futures</option>
                    </select>
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.8rem', color: '#a1a1aa', marginBottom: 4 }}>Analysis interval</label>
                    <select className="input" value={agentIntervalSec} onChange={(e) => setAgentIntervalSec(Number(e.target.value))} style={{ width: '100%', marginBottom: 0 }}>
                      {AGENT_INTERVALS.map((i) => <option key={i.value} value={i.value}>{i.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.8rem', color: '#a1a1aa', marginBottom: 4 }}>Same-side position limit</label>
                    <input
                      type="number"
                      className="input"
                      min={1}
                      max={50}
                      step={1}
                      value={agentMaxOpenPositions}
                      onChange={(e) => setAgentMaxOpenPositions(Math.max(1, Math.min(50, Number(e.target.value) || 1)))}
                      style={{ width: '100%', marginBottom: 0 }}
                    />
                  </div>
                </div>

                <div style={{ marginTop: 10 }}>
                  <label style={{ display: 'block', fontSize: '0.8rem', color: '#a1a1aa', marginBottom: 4 }}>Extra instruction (optional)</label>
                  <textarea
                    className="input"
                    value={agentPrompt}
                    onChange={(e) => setAgentPrompt(e.target.value)}
                    placeholder='E.g. "Only suggest buys at strong support levels."'
                    rows={2}
                    style={{ width: '100%', resize: 'vertical', marginBottom: 0 }}
                  />
                </div>

                <div
                  style={{
                    marginTop: 12,
                    border: '1px solid #3f3f46',
                    borderRadius: 10,
                    background: agentTradeEnabled ? 'rgba(99,102,241,0.12)' : '#27272a',
                    padding: '10px 12px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 12,
                  }}
                >
                  <div>
                    <div style={{ fontSize: '0.9rem', fontWeight: 600, color: '#fff' }}>Execute trades</div>
                    <div style={{ fontSize: '0.78rem', color: '#a1a1aa' }}>Apply buy if AI says BUY, sell if AI says SELL.</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setAgentTradeEnabled((v) => !v)}
                    aria-label="Toggle execute trades"
                    style={{
                      width: 48,
                      height: 28,
                      borderRadius: 999,
                      border: '1px solid #3f3f46',
                      background: agentTradeEnabled ? '#6366f1' : '#3f3f46',
                      position: 'relative',
                      cursor: 'pointer',
                      flexShrink: 0,
                    }}
                  >
                    <span
                      style={{
                        position: 'absolute',
                        top: 2,
                        left: agentTradeEnabled ? 22 : 2,
                        width: 22,
                        height: 22,
                        borderRadius: '50%',
                        background: '#fff',
                        transition: 'left 0.2s ease',
                      }}
                    />
                  </button>
                </div>

                {agentTradeEnabled && (
                  <>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 10 }}>
                      <div>
                        <label style={{ display: 'block', fontSize: '0.8rem', color: '#a1a1aa', marginBottom: 4 }}>Balance</label>
                        <select className="input" value={agentBalanceType} onChange={(e) => setAgentBalanceType(e.target.value as typeof agentBalanceType)} style={{ width: '100%', marginBottom: 0 }}>
                          {BALANCE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                      </div>
                      <div>
                        <label style={{ display: 'block', fontSize: '0.8rem', color: '#a1a1aa', marginBottom: 4 }}>Amount mode</label>
                        <select
                          className="input"
                          value={agentOrderAmountMode}
                          onChange={(e) => setAgentOrderAmountMode((e.target.value === 'max' ? 'max' : 'fixed'))}
                          style={{ width: '100%', marginBottom: 0 }}
                        >
                          <option value="fixed">Fixed amount</option>
                          <option value="max">Maximum balance</option>
                        </select>
                      </div>
                    </div>

                    {agentOrderAmountMode === 'fixed' ? (
                      <div style={{ marginTop: 10 }}>
                        <label style={{ display: 'block', fontSize: '0.8rem', color: '#a1a1aa', marginBottom: 4 }}>
                          {agentMarketType === 'futures' ? 'Margin (USDT)' : 'Per buy order (USDT)'}
                        </label>
                        <input
                          type="number"
                          className="input"
                          min={0.5}
                          max={1000000}
                          step="any"
                          placeholder="100"
                          value={agentOrderAmountInput}
                          onChange={(e) => setAgentOrderAmountInput(e.target.value)}
                          style={{ width: '100%', marginBottom: 0 }}
                        />
                      </div>
                    ) : (
                      <div style={{ marginTop: 10, fontSize: '0.78rem', color: '#fbbf24', background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.35)', borderRadius: 8, padding: '8px 10px' }}>
                        Maximum balance mode: each trade uses all available balance.
                      </div>
                    )}

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 10 }}>
                      {agentMarketType === 'futures' ? (
                        <div>
                          <label style={{ display: 'block', fontSize: '0.8rem', color: '#a1a1aa', marginBottom: 4 }}>Leverage</label>
                          <input
                            type="number"
                            className="input"
                            min={1}
                            max={125}
                            step={1}
                            value={agentLeverage}
                            onChange={(e) => setAgentLeverage(Math.max(1, Math.min(125, Number(e.target.value) || 10)))}
                            style={{ width: '100%', marginBottom: 0 }}
                          />
                        </div>
                      ) : <div />}
                      <div>
                        <label style={{ display: 'block', fontSize: '0.8rem', color: '#a1a1aa', marginBottom: 4 }}>Wait for same-side new order (sec)</label>
                        <input
                          type="number"
                          className="input"
                          min={0}
                          max={86400}
                          step={1}
                          value={agentMinTradeIntervalSec}
                          onChange={(e) => setAgentMinTradeIntervalSec(Math.max(0, Math.min(86400, Number(e.target.value) || 0)))}
                          style={{ width: '100%', marginBottom: 0 }}
                        />
                      </div>
                    </div>

                    {agentOrderAmountMode === 'max' && (
                      <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, fontSize: '0.82rem', color: '#a1a1aa' }}>
                        <input type="checkbox" checked={agentSingleTradeIfMax} onChange={(e) => setAgentSingleTradeIfMax(e.target.checked)} />
                        Open only one trade in maximum mode (safer)
                      </label>
                    )}
                  </>
                )}

                <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                  <button type="button" className="btn btn-secondary" onClick={() => setShowAgentStartModal(false)} style={{ flex: 1 }}>
                    Cancel
                  </button>
                  <button type="button" className="btn btn-primary" onClick={startAgent} disabled={agentLoading} style={{ flex: 1 }}>
                    {agentLoading ? 'Starting...' : 'Start'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {error && <p className="error" style={{ marginBottom: 8 }}>{error}</p>}

          {agentLog.length > 0 && (
            <div style={{ marginBottom: 8, border: '1px solid #3f3f46', borderRadius: 10, overflow: 'hidden', background: '#18181b' }}>
              <button
                type="button"
                onClick={() => setAgentSectionOpen((s) => ({ ...s, output: !s.output }))}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '10px 12px',
                  background: 'transparent',
                  border: 'none',
                  color: '#a1a1aa',
                  fontWeight: 600,
                  fontSize: '0.85rem',
                  cursor: 'pointer',
                }}
              >
                Output
                <span style={{ opacity: 0.8 }}>{agentSectionOpen.output ? '▼' : '▶'}</span>
              </button>
              {agentSectionOpen.output && (
                <div style={{ padding: '0 10px 10px', maxHeight: 160, overflowY: 'auto', fontSize: '0.8rem' }}>
                  {agentLog.map((e) => (
                    <button
                      type="button"
                      key={e.id}
                      onClick={() => {
                        if (e.fullAnalysis) setSelectedAnalysis({ fullAnalysis: e.fullAnalysis })
                        else if (e.analysisId) setSelectedAnalysis({ analysisId: e.analysisId })
                      }}
                      style={{
                        width: '100%',
                        display: 'flex',
                        gap: 8,
                        padding: '6px 0',
                        borderBottom: '1px solid #27272a',
                        color: '#e4e4e7',
                        background: (e.fullAnalysis || e.analysisId) ? 'transparent' : 'transparent',
                        border: 'none',
                        cursor: (e.fullAnalysis || e.analysisId) ? 'pointer' : 'default',
                        textAlign: 'left',
                        fontSize: 'inherit',
                      }}
                    >
                      <span style={{ color: '#71717a', flexShrink: 0 }}>{e.time}</span>
                      <span>{e.message}</span>
                      {(e.fullAnalysis || e.analysisId) && <span style={{ marginLeft: 'auto', color: '#6366f1', fontSize: '0.75rem' }}>click</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {((agentMarketType === 'spot' && performance && (performance.total_trades > 0 || (performance.total_equity != null && performance.total_equity !== performance.initial_balance))) ||
            (agentMarketType === 'futures' && futuresPerformance)) && (
            <div style={{ marginBottom: 8, border: '1px solid #3f3f46', borderRadius: 10, overflow: 'hidden', background: '#27272a' }}>
              <div
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                  padding: '10px 12px',
                  color: '#a1a1aa',
                }}
              >
                <button
                  type="button"
                  onClick={() => setAgentSectionOpen((s) => ({ ...s, performance: !s.performance }))}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'inherit',
                    fontWeight: 600,
                    fontSize: '0.85rem',
                    cursor: 'pointer',
                    padding: 0,
                    textAlign: 'left',
                  }}
                >
                  Agent performance {agentMarketType === 'futures' ? '(Futures)' : '(Spot)'}
                </button>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {agentMarketType === 'futures' && (
                    <button
                      type="button"
                      onClick={resetFuturesPerformance}
                      disabled={resettingFutures}
                      style={{
                        border: '1px solid #52525b',
                        background: '#18181b',
                        color: '#e4e4e7',
                        fontSize: '0.75rem',
                        fontWeight: 600,
                        borderRadius: 8,
                        padding: '4px 8px',
                        cursor: resettingFutures ? 'wait' : 'pointer',
                        opacity: resettingFutures ? 0.7 : 1,
                      }}
                    >
                      {resettingFutures ? 'Resetting...' : 'Reset'}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setAgentSectionOpen((s) => ({ ...s, performance: !s.performance }))}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: 'inherit',
                      cursor: 'pointer',
                      fontSize: '0.95rem',
                      padding: 0,
                    }}
                    aria-label="Toggle performance panel"
                  >
                    <span style={{ opacity: 0.8 }}>{agentSectionOpen.performance ? '▼' : '▶'}</span>
                  </button>
                </div>
              </div>
              {agentSectionOpen.performance && (
                <div style={{ padding: 12 }}>
                  {agentMarketType === 'spot' && performance && (
                    <>
                      {performance.equity_curve && performance.equity_curve.length > 1 && (
                        <div style={{ marginBottom: 10, height: 80 }}>
                          <EquityChart data={performance.equity_curve} initial={performance.initial_balance} />
                        </div>
                      )}
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 8, fontSize: '0.8rem' }}>
                        <span>Trades: <strong>{performance.total_trades}</strong> (Buy: {performance.buy_count}, Sell: {performance.sell_count})</span>
                        {performance.total_equity != null && (
                          <span>Total value: <strong>{performance.total_equity.toFixed(2)} USDT</strong></span>
                        )}
                        {performance.equity_change != null && (
                          <span style={{ color: performance.equity_change >= 0 ? '#22c55e' : '#f87171' }}>
                            Change: <strong>{performance.equity_change >= 0 ? '+' : ''}{performance.equity_change.toFixed(2)} USDT</strong>
                          </span>
                        )}
                        {(performance.total_commission ?? 0) > 0 && (
                          <span style={{ color: '#a1a1aa' }}>Commission: <strong>{(performance.total_commission ?? 0).toFixed(2)} USDT</strong></span>
                        )}
                      </div>
                      <details style={{ fontSize: '0.75rem', color: '#a1a1aa' }}>
                        <summary style={{ cursor: 'pointer' }}>Recent trades</summary>
                        <div style={{ marginTop: 6, maxHeight: 140, overflowY: 'auto' }}>
                          {performance.last_trades.length === 0 ? (
                            <p style={{ color: '#71717a', margin: 0, padding: '8px 0' }}>No trades yet.</p>
                          ) : (
                            performance.last_trades.slice(0, 15).map((t, i) => (
                              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid #27272a', gap: 8, flexWrap: 'wrap' }}>
                                <span style={{ color: t.side === 'BUY' ? '#22c55e' : '#ef4444' }}>{t.side}</span>
                                <span>{t.symbol}</span>
                                <span>{t.quantity.toFixed(6)} @ {t.price_usdt.toFixed(2)}</span>
                                <span>{t.usdt_amount >= 0 ? '+' : ''}{t.usdt_amount.toFixed(2)}</span>
                              </div>
                            ))
                          )}
                        </div>
                      </details>
                    </>
                  )}
                  {agentMarketType === 'futures' && futuresPerformance && (
                    <>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 10, fontSize: '0.8rem' }}>
                        <span>Margin: <strong>{futuresPerformance.margin_available.toFixed(2)} USDT</strong></span>
                        <span>Open positions: <strong>{futuresPerformance.positions.length}</strong></span>
                        <span style={{ color: futuresPerformance.realized_pnl >= 0 ? '#22c55e' : '#f87171' }}>
                          Realized PnL: <strong>{futuresPerformance.realized_pnl >= 0 ? '+' : ''}{futuresPerformance.realized_pnl.toFixed(2)} USDT</strong>
                        </span>
                        <span style={{ color: futuresPerformance.total_unrealized_pnl >= 0 ? '#22c55e' : '#f87171' }}>
                          Unrealized PnL: <strong>{futuresPerformance.total_unrealized_pnl >= 0 ? '+' : ''}{futuresPerformance.total_unrealized_pnl.toFixed(2)} USDT</strong>
                        </span>
                        {(futuresPerformance.total_commission ?? 0) > 0 && (
                          <span style={{ color: '#a1a1aa' }}>Commission: <strong>{(futuresPerformance.total_commission ?? 0).toFixed(2)} USDT</strong></span>
                        )}
                        <span>Total value: <strong>{futuresPerformance.total_equity.toFixed(2)} USDT</strong></span>
                        <span style={{ color: futuresPerformance.equity_change >= 0 ? '#22c55e' : '#f87171' }}>
                          Change: <strong>{futuresPerformance.equity_change >= 0 ? '+' : ''}{futuresPerformance.equity_change.toFixed(2)} USDT</strong>
                        </span>
                      </div>
                      <p style={{ fontSize: '0.75rem', color: '#71717a', margin: 0 }}>Open positions and historical trades are listed in the "Recent trades" panel below the chart.</p>
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          {!agentRunning && (
            <div style={{ marginBottom: 12, border: '1px dashed #3f3f46', borderRadius: 10, padding: 12, color: '#a1a1aa', fontSize: '0.85rem' }}>
              You can configure agent settings from the start popup.
            </div>
          )}

          {lastOrderMessage && (
            <p
              style={{
                fontSize: '0.8rem',
                margin: '8px 0',
                padding: 8,
                borderRadius: 8,
                color: lastOrderError ? '#f87171' : '#22c55e',
                background: lastOrderError ? 'rgba(248,113,113,0.1)' : 'rgba(34,197,94,0.1)',
              }}
            >
              Last trade: {lastOrderMessage}
            </p>
          )}

          {agentResult && (
            <div style={{ marginBottom: 8, border: '1px solid #3f3f46', borderRadius: 10, overflow: 'hidden', background: '#27272a' }}>
              <button
                type="button"
                onClick={() => setAgentSectionOpen((s) => ({ ...s, result: !s.result }))}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '10px 12px',
                  background: 'transparent',
                  border: 'none',
                  color: '#a1a1aa',
                  fontWeight: 600,
                  fontSize: '0.85rem',
                  cursor: 'pointer',
                }}
              >
                <span>Latest suggestion</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span
                    style={{
                      padding: '2px 8px',
                      borderRadius: 999,
                      fontSize: '0.72rem',
                      fontWeight: 700,
                      letterSpacing: 0.2,
                      background: agentResult.action === 'BUY' ? 'rgba(34, 197, 94, 0.24)' : agentResult.action === 'SELL' ? 'rgba(239, 68, 68, 0.24)' : 'rgba(113, 113, 122, 0.3)',
                      color: agentResult.action === 'BUY' ? '#22c55e' : agentResult.action === 'SELL' ? '#ef4444' : '#a1a1aa',
                    }}
                  >
                    {agentResult.action === 'BUY' ? 'BUY' : agentResult.action === 'SELL' ? 'SELL' : 'HOLD'}
                  </span>
                  {agentResult.time && (
                    <span style={{ fontSize: '0.72rem', color: '#a1a1aa' }}>
                      {new Date(agentResult.time).toLocaleTimeString('en-US')}
                    </span>
                  )}
                  <span style={{ opacity: 0.8 }}>{agentSectionOpen.result ? '▼' : '▶'}</span>
                </div>
              </button>
              {agentSectionOpen.result && (
                <div style={{ padding: 12, flex: 1, minHeight: 0, overflow: 'auto' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <span
                      style={{
                        padding: '4px 10px',
                        borderRadius: 8,
                        fontSize: '0.8rem',
                        fontWeight: 600,
                        background: agentResult.action === 'BUY' ? 'rgba(34, 197, 94, 0.3)' : agentResult.action === 'SELL' ? 'rgba(239, 68, 68, 0.3)' : 'rgba(113, 113, 122, 0.3)',
                        color: agentResult.action === 'BUY' ? '#22c55e' : agentResult.action === 'SELL' ? '#ef4444' : '#a1a1aa',
                      }}
                    >
                      {agentResult.action === 'BUY' ? 'BUY' : agentResult.action === 'SELL' ? 'SELL' : 'HOLD'}
                    </span>
                    {agentResult.buy_at != null && (
                      <span style={{ fontSize: '0.85rem', color: '#22c55e' }}>Buy: {agentResult.buy_at.toLocaleString('en-US')}</span>
                    )}
                    {agentResult.sell_at != null && (
                      <span style={{ fontSize: '0.85rem', color: '#ef4444' }}>Sell: {agentResult.sell_at.toLocaleString('en-US')}</span>
                    )}
                  </div>
                  {agentResult.time && (
                    <div style={{ marginBottom: 8, fontSize: '0.75rem', color: '#a1a1aa' }}>
                      Date: {new Date(agentResult.time).toLocaleString('en-US')}
                    </div>
                  )}
                  <p style={{ margin: 0, fontSize: '0.85rem', color: '#e4e4e7', whiteSpace: 'pre-wrap' }}>
                    {agentResult.message || agentResult.analysis}
                  </p>
                </div>
              )}
            </div>
          )}

          {selectedAnalysis && (
            <div
              style={{
                position: 'fixed',
                inset: 0,
                zIndex: 1000,
                background: 'rgba(0,0,0,0.7)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 24,
              }}
              onClick={() => setSelectedAnalysis(null)}
            >
              <div
                style={{
                  background: '#18181b',
                  border: '1px solid #3f3f46',
                  borderRadius: 12,
                  maxWidth: 480,
                  maxHeight: '80vh',
                  overflow: 'hidden',
                  display: 'flex',
                  flexDirection: 'column',
                  boxShadow: '0 25px 50px rgba(0,0,0,0.5)',
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <AnalysisModalContent selected={selectedAnalysis} onClose={() => setSelectedAnalysis(null)} getToken={getToken} apiUrl={API_URL} />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
