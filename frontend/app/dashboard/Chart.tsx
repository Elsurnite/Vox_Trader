'use client'

import { useEffect, useRef, useState } from 'react'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8423'

type Kline = [number, string, string, string, string, string, number, string, number, number, number, string]

const INTERVALS = [
  { value: '1m', label: '1 min' },
  { value: '5m', label: '5 min' },
  { value: '15m', label: '15 min' },
  { value: '1h', label: '1 hour' },
  { value: '4h', label: '4 hours' },
  { value: '1d', label: '1 day' },
]

// CoinGecko small icons (public CDN)
const COINS: { symbol: string; label: string; logo: string }[] = [
  { symbol: 'BTCUSDT', label: 'BTC/USD', logo: 'https://assets.coingecko.com/coins/images/1/small/bitcoin.png' },
  { symbol: 'ETHUSDT', label: 'ETH/USD', logo: 'https://assets.coingecko.com/coins/images/279/small/ethereum.png' },
  { symbol: 'BNBUSDT', label: 'BNB/USD', logo: 'https://assets.coingecko.com/coins/images/825/small/bnb-icon2_2x.png' },
  { symbol: 'SOLUSDT', label: 'SOL/USD', logo: 'https://assets.coingecko.com/coins/images/4128/small/solana.png' },
  { symbol: 'XRPUSDT', label: 'XRP/USD', logo: 'https://assets.coingecko.com/coins/images/44/small/xrp-symbol-white-128.png' },
  { symbol: 'DOGEUSDT', label: 'DOGE/USD', logo: 'https://assets.coingecko.com/coins/images/5/small/dogecoin.png' },
  { symbol: 'ADAUSDT', label: 'ADA/USD', logo: 'https://assets.coingecko.com/coins/images/975/small/cardano.png' },
  { symbol: 'AVAXUSDT', label: 'AVAX/USD', logo: 'https://assets.coingecko.com/coins/images/12559/small/Avalanche_Circle_RedWhite_Trans.png' },
  { symbol: 'LINKUSDT', label: 'LINK/USD', logo: 'https://assets.coingecko.com/coins/images/877/small/chainlink-new-logo.png' },
  { symbol: 'MATICUSDT', label: 'MATIC/USD', logo: 'https://assets.coingecko.com/coins/images/4713/small/matic-token-icon.png' },
  { symbol: 'DOTUSDT', label: 'DOT/USD', logo: 'https://assets.coingecko.com/coins/images/12171/small/polkadot.png' },
  { symbol: 'LTCUSDT', label: 'LTC/USD', logo: 'https://assets.coingecko.com/coins/images/2/small/litecoin.png' },
  { symbol: 'UNIUSDT', label: 'UNI/USD', logo: 'https://assets.coingecko.com/coins/images/12504/small/uniswap-uni.png' },
  { symbol: 'ATOMUSDT', label: 'ATOM/USD', logo: 'https://assets.coingecko.com/coins/images/1481/small/cosmos_hub.png' },
  { symbol: 'ETCUSDT', label: 'ETC/USD', logo: 'https://assets.coingecko.com/coins/images/453/small/ethereum-classic-logo.png' },
  { symbol: 'XLMUSDT', label: 'XLM/USD', logo: 'https://assets.coingecko.com/coins/images/100/small/Stellar_symbol_black_RGB.png' },
  { symbol: 'NEARUSDT', label: 'NEAR/USD', logo: 'https://assets.coingecko.com/coins/images/10365/small/near.jpg' },
  { symbol: 'APTUSDT', label: 'APT/USD', logo: 'https://assets.coingecko.com/coins/images/26455/small/aptos_round.png' },
  { symbol: 'ARBUSDT', label: 'ARB/USD', logo: 'https://assets.coingecko.com/coins/images/16547/small/photo_2023-03-29_21.47.00.jpeg' },
  { symbol: 'OPUSDT', label: 'OP/USD', logo: 'https://assets.coingecko.com/coins/images/25244/small/Optimism.png' },
  { symbol: 'INJUSDT', label: 'INJ/USD', logo: 'https://assets.coingecko.com/coins/images/12882/small/Secondary_Symbol.png' },
  { symbol: 'SUIUSDT', label: 'SUI/USD', logo: 'https://assets.coingecko.com/coins/images/26375/small/sui_asset.jpeg' },
  { symbol: 'PEPEUSDT', label: 'PEPE/USD', logo: 'https://assets.coingecko.com/coins/images/29850/small/pepe-token.jpeg' },
  { symbol: 'WIFUSDT', label: 'WIF/USD', logo: 'https://assets.coingecko.com/coins/images/33566/small/dogwifhat.jpg' },
  { symbol: 'SHIBUSDT', label: 'SHIB/USD', logo: 'https://assets.coingecko.com/coins/images/11939/small/shiba.jpg' },
  { symbol: 'TRXUSDT', label: 'TRX/USD', logo: 'https://assets.coingecko.com/coins/images/1094/small/tron-logo.png' },
  { symbol: 'TONUSDT', label: 'TON/USD', logo: 'https://assets.coingecko.com/coins/images/17980/small/ton_symbol.png' },
]

