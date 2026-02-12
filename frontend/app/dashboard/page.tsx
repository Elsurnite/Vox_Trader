'use client'

import { useEffect, useState, useRef } from 'react'
import dynamic from 'next/dynamic'
import '../globals.css'
import { COINS } from './Chart'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8423'

const Chart = dynamic(() => import('./Chart'), { ssr: false })
const AIChatPanel = dynamic(() => import('./AIChatPanel'), { ssr: false })
const RecentTrades = dynamic(() => import('./RecentTrades'), { ssr: false })

// Binance balance asset icons (CoinGecko)
const ASSET_LOGOS: Record<string, string> = {
  BTC: 'https://assets.coingecko.com/coins/images/1/small/bitcoin.png',
  ETH: 'https://assets.coingecko.com/coins/images/279/small/ethereum.png',
  BNB: 'https://assets.coingecko.com/coins/images/825/small/bnb-icon2_2x.png',
  SOL: 'https://assets.coingecko.com/coins/images/4128/small/solana.png',
  XRP: 'https://assets.coingecko.com/coins/images/44/small/xrp-symbol-white-128.png',
  USDT: 'https://assets.coingecko.com/coins/images/325/small/Tether.png',
  BUSD: 'https://assets.coingecko.com/coins/images/9576/small/BUSD.png',
  USDC: 'https://assets.coingecko.com/coins/images/6319/small/usdc.png',
  DOGE: 'https://assets.coingecko.com/coins/images/5/small/dogecoin.png',
  ADA: 'https://assets.coingecko.com/coins/images/975/small/cardano.png',
  AVAX: 'https://assets.coingecko.com/coins/images/12559/small/Avalanche_Circle_RedWhite_Trans.png',
  LINK: 'https://assets.coingecko.com/coins/images/877/small/chainlink-new-logo.png',
  MATIC: 'https://assets.coingecko.com/coins/images/4713/small/matic-token-icon.png',
  DOT: 'https://assets.coingecko.com/coins/images/12171/small/polkadot.png',
  LTC: 'https://assets.coingecko.com/coins/images/2/small/litecoin.png',
  UNI: 'https://assets.coingecko.com/coins/images/12504/small/uniswap-uni.png',
  ATOM: 'https://assets.coingecko.com/coins/images/1481/small/cosmos_hub.png',
  TRX: 'https://assets.coingecko.com/coins/images/1094/small/tron-logo.png',
  TON: 'https://assets.coingecko.com/coins/images/17980/small/ton_symbol.png',
  SHIB: 'https://assets.coingecko.com/coins/images/11939/small/shiba.jpg',
  PEPE: 'https://assets.coingecko.com/coins/images/29850/small/pepe-token.jpeg',
  NEAR: 'https://assets.coingecko.com/coins/images/10365/small/near.jpg',
  APT: 'https://assets.coingecko.com/coins/images/26455/small/aptos_round.png',
  ARB: 'https://assets.coingecko.com/coins/images/16547/small/photo_2023-03-29_21.47.00.jpeg',
  OP: 'https://assets.coingecko.com/coins/images/25244/small/Optimism.png',
  SUI: 'https://assets.coingecko.com/coins/images/26375/small/sui_asset.jpeg',
  INJ: 'https://assets.coingecko.com/coins/images/12882/small/Secondary_Symbol.png',
  WIF: 'https://assets.coingecko.com/coins/images/33566/small/dogwifhat.jpg',
  FDUSD: 'https://assets.coingecko.com/coins/images/31071/small/fdusd.png',
}

type BalanceItem = { asset: string; free: number; locked: number; total: number }