export { COINS }

type ChartProps = {
  chartContainerRef?: React.MutableRefObject<HTMLDivElement | null>
  chartInfoRef?: React.MutableRefObject<{ symbol: string; interval: string } | null>
  symbol?: string
  onSymbolChange?: (symbol: string) => void
}

export default function Chart({ chartContainerRef, chartInfoRef, symbol: symbolProp, onSymbolChange }: ChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<{ remove: () => void } | null>(null)
  const seriesRef = useRef<{ update: (data: { time: number; open: number; high: number; low: number; close: number }) => void } | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const chartSymbolRef = useRef<string>('')
  const [symbolInternal, setSymbolInternal] = useState('BTCUSDT')
  const symbol = symbolProp ?? symbolInternal
  const setSymbol = (s: string) => {
    if (onSymbolChange) onSymbolChange(s)
    else setSymbolInternal(s)
  }
  const [interval, setInterval] = useState('1m')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [coinDropdownOpen, setCoinDropdownOpen] = useState(false)
  const coinDropdownRef = useRef<HTMLDivElement>(null)

  const currentCoin = COINS.find((c) => c.symbol === symbol) || COINS[0]

  useEffect(() => {
    if (chartInfoRef) chartInfoRef.current = { symbol, interval }
  }, [symbol, interval, chartInfoRef])

  const setRef = (el: HTMLDivElement | null) => {
    (containerRef as React.MutableRefObject<HTMLDivElement | null>).current = el
    if (chartContainerRef) chartContainerRef.current = el
  }

  const safeRemoveChart = () => {
    try {
      if (chartRef.current) chartRef.current.remove()
    } catch {
      // Chart may already be disposed (interval/symbol switch)
    }
    chartRef.current = null
    seriesRef.current = null
  }

  useEffect(() => {
    if (!containerRef.current) return
    setLoading(true)
    setError(null)

    const loadChart = async () => {
      const { createChart } = await import('lightweight-charts')
      if (!containerRef.current) return
      safeRemoveChart()
      if (wsRef.current) {
        wsRef.current.close()
        wsRef.current = null
      }

      const chart = createChart(containerRef.current, {
        autoSize: true,
        layout: {
          background: { type: 'solid', color: '#18181b' },
          textColor: '#a1a1aa',
        },
        grid: { vertLines: { color: '#27272a' }, horzLines: { color: '#27272a' } },
        rightPriceScale: { borderColor: '#3f3f46', scaleMargins: { top: 0.1, bottom: 0.2 } },
        timeScale: { borderColor: '#3f3f46', timeVisible: true, secondsVisible: false },
        crosshair: { vertLine: { labelBackgroundColor: '#6366f1' }, horzLine: { labelBackgroundColor: '#6366f1' } },
      })
      chartRef.current = chart
      const candleSeries = chart.addCandlestickSeries({
        upColor: '#22c55e',
        downColor: '#ef4444',
        borderDownColor: '#ef4444',
        borderUpColor: '#22c55e',
      })
      seriesRef.current = candleSeries
      chartSymbolRef.current = symbol

      try {
        // Try Binance directly first (faster single hop). Use backend proxy on CORS failure.
        const binanceUrl = `https://api.binance.com/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=500`
        let res = await fetch(binanceUrl).catch(() => null)
        if (!res?.ok) res = await fetch(`${API_URL}/binance/klines?symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=500`)
        if (!res?.ok) throw new Error('Failed to fetch chart data')
        const raw: Kline[] = await res.json()
        const data = raw.map((k) => ({
          time: Math.floor(k[0] / 1000),
          open: parseFloat(k[1]),
          high: parseFloat(k[2]),
          low: parseFloat(k[3]),
          close: parseFloat(k[4]),
        }))
        candleSeries.setData(data)
        // Show recent range on start: last ~2 hours (120 candles on 1m).
        const visibleBars = Math.min(120, data.length)
        const from = data.length - visibleBars
        const to = data.length - 1
        chart.timeScale().setVisibleLogicalRange({ from, to })
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load chart')
      } finally {
        setLoading(false)
      }

      const stream = `${symbol.toLowerCase()}@kline_${interval}`
      const ws = new WebSocket(`wss://stream.binance.com:9443/ws/${stream}`)
      wsRef.current = ws
      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data)
        if (!msg.k || !seriesRef.current) return
        // Ignore old WebSocket stream after symbol change.
        if (msg.s && msg.s !== chartSymbolRef.current) return
        const k = msg.k
        try {
          seriesRef.current.update({
            time: Math.floor(k.t / 1000),
            open: parseFloat(k.o),
            high: parseFloat(k.h),
            low: parseFloat(k.l),
            close: parseFloat(k.c),
          })
        } catch {
          // "Cannot update oldest data": incoming timestamp is older than latest candle.
        }
      }
      ws.onerror = () => setError('Live data connection error')
    }

    loadChart()
    return () => {
      safeRemoveChart()
      if (wsRef.current) {
        wsRef.current.close()
        wsRef.current = null
      }
    }
  }, [symbol, interval])

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (coinDropdownRef.current && !coinDropdownRef.current.contains(e.target as Node)) setCoinDropdownOpen(false)
    }
    if (coinDropdownOpen) document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [coinDropdownOpen])

  return (
    <div className="card" style={{ maxWidth: 'none', padding: 16, height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', gap: 12, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center', flexShrink: 0 }}>
        <div ref={coinDropdownRef} style={{ position: 'relative' }}>
          <button
            type="button"
            className="input"
            onClick={() => setCoinDropdownOpen((o) => !o)}
            style={{
              width: 'auto',
              minWidth: 160,
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              cursor: 'pointer',
              textAlign: 'left',
            }}
          >
            <img src={currentCoin.logo} alt="" width={24} height={24} style={{ borderRadius: '50%', objectFit: 'cover' }} />
            <span>{currentCoin.label}</span>
            <span style={{ marginLeft: 'auto', opacity: 0.7 }}>▾</span>
          </button>
          {coinDropdownOpen && (
            <div
              style={{
                position: 'absolute',
                top: '100%',
                left: 0,
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
              {COINS.map((c) => (
                <button
                  key={c.symbol}
                  type="button"
                  onClick={() => {
                    setSymbol(c.symbol)
                    setCoinDropdownOpen(false)
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
                  <img src={c.logo} alt="" width={28} height={28} style={{ borderRadius: '50%', objectFit: 'cover' }} />
                  {c.label}
                </button>
              ))}
            </div>
          )}
        </div>
        <select
          className="input"
          value={interval}
          onChange={(e) => setInterval(e.target.value)}
          style={{ width: 'auto', minWidth: 100 }}
        >
          {INTERVALS.map((i) => (
            <option key={i.value} value={i.value}>{i.label}</option>
          ))}
        </select>
        <span style={{ color: '#71717a', fontSize: '0.85rem' }}>Live candlestick data</span>
      </div>
      {error && <p className="error" style={{ flexShrink: 0 }}>{error}</p>}
      <div style={{ position: 'relative', flex: 1, minHeight: 0, width: '100%' }}>
        {loading && <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.5)', borderRadius: 12, zIndex: 1 }}>Loading...</div>}
        <div ref={setRef} style={{ height: '100%', width: '100%' }} />
      </div>
    </div>
  )
}