function BalanceWidget({ demoMode }: { demoMode: boolean }) {
  const [balances, setBalances] = useState<BalanceItem[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const token = localStorage.getItem('token')
    if (!token) return
    setLoading(true)
    setError(null)
    const url = demoMode ? `${API_URL}/demo/account` : `${API_URL}/binance/account`
    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => {
        if (!r.ok) throw new Error(r.status === 400 ? 'Add Binance API keys in Settings' : 'Failed to load balances')
        return r.json()
      })
      .then((data: { balances?: BalanceItem[]; demo_balance?: number; holdings?: { asset: string; quantity: number }[] }) => {
        let list: BalanceItem[]
        if (demoMode) {
          list = []
          if (data.demo_balance != null) list.push({ asset: 'USDT', free: data.demo_balance, locked: 0, total: data.demo_balance })
          ;(data.holdings || []).forEach((h: { asset: string; quantity: number }) => {
            if (h.asset !== 'USDT') list.push({ asset: h.asset, free: h.quantity, locked: 0, total: h.quantity })
          })
        } else {
          list = data.balances || []
        }
        setBalances(list)
        if (list.length) setSelected(list[0].asset)
      })
      .catch((e) => {
        setError(e.message)
        setBalances([])
      })
      .finally(() => setLoading(false))
  }, [demoMode])

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setOpen(false)
    }
    if (open) document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [open])

  const current = balances.find((b) => b.asset === selected)
  const logo = (asset: string) => ASSET_LOGOS[asset] || `https://assets.coingecko.com/coins/images/1/small/bitcoin.png`

  if (loading && balances.length === 0) {
    return (
      <div style={{ padding: '8px 14px', background: '#27272a', borderRadius: 12, fontSize: '0.85rem', color: '#71717a' }}>
        Loading balance...
      </div>
    )
  }
  if (error && balances.length === 0) {
    return (
      <div style={{ padding: '8px 14px', background: 'rgba(248,113,113,0.15)', borderRadius: 12, fontSize: '0.85rem', color: '#f87171' }}>
        {error}
      </div>
    )
  }
  if (balances.length === 0) {
    return (
      <div style={{ padding: '8px 14px', background: '#27272a', borderRadius: 12, fontSize: '0.85rem', color: '#71717a' }}>
        No balance
      </div>
    )
  }

  return (
    <div ref={dropdownRef} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '10px 14px',
          background: '#27272a',
          border: '1px solid #3f3f46',
          borderRadius: 12,
          color: '#fff',
          cursor: 'pointer',
          fontSize: '0.9rem',
          minWidth: 160,
        }}
      >
        <img src={logo(selected || '')} alt="" width={24} height={24} style={{ borderRadius: '50%', objectFit: 'cover' }} />
        <span style={{ fontWeight: 600 }}>{selected}</span>
        <span style={{ marginLeft: 'auto', opacity: 0.8 }}>
          {current ? current.total.toLocaleString('en-US', { maximumFractionDigits: 8, minimumFractionDigits: 2 }) : '—'}
        </span>
        <span style={{ opacity: 0.6 }}>▾</span>
      </button>
      {open && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            right: 0,
            marginTop: 6,
            background: '#18181b',
            border: '1px solid #3f3f46',
            borderRadius: 12,
            boxShadow: '0 10px 40px rgba(0,0,0,0.4)',
            zIndex: 50,
            maxHeight: 320,
            overflowY: 'auto',
            minWidth: 220,
          }}
        >
          {balances.map((b) => (
            <button
              key={b.asset}
              type="button"
              onClick={() => {
                setSelected(b.asset)
                setOpen(false)
              }}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '12px 14px',
                background: b.asset === selected ? 'rgba(99, 102, 241, 0.2)' : 'transparent',
                border: 'none',
                color: '#e4e4e7',
                cursor: 'pointer',
                fontSize: '0.9rem',
                textAlign: 'left',
              }}
            >
              <img src={logo(b.asset)} alt="" width={28} height={28} style={{ borderRadius: '50%', objectFit: 'cover' }} />
              <span style={{ fontWeight: 600 }}>{b.asset}</span>
              <span style={{ marginLeft: 'auto', color: '#a1a1aa' }}>
                {b.total.toLocaleString('en-US', { maximumFractionDigits: 8, minimumFractionDigits: 2 })}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default function DashboardPage() {
  const [user, setUser] = useState<{ email: string; name?: string; demo_balance?: number; demo_mode?: boolean } | null>(null)
  const [loading, setLoading] = useState(true)
  const chartContainerRef = useRef<HTMLDivElement>(null)
  const chartInfoRef = useRef<{ symbol: string; interval: string } | null>(null)
  const [chartSymbol, setChartSymbol] = useState('BTCUSDT')
  const [recentTradesSymbol, setRecentTradesSymbol] = useState('BTCUSDT')

  useEffect(() => {
    setRecentTradesSymbol(chartSymbol)
  }, [chartSymbol])

  useEffect(() => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null
    if (!token) {
      window.location.href = '/'
      return
    }
    fetch(`${API_URL}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setUser)
      .catch(() => {
        localStorage.removeItem('token')
        localStorage.removeItem('user')
        window.location.href = '/'
      })
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div style={{ padding: 48, textAlign: 'center' }}>Loading...</div>
  if (!user) return null

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <div style={{ flexShrink: 0, marginBottom: 16, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ marginBottom: 0, fontSize: '1.5rem' }}>Dashboard</h1>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          {user.demo_mode && (
            <span style={{ fontSize: '0.8rem', color: '#818cf8' }}>Demo mode</span>
          )}
          <BalanceWidget demoMode={!!user.demo_mode} />
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, display: 'flex', gap: 20 }}>
        {/* Left: Chart + Trade history */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ flex: 1, minHeight: 0, maxHeight: '52%', display: 'flex', flexDirection: 'column' }}>
            <Chart chartContainerRef={chartContainerRef} chartInfoRef={chartInfoRef} symbol={chartSymbol} onSymbolChange={setChartSymbol} />
          </div>
          <div style={{ flex: 1, minHeight: 220, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            <RecentTrades symbol={recentTradesSymbol} onSymbolChange={setRecentTradesSymbol} symbols={COINS} demoMode={!!user.demo_mode} />
          </div>
        </div>
        {/* Right: AI chat panel */}
        <div style={{ width: 380, flexShrink: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <AIChatPanel chartContainerRef={chartContainerRef} chartInfoRef={chartInfoRef} />
        </div>
      </div>
    </div>
  )
}
