import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Activity, ArrowRight, ArrowUpRight, BarChart3, BookOpen, Check, Crown, Download, ExternalLink, GraduationCap, LockKeyhole, LogOut, Menu, Play, Radio, ShieldCheck, Sparkles, TrendingUp, X } from 'lucide-react'
import { io } from 'socket.io-client'
import './App.css'
import './admin.css'

type User = { id: string; name: string; email: string; isMember: boolean; isAdmin?: boolean }
type Tick = { symbol: string; price: number; change: number; at: string }
type Bot = { id: string; name: string; symbol: string; strategy: string; description: string; returnRate: string; winRate: string; tradeCount: number; downloadUrl: string | null; activated?: boolean }
type Course = { id: string; title: string; module: string; description: string; lessonCount: number; progress: number; sortOrder: number; assetUrl?: string | null }
type TradeRecord = { id: string; symbol: string; side: string; openedAt: string; result?: string | null; status: string }
type AdminUser = { id: string; name: string; email: string; role: string; subscriptions: { status: string; interval: string; currentPeriodEnd: string | null }[] }
type View = 'overview' | 'markets' | 'membership' | 'library' | 'dashboard' | 'admin'
type AuthMode = 'login' | 'signup' | 'reset'

const API = import.meta.env.VITE_API_URL || 'http://localhost:4000'
const demoBots = [
  { name: 'Aurum Edge', tag: 'XAUUSD · Trend following', detail: 'A rules-based gold strategy built around session momentum and volatility-adjusted stops.', return: '+18.4%', win: '64.2%', trades: '128' },
  { name: 'Index Pulse', tag: 'US100 · Breakout', detail: 'A measured breakout system designed for the US cash open and high-conviction continuation.', return: '+12.8%', win: '59.8%', trades: '96' },
  { name: 'London Drift', tag: 'EURUSD · Mean reversion', detail: 'A session-aware framework that looks for stretched moves returning toward fair value.', return: '+9.6%', win: '61.1%', trades: '74' },
]
const demoCourses = [
  { title: 'Read the Market', module: '01 · FOUNDATIONS', lessons: '8 lessons', progress: 75, color: 'sage' },
  { title: 'Build Your Edge', module: '02 · STRATEGY', lessons: '12 lessons', progress: 34, color: 'rust' },
  { title: 'Risk, Refined', module: '03 · EXECUTION', lessons: '6 lessons', progress: 0, color: 'gold' },
]

function App() {
  const [view, setView] = useState<View>('overview')
  const [symbol, setSymbol] = useState('XAUUSD')
  const [timeframe, setTimeframe] = useState('60')
  const [isLive, setIsLive] = useState(false)
  const [tick, setTick] = useState<Tick>({ symbol: 'XAUUSD', price: 2328.42, change: 0.84, at: '' })
  const [user, setUser] = useState<User | null>(null)
  const [authMode, setAuthMode] = useState<AuthMode | null>(null)
  const [authError, setAuthError] = useState('')
  const [busy, setBusy] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [period, setPeriod] = useState<'monthly' | 'yearly'>('monthly')
  const [courseProgress, setCourseProgress] = useState(demoCourses.map((course) => course.progress))
  const [connected, setConnected] = useState(false)
  const [activeBotIds, setActiveBotIds] = useState<string[]>([])
  const [bots, setBots] = useState<Bot[]>([])
  const [courses, setCourses] = useState<Course[]>([])
  const [trades, setTrades] = useState<TradeRecord[]>([])
  const [resetToken, setResetToken] = useState(() => new URLSearchParams(window.location.search).get('reset') || '')

  useEffect(() => {
    fetch(`${API}/api/auth/me`, { credentials: 'include' }).then((response) => response.ok ? response.json() : null).then((data) => data?.user && setUser(data.user)).catch(() => undefined)
    const resetFromUrl = new URL(window.location.href).searchParams.get('reset')
    if (resetFromUrl) {
      const cleanUrl = new URL(window.location.href)
      cleanUrl.searchParams.delete('reset')
      window.history.replaceState({}, '', cleanUrl)
    }
    const liveSocket = io(API, { transports: ['websocket', 'polling'] })
    liveSocket.on('connect', () => setIsLive(true))
    liveSocket.on('disconnect', () => setIsLive(false))
    liveSocket.on('market:tick', (nextTick: Tick) => setTick(nextTick))
    liveSocket.on('trade:new', (newTrade: TradeRecord) => setTrades((current) => [newTrade, ...current].slice(0, 50)))
    return () => { liveSocket.disconnect() }
  }, [])

  useEffect(() => {
    if (view !== 'library' || !user?.isMember) return
    Promise.all(['bots', 'courses', 'trades'].map((resource) => fetch(`${API}/api/${resource}`, { credentials: 'include' }).then((response) => response.ok ? response.json() : null).catch(() => null))).then(([botResult, courseResult, tradeResult]) => {
      if (botResult?.bots) setBots(botResult.bots)
      if (courseResult?.courses) { setCourses(courseResult.courses); setCourseProgress(courseResult.courses.map((course: Course) => course.progress)) }
      if (tradeResult?.trades) setTrades(tradeResult.trades)
    })
  }, [view, user])

  const startAuth = (mode: AuthMode) => { setAuthError(''); setResetToken(''); setAuthMode(mode) }
  const submitAuth = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const name = String(data.get('name') || '')
    const email = String(data.get('email') || '')
    const password = String(data.get(resetToken ? 'newPassword' : 'password') || '')
    setBusy(true); setAuthError('')
    try {
      const endpoint = authMode === 'signup' ? 'register' : authMode === 'reset' ? 'password-reset' : 'login'
      const payload = authMode === 'reset' ? resetToken ? { token: resetToken, newPassword: password } : { email } : { name, email, password }
      const response = await fetch(`${API}/api/auth/${endpoint}`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Something went wrong. Try again.')
      if (authMode === 'reset') {
        if (resetToken) { setAuthError(result.message || 'Password updated. You can now sign in.'); setResetToken('') }
        else { setAuthError(result.message || 'If that email is registered, reset instructions are on the way.'); if (result.resetToken) { setResetToken(result.resetToken); setAuthMode(null) } }
        return
      }
      setUser(result.user); setAuthMode(null)
    } catch (error) { setAuthError(error instanceof Error ? error.message : 'Unable to reach APEX TRADES. Is the API running?') }
    finally { setBusy(false) }
  }

  const demoLogin = async () => {
    setBusy(true); setAuthError('')
    try {
      const response = await fetch(`${API}/api/demo/member`, { method: 'POST', credentials: 'include' })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Demo access is unavailable.')
      setUser(result.user); setAuthMode(null); setView('dashboard')
    } catch (error) { setAuthError(error instanceof Error ? error.message : 'Unable to reach the API.') }
    finally { setBusy(false) }
  }

  const logout = async () => {
    await fetch(`${API}/api/auth/logout`, { method: 'POST', credentials: 'include' }).catch(() => undefined)
    setUser(null); setView('overview')
  }

  const becomeMember = async () => {
    if (!user) { startAuth('signup'); return }
    setBusy(true)
    try {
      const response = await fetch(`${API}/api/subscriptions/checkout`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ interval: period }) })
      const result = await response.json()
      if (result.url) { window.location.assign(result.url); return }
      if (!response.ok) throw new Error(result.error || 'Could not start checkout.')
      setUser(result.user); setView('dashboard')
    } catch (error) { setAuthError(error instanceof Error ? error.message : 'Unable to start checkout.'); startAuth('login') }
    finally { setBusy(false) }
  }

  const navTo = (next: View) => {
    if ((next === 'library' || next === 'dashboard') && !user) { startAuth('login'); return }
    if (next === 'library' && !user?.isMember) { setView('membership'); return }
    setMobileOpen(false)
    setView(next)
  }

  const toggleCopyConnection = async () => {
    const action = connected ? 'disconnect' : 'connect'
    const response = await fetch(`${API}/api/copy/${action}`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: 'APEX Demo', accountName: user?.email || 'demo-account' }) })
    if (response.ok) setConnected(!connected)
    else { const result = await response.json(); setAuthError(result.error || 'Connect your member account to continue.') }
  }

  const toggleBot = async (bot: (typeof visibleBots)[number]) => {
    const active = bot.id ? Boolean(bots.find((item) => item.id === bot.id)?.activated) : activeBotIds.includes(bot.name)
    if (!bot.id) { setActiveBotIds((current) => active ? current.filter((name) => name !== bot.name) : [...current, bot.name]); return }
    const response = await fetch(`${API}/api/bots/${bot.id}/activation`, { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ active: !active }) })
    if (response.ok) setBots((current) => current.map((item) => item.id === bot.id ? { ...item, activated: !active } : item))
  }

  const price = symbol === 'XAUUSD' ? tick.price : tick.price * 4.628
  const visibleBots = bots.length ? bots.map((bot) => ({ name: bot.name, tag: `${bot.symbol} · ${bot.strategy}`, detail: bot.description, return: bot.returnRate, win: bot.winRate, trades: String(bot.tradeCount), id: bot.id, downloadUrl: bot.downloadUrl, activated: bot.activated })) : demoBots.map((bot) => ({ ...bot, id: '', downloadUrl: null, activated: activeBotIds.includes(bot.name) }))
  const visibleCourses = courses.length ? courses.map((course, index) => ({ ...course, lessons: `${course.lessonCount} lessons`, color: ['sage', 'rust', 'gold'][index % 3] })) : demoCourses.map((course, index) => ({ ...course, id: '', lessonCount: Number.parseInt(course.lessons), sortOrder: index + 1, description: '', assetUrl: null, progress: courseProgress[index], color: course.color }))
  const tradingViewSymbol = symbol === 'XAUUSD' ? 'OANDA:XAUUSD' : 'NASDAQ:NDX'
  const chartUrl = `https://s.tradingview.com/widgetembed/?frameElementId=tradingview_apex&symbol=${tradingViewSymbol}&interval=${timeframe}&hidesidetoolbar=1&symboledit=0&saveimage=0&toolbarbg=101311&theme=dark&style=1&timezone=Etc%2FUTC&withdateranges=1&hideideas=1&studies=%5B%5D&locale=en`

  return (
    <div className="app-shell">
      <div className="ambient ambient-one" /><div className="ambient ambient-two" />
      <header className="topbar glass">
        <a className="brand" href="#top" onClick={(event) => { event.preventDefault(); setView('overview') }} aria-label="APEX TRADES home"><span className="brand-mark">A</span><span>APEX<span className="brand-light">TRADES</span></span></a>
        <nav id="primary-navigation" className={`main-nav ${mobileOpen ? 'nav-open' : ''}`} aria-label="Main navigation">
          <button className={view === 'overview' ? 'nav-link active' : 'nav-link'} onClick={() => navTo('overview')}>Overview</button>
          <button className={view === 'markets' ? 'nav-link active' : 'nav-link'} onClick={() => navTo('markets')}>Markets</button>
          <button className={view === 'membership' ? 'nav-link active' : 'nav-link'} onClick={() => navTo('membership')}>Membership</button>
          {user && <button className={view === 'library' ? 'nav-link active' : 'nav-link'} onClick={() => navTo('library')}>Member library</button>}
          {user?.isAdmin && <button className={view === 'admin' ? 'nav-link active' : 'nav-link'} onClick={() => navTo('admin')}>Admin</button>}
        </nav>
        <div className="nav-actions">
          {user ? <><button className="avatar-button" aria-label="Open dashboard" onClick={() => navTo('dashboard')}>{user.name.slice(0, 1).toUpperCase()}</button><button className="icon-button logout-button" title="Log out" onClick={logout}><LogOut size={16} /></button></> : <><button className="nav-login" onClick={() => startAuth('login')}>Log in</button><button className="button button-gold nav-signup" onClick={() => startAuth('signup')}>Get started <ArrowRight size={14} /></button></>}
        </div>
        <button className="mobile-menu icon-button" aria-label={mobileOpen ? 'Close navigation' : 'Open navigation'} aria-controls="primary-navigation" aria-expanded={mobileOpen} onClick={() => setMobileOpen(!mobileOpen)}>{mobileOpen ? <X size={20} /> : <Menu size={20} />}</button>
      </header>

      <main id="top">
        {view === 'overview' && <>
          <section className="hero-section content-width">
            <motion.div className="hero-copy" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.65 }}>
              <div className="eyebrow"><span className="live-dot" /> INDEPENDENT MARKET INTELLIGENCE</div>
              <h1>Clarity in every<br /><span>market move.</span></h1>
              <p className="hero-description">A considered edge for the markets that move. Trade with structure, learn with purpose, and keep your process in focus.</p>
              <div className="hero-actions"><button className="button button-gold" onClick={() => user ? navTo('dashboard') : startAuth('signup')}>Start your membership <ArrowRight size={16} /></button><button className="button button-quiet" onClick={() => navTo('markets')}><Play size={14} fill="currentColor" /> Explore the markets</button></div>
              <div className="trust-line"><div className="trust-avatars"><span>J</span><span>M</span><span>A</span><span>+</span></div><span>Built for deliberate traders</span><span className="trust-divider" /><span className="rating-stars">★★★★★</span><span>4.9 / 5</span></div>
            </motion.div>
            <motion.div className="hero-terminal glass" initial={{ opacity: 0, x: 26 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.7, delay: 0.12 }}>
              <div className="terminal-head"><div><div className="terminal-kicker"><span className="live-dot" /> MARKET SNAPSHOT</div><h2>Gold spot <span className="instrument">XAUUSD</span></h2></div><button className="icon-button" title="Open market" onClick={() => navTo('markets')}><ExternalLink size={15} /></button></div>
              <div className="hero-price-row"><strong>${tick.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong><span className="positive-pill"><ArrowUpRight size={13} /> {tick.change.toFixed(2)}%</span></div>
              <div className="chart-wrap hero-chart"><MiniChart /></div>
              <div className="chart-axis"><span>09:00</span><span>12:00</span><span>15:00</span><span>18:00 UTC</span></div>
              <div className="terminal-stats"><div><span>DAY HIGH</span><strong>${(tick.price + 14.26).toFixed(2)}</strong></div><div><span>DAY LOW</span><strong>${(tick.price - 8.42).toFixed(2)}</strong></div><div><span>MARKET</span><strong className="open-status"><i /> OPEN</strong></div></div>
              <div className="terminal-footer"><span><Radio size={13} /> Prices update live</span><span>Data by TradingView</span></div>
            </motion.div>
          </section>

          <section className="ticker-bar"><div className="ticker-inner content-width"><div className="ticker-label"><Activity size={14} /> LIVE MARKETS</div><div className="ticker-item"><span>GOLD</span><strong>${tick.price.toLocaleString('en-US', { minimumFractionDigits: 2 })}</strong><em className="up">+0.84%</em></div><div className="ticker-item"><span>NASDAQ 100</span><strong>18,462.50</strong><em className="up">+1.12%</em></div><div className="ticker-item ticker-hide"><span>EUR / USD</span><strong>1.08426</strong><em className="down">−0.16%</em></div><div className="ticker-item ticker-hide"><span>BTC / USD</span><strong>67,420.80</strong><em className="up">+2.43%</em></div><button className="ticker-more" onClick={() => navTo('markets')}>All markets <ArrowRight size={13} /></button></div></section>

          <section className="philosophy content-width"><div className="section-kicker">THE APEX APPROACH <span>01 — 03</span></div><div className="philosophy-grid"><h2>Good trading isn't<br />more noise. It's <em>less.</em></h2><div className="philosophy-copy"><p>We bring the tools, education, and perspective into one focused space, so you can spend less time searching and more time building a process you trust.</p><button className="text-link" onClick={() => navTo('membership')}>Discover the APEX edge <ArrowRight size={15} /></button></div></div>
            <div className="feature-grid"><article className="feature-card"><span className="feature-icon"><BarChart3 size={19} /></span><span className="feature-index">01 / ANALYSE</span><h3>See the whole picture</h3><p>Live market context and clear technical levels without the clutter.</p><button className="feature-link" onClick={() => navTo('markets')}>Explore markets <ArrowRight size={14} /></button></article><article className="feature-card"><span className="feature-icon"><GraduationCap size={19} /></span><span className="feature-index">02 / LEARN</span><h3>Build a repeatable edge</h3><p>Structured courses that move from market foundations to execution.</p><button className="feature-link" onClick={() => navTo('membership')}>See the curriculum <ArrowRight size={14} /></button></article><article className="feature-card"><span className="feature-icon"><Activity size={19} /></span><span className="feature-index">03 / EXECUTE</span><h3>Make your process yours</h3><p>Systematic tools and a transparent trade journal to support your own decisions.</p><button className="feature-link" onClick={() => navTo('membership')}>Inside membership <ArrowRight size={14} /></button></article></div>
          </section>

          <section className="membership-band"><div className="content-width membership-band-inner"><div><div className="section-kicker">APEX MEMBERSHIP <span>BUILT FOR THE LONG GAME</span></div><h2>Your next move,<br /><em>more intentional.</em></h2><p>One membership. A full trading toolkit designed around clarity, discipline, and continuous improvement.</p></div><div className="membership-offer glass"><div className="offer-top"><span className="offer-label"><Crown size={14} /> FULL ACCESS</span><span className="offer-note">CANCEL ANYTIME</span></div><div className="offer-price"><strong>$39</strong><span>/ month</span></div><ul><li><Check size={14} /> Every strategy bot & setup</li><li><Check size={14} /> Full course library</li><li><Check size={14} /> Live trade feed & analysis</li><li><Check size={14} /> Member dashboard</li></ul><button className="button button-gold offer-cta" onClick={() => navTo('membership')}>Explore membership <ArrowRight size={15} /></button><span className="offer-footnote">30-day satisfaction guarantee</span></div></div></section>
        </>}

        {view === 'markets' && <section className="page-section content-width"><div className="page-heading"><div><div className="section-kicker">MARKET INTELLIGENCE <span>LIVE</span></div><h1>Markets, in focus.</h1><p>Live charting and a clear read on the instruments that matter.</p></div><span className="market-live"><i /> MARKET OPEN</span></div><div className="market-layout"><div className="market-main glass"><div className="market-toolbar"><div className="symbol-switch"><button className={symbol === 'XAUUSD' ? 'selected' : ''} onClick={() => setSymbol('XAUUSD')}>XAUUSD <span>Gold</span></button><button className={symbol === 'US100' ? 'selected' : ''} onClick={() => setSymbol('US100')}>US100 <span>Nasdaq 100</span></button></div><div className="time-switch">{[['15', '15m'], ['60', '1H'], ['240', '4H'], ['D', '1D']].map(([value, label]) => <button key={value} className={timeframe === value ? 'selected' : ''} onClick={() => setTimeframe(value)}>{label}</button>)}</div></div><div className="market-price"><strong>${price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong><span className="up">+{tick.change.toFixed(2)}%</span><span className="muted">Updated just now</span></div><div className="tradingview-frame"><iframe title={`${symbol} TradingView chart`} src={chartUrl} /></div></div><aside className="market-aside"><div className="glass market-quote"><div className="panel-label">MARKET OVERVIEW <span className="live-dot" /></div><h3>Today's range</h3><div className="range-values"><span>${(price - 8.42).toFixed(2)}</span><span>${(price + 14.26).toFixed(2)}</span></div><div className="range-track"><span /></div><div className="range-labels"><span>LOW</span><span>HIGH</span></div><div className="quote-row"><span>Previous close</span><strong>${(price - 4.06).toFixed(2)}</strong></div><div className="quote-row"><span>Day change</span><strong className="up">+${(price * tick.change / 100).toFixed(2)}</strong></div><div className="quote-row"><span>Session</span><strong>New York</strong></div></div><div className="glass insight-panel"><div className="panel-label"><Sparkles size={13} /> APEX INSIGHT</div><p>Price is holding above the session midpoint. Keep risk defined around your own plan.</p><span>EDUCATIONAL CONTEXT ONLY</span></div></aside></div></section>}

        {view === 'membership' && <section className="page-section content-width membership-page"><div className="page-heading centered-heading"><div><div className="section-kicker">MEMBERSHIP <span>ONE CLEAR PLAN</span></div><h1>Make room for your edge.</h1><p>Practical tools and thoughtful education, brought together in one place.</p></div></div><div className="billing-toggle"><button className={period === 'monthly' ? 'selected' : ''} onClick={() => setPeriod('monthly')}>Monthly</button><button className={period === 'yearly' ? 'selected' : ''} onClick={() => setPeriod('yearly')}>Yearly <span>Save 20%</span></button></div><div className="plan-card glass"><div className="plan-copy"><div className="plan-label"><Crown size={15} /> APEX MEMBER</div><h2>Trade with intention.</h2><p>Everything you need to bring more structure to your process, with a library that grows alongside you.</p><div className="plan-price"><strong>${period === 'monthly' ? '39' : '31'}</strong><span>/ month{period === 'yearly' && ', billed annually'}</span></div><button className="button button-gold plan-cta" disabled={busy || user?.isMember} onClick={becomeMember}>{user?.isMember ? 'You’re a member' : busy ? 'Opening checkout…' : 'Become a member'} {!user?.isMember && <ArrowRight size={15} />}</button><span className="plan-secure"><LockKeyhole size={12} /> Secure checkout powered by Stripe</span></div><div className="plan-includes"><span className="feature-index">EVERYTHING INCLUDED</span>{['Trading bots and performance stats', 'Full course library with progress tracking', 'Copy trading feed and trade history', 'Member dashboard and plan management', 'New tools and lessons as they arrive'].map((item) => <div className="include-row" key={item}><span><Check size={13} /></span>{item}</div>)}<div className="plan-guarantee"><ShieldCheck size={18} /><span><strong>30-day satisfaction guarantee</strong><small>Cancel any time, no questions asked.</small></span></div></div></div><p className="member-disclaimer">Membership provides educational tools and analysis, not investment advice. Trading involves risk.</p></section>}

        {view === 'library' && <section className="page-section content-width"><div className="page-heading"><div><div className="section-kicker">MEMBER LIBRARY <span>YOUR ACCESS</span></div><h1>Tools for your process.</h1><p>Strategy, education, and a transparent view of the APEX trade log.</p></div><span className="member-tag"><Crown size={13} /> MEMBER ACCESS</span></div><div className="library-grid"><div className="library-column"><div className="library-title"><div><span className="panel-label">SYSTEMATIC TOOLS</span><h2>Trading bots</h2></div><span className="count-label">{visibleBots.length} SYSTEMS</span></div>{visibleBots.map((bot) => <article className="bot-card glass" key={bot.id || bot.name}><div className="bot-card-head"><div><span className="bot-tag">{bot.tag}</span><h3>{bot.name}</h3></div><span className="bot-status"><i /> ACTIVE</span></div><p>{bot.detail}</p><div className="bot-stats"><div><span>RETURN*</span><strong className="up">{bot.return}</strong></div><div><span>WIN RATE</span><strong>{bot.win}</strong></div><div><span>TRADES</span><strong>{bot.trades}</strong></div></div><div className="bot-actions"><button className="button button-outline" onClick={() => toggleBot(bot)}>{bot.activated ? <><Check size={14} /> Activated</> : <><Activity size={14} /> Activate</>}</button>{bot.downloadUrl && <a className="icon-button" title="Download bot" href={`${API}${bot.downloadUrl}`}><Download size={15} /></a>}</div></article>)}</div><div className="library-column"><div className="library-title"><div><span className="panel-label">APEX ACADEMY</span><h2>Course library</h2></div><span className="count-label">{courseProgress.filter((value) => value > 0).length} IN PROGRESS</span></div>{visibleCourses.map((course, index) => <article className={`course-card glass course-${course.color}`} key={course.id || course.title}><div className="course-art"><span>{String(index + 1).padStart(2, '0')}</span><BookOpen size={23} /></div><div className="course-content"><span className="course-module">{course.module}</span><h3>{course.title}</h3><span className="course-meta">{course.lessons} <span>·</span> {courseProgress[index] || 0}% complete</span><div className="progress-track"><span style={{ width: `${courseProgress[index] || 0}%` }} /></div>{course.assetUrl && <video className="course-video" src={`${API}${course.assetUrl}`} controls preload="metadata" />}{course.description && <p className="course-description">{course.description}</p>}<button className="course-continue" onClick={() => { const next = [...courseProgress]; next[index] = Math.min(100, (next[index] || 0) + 10); setCourseProgress(next); fetch(`${API}/api/courses/${course.sortOrder}/progress`, { method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ progress: next[index] }) }).catch(() => undefined) }}>{courseProgress[index] ? 'Continue learning' : 'Start course'} <ArrowRight size={13} /></button></div></article>)}</div></div><div className="trade-log glass"><div className="library-title"><div><span className="panel-label">COPY TRADING · DEMO LINK</span><h2>Recent trades</h2></div><button className="button button-outline" onClick={toggleCopyConnection}>{connected ? <><Check size={13} /> Demo connected</> : 'Connect demo account'}</button></div><div className="trade-table"><div className="trade-table-head"><span>INSTRUMENT</span><span>DIRECTION</span><span>OPENED</span><span>RESULT</span><span>STATUS</span></div>{trades.slice(0, 8).map((trade) => <div className="trade-row" key={trade.id}><strong>{trade.symbol}</strong><span className={trade.side === 'LONG' ? 'up' : 'down'}>{trade.side}</span><span>{new Date(trade.openedAt).toLocaleString()}</span><strong className={trade.result?.startsWith('+') ? 'up' : trade.result?.startsWith('−') ? 'down' : ''}>{trade.result || '—'}</strong><span className="closed-status">{trade.status}</span></div>)}</div>{!trades.length && <p className="empty-trades">New trades will appear here.</p>}<p className="performance-note">*Illustrative historical results, net of estimated costs. Past performance does not predict future results.</p></div></section>}

        {view === 'dashboard' && <section className="page-section content-width"><div className="page-heading"><div><div className="section-kicker">YOUR APEX <span>ACCOUNT</span></div><h1>Good to see you, {user?.name.split(' ')[0]}.</h1><p>Your membership, learning progress, and account details in one place.</p></div><button className="button button-outline" onClick={() => navTo('library')}>Open member library <ArrowRight size={14} /></button></div><div className="dashboard-grid"><div className="glass dashboard-profile"><div className="profile-avatar">{user?.name.slice(0, 1).toUpperCase()}</div><div><span className="panel-label">YOUR PROFILE</span><h2>{user?.name}</h2><p>{user?.email}</p></div><button className="icon-button" title="Log out" onClick={logout}><LogOut size={15} /></button></div><div className="glass subscription-card"><div className="subscription-head"><span className="panel-label">MEMBERSHIP STATUS</span><span className={user?.isMember ? 'status-chip active-chip' : 'status-chip'}><i /> {user?.isMember ? 'ACTIVE' : 'FREE'}</span></div><h2>{user?.isMember ? 'APEX Member' : 'Free account'}</h2><p>{user?.isMember ? 'Full access to your trading toolkit and learning library.' : 'Unlock bots, courses, and the live trade journal.'}</p><button className="button button-gold" onClick={() => user?.isMember ? fetch(`${API}/api/subscriptions/cancel`, { method: 'POST', credentials: 'include' }).then(async (res) => { const data = await res.json(); if (res.ok) setUser(data.user) }) : navTo('membership')}>{user?.isMember ? 'Manage or cancel plan' : 'Become a member'} <ArrowRight size={14} /></button></div><div className="glass dashboard-progress"><div className="panel-label">LEARNING PROGRESS</div><h2>Your learning, in motion.</h2>{demoCourses.map((course, index) => <div className="dashboard-course" key={course.title}><div><span>{course.title}</span><strong>{courseProgress[index]}%</strong></div><div className="progress-track"><span style={{ width: `${courseProgress[index]}%` }} /></div></div>)}<button className="text-link" onClick={() => navTo('library')}>Go to courses <ArrowRight size={14} /></button></div><div className="glass dashboard-shortcuts"><div className="panel-label">QUICK ACCESS</div><button onClick={() => navTo('library')}><Activity size={16} /> Trading systems <ArrowRight size={14} /></button><button onClick={() => navTo('library')}><GraduationCap size={16} /> Continue learning <ArrowRight size={14} /></button><button onClick={() => navTo('markets')}><TrendingUp size={16} /> Live market view <ArrowRight size={14} /></button></div></div></section>}

        {view === 'admin' && user?.isAdmin && <AdminPanel />}
      </main>

      {resetToken && <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }}><motion.div className="auth-modal glass" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}><button className="modal-close icon-button" aria-label="Close" onClick={() => setResetToken('')}><X size={18} /></button><div className="modal-brand"><span className="brand-mark">A</span></div><span className="section-kicker">ACCOUNT RECOVERY</span><h2>Choose a new password.</h2><p>Your local reset token is shown here. In production, deliver this through your email provider.</p><code className="reset-token">{resetToken}</code><form className="auth-form" onSubmit={async (event) => { event.preventDefault(); const newPassword = String(new FormData(event.currentTarget).get('newPassword') || ''); setBusy(true); try { const response = await fetch(`${API}/api/auth/password-reset`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: resetToken, newPassword }) }); const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Could not update password.'); setAuthError(result.message); setResetToken(''); setAuthMode('login') } catch (error) { setAuthError(error instanceof Error ? error.message : 'Could not update password.') } finally { setBusy(false) } }}><label>New password<input name="newPassword" type="password" required minLength={8} placeholder="At least 8 characters" /></label><button className="button button-gold auth-submit" disabled={busy}>{busy ? 'Updating…' : 'Update password'} <ArrowRight size={15} /></button></form></motion.div></motion.div>}

      <footer className="site-footer"><div className="content-width footer-main"><a className="brand" href="#top" onClick={(event) => { event.preventDefault(); setView('overview') }}><span className="brand-mark">A</span><span>APEX<span className="brand-light">TRADES</span></span></a><span className="footer-tagline">Clarity in every market move.</span><div className="footer-links"><button onClick={() => navTo('markets')}>Markets</button><button onClick={() => navTo('membership')}>Membership</button><button onClick={() => startAuth('login')}>Account</button><a href="mailto:support@apextrades.example">Contact</a></div></div><div className="content-width footer-bottom"><span>© 2026 APEX TRADES. All rights reserved.</span><span className="risk-disclaimer">Trading involves risk. Past performance is not indicative of future results.</span><a href="#top" onClick={(event) => { event.preventDefault(); setView('overview') }}>Back to top ↑</a></div></footer>

      <AnimatePresence>{authMode && <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setAuthMode(null)}><motion.div className="auth-modal glass" initial={{ opacity: 0, y: 16, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 12 }} onClick={(event) => event.stopPropagation()}><button className="modal-close icon-button" aria-label="Close" onClick={() => setAuthMode(null)}><X size={18} /></button><div className="modal-brand"><span className="brand-mark">A</span></div><span className="section-kicker">{authMode === 'signup' ? 'A MORE CONSIDERED EDGE' : authMode === 'reset' ? 'ACCOUNT RECOVERY' : 'WELCOME BACK'}</span><h2>{authMode === 'signup' ? 'Start with intention.' : authMode === 'reset' ? 'Reset your password.' : 'Good to have you back.'}</h2><p>{authMode === 'signup' ? 'Create your account and get closer to your process.' : authMode === 'reset' ? 'We’ll send a reset link to your email address.' : 'Sign in to pick up where you left off.'}</p><form onSubmit={submitAuth} className="auth-form">{authMode === 'signup' && <label>Your name<input name="name" autoComplete="name" required minLength={2} placeholder="Alex Morgan" /></label>}<label>Email address<input name="email" type="email" autoComplete="email" required placeholder="you@example.com" /></label>{authMode !== 'reset' && <label>Password<input name="password" type="password" autoComplete={authMode === 'signup' ? 'new-password' : 'current-password'} required minLength={8} placeholder="At least 8 characters" /></label>}{authError && <div className={authMode === 'reset' && authError.startsWith('If') ? 'form-message success-message' : 'form-message'}>{authError}</div>}<button className="button button-gold auth-submit" disabled={busy}>{busy ? 'Please wait…' : authMode === 'signup' ? 'Create account' : authMode === 'reset' ? 'Send reset link' : 'Log in'} <ArrowRight size={15} /></button></form><button className="auth-switch" onClick={() => startAuth(authMode === 'reset' ? 'login' : authMode === 'signup' ? 'login' : 'signup')}>{authMode === 'reset' ? 'Back to log in' : authMode === 'signup' ? 'Already have an account? Log in' : 'New to APEX? Create an account'}</button>{authMode === 'login' && <button className="reset-link" onClick={() => startAuth('reset')}>Forgot password?</button>}<div className="auth-divider"><span /> <i>OR</i> <span /></div><button className="demo-button" disabled={busy} onClick={demoLogin}><Sparkles size={15} /> Try member demo</button><span className="demo-caption">Instant demo access · No payment details required</span><div className="modal-privacy"><LockKeyhole size={12} /> Your data stays private and secure</div></motion.div></motion.div>}</AnimatePresence>
      <div className="socket-status" role="status" aria-live="polite" aria-atomic="true" aria-label={isLive ? 'Live connection' : 'Connecting to live feed'}><span className={isLive ? 'live-dot' : 'live-dot offline-dot'} />{isLive ? 'LIVE' : 'CONNECTING'}</div>
    </div>
  )
}

function MiniChart() {
  const points = '0,102 18,96 33,99 49,80 65,86 81,76 97,84 114,63 130,67 145,51 161,57 178,43 194,49 210,35 227,39 243,27 259,36 276,20 293,24 310,12 326,23 343,16 360,26 377,12 394,19 410,5 427,14 444,3 460,10 480,0'
  return <svg className="mini-chart-svg" viewBox="0 0 480 122" preserveAspectRatio="none" aria-label="Gold intraday chart"><defs><linearGradient id="chartFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#d4af37" stopOpacity=".22" /><stop offset="100%" stopColor="#d4af37" stopOpacity="0" /></linearGradient></defs><path d={`M ${points.replaceAll(' ', ' L ')} L 480 122 L 0 122 Z`} fill="url(#chartFill)" /><polyline points={points} fill="none" stroke="#d4af37" strokeWidth="2" vectorEffect="non-scaling-stroke" /><circle cx="480" cy="0" r="4" fill="#e8c75e" /></svg>
}

function AdminPanel() {
  const [users, setUsers] = useState<AdminUser[]>([])
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { fetch(`${API}/api/admin/users`, { credentials: 'include' }).then((response) => response.ok ? response.json() : null).then((data) => data?.users && setUsers(data.users)).catch(() => undefined) }, [])
  const uploadAsset = async (file: File) => {
    const body = new FormData(); body.append('file', file)
    const response = await fetch(`${API}/api/admin/assets`, { method: 'POST', credentials: 'include', body })
    const result = await response.json()
    if (!response.ok) throw new Error(result.error || 'Upload failed.')
    return result.url as string
  }
  const submitContent = async (event: FormEvent<HTMLFormElement>, kind: 'bots' | 'courses') => {
    event.preventDefault(); const formElement = event.currentTarget; setBusy(true); setMessage('')
    try {
      const form = new FormData(formElement)
      const file = form.get('file')
      const assetUrl = file instanceof File && file.size ? await uploadAsset(file) : undefined
      const body = Object.fromEntries([...form.entries()].filter(([key]) => key !== 'file'))
      const payload = kind === 'bots' ? { ...body, tradeCount: Number(body.tradeCount || 0), downloadUrl: assetUrl } : { ...body, lessonCount: Number(body.lessonCount || 1), sortOrder: Number(body.sortOrder || 0), assetUrl }
      const response = await fetch(`${API}/api/admin/${kind}`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Could not publish content.')
      setMessage(`${kind === 'bots' ? 'Trading bot' : 'Course'} published.`); formElement.reset()
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not publish content.') }
    finally { setBusy(false) }
  }
  const submitTrade = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const body = Object.fromEntries(new FormData(event.currentTarget)); const response = await fetch(`${API}/api/admin/trades`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); const result = await response.json(); setMessage(response.ok ? 'Trade posted to the member feed.' : result.error || 'Could not post trade.')
  }
  const updateSubscription = async (userId: string, status: string) => {
    const response = await fetch(`${API}/api/admin/users/${userId}/subscription`, { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) })
    if (response.ok) setUsers((current) => current.map((user) => user.id === userId ? { ...user, subscriptions: [{ status, interval: user.subscriptions[0]?.interval || 'MONTHLY', currentPeriodEnd: user.subscriptions[0]?.currentPeriodEnd || null }] } : user))
  }
  return <section className="page-section content-width"><div className="page-heading"><div><div className="section-kicker">OWNER CONSOLE <span>ADMIN</span></div><h1>Manage APEX.</h1><p>Publish learning material, share market updates, and manage members.</p></div></div><div className="admin-grid"><div className="admin-form-card glass"><div className="panel-label">UPLOAD A BOT</div><form onSubmit={(event) => submitContent(event, 'bots')} className="admin-form"><label>Bot name<input name="name" required placeholder="Aurum Edge" /></label><label>Symbol<input name="symbol" required placeholder="XAUUSD" /></label><label>Strategy<input name="strategy" required placeholder="Trend following" /></label><label>Performance description<input name="description" required placeholder="How the strategy works" /></label><label>Return<input name="returnRate" placeholder="+12.4%" /></label><label>Win rate<input name="winRate" placeholder="62%" /></label><label>Trade count<input name="tradeCount" type="number" min="0" defaultValue="0" /></label><label>Bot package<input name="file" type="file" accept=".zip,.ex4,.ex5,.mq4,.mq5,.pdf" /></label><button className="button button-gold" disabled={busy}>Publish bot <ArrowRight size={14} /></button></form></div><div className="admin-form-card glass"><div className="panel-label">UPLOAD A COURSE</div><form onSubmit={(event) => submitContent(event, 'courses')} className="admin-form"><label>Course title<input name="title" required placeholder="Read the Market" /></label><label>Module<input name="module" required placeholder="01 · FOUNDATIONS" /></label><label>Description<input name="description" required placeholder="Course summary" /></label><label>Lesson count<input name="lessonCount" type="number" min="1" required defaultValue="8" /></label><label>Display order<input name="sortOrder" type="number" min="0" defaultValue="1" /></label><label>Course media<input name="file" type="file" accept="video/mp4,video/webm,video/quicktime,.pdf" /></label><button className="button button-gold" disabled={busy}>Publish course <ArrowRight size={14} /></button></form></div><div className="admin-form-card glass"><div className="panel-label">POST A TRADE</div><form onSubmit={submitTrade} className="admin-form"><label>Symbol<input name="symbol" required placeholder="XAUUSD" /></label><label>Direction<select name="side"><option>LONG</option><option>SHORT</option></select></label><label>Entry price<input name="entry" type="number" step="any" required placeholder="2328.40" /></label><label>Notes<input name="notes" placeholder="Session breakout setup" /></label><button className="button button-gold">Publish trade <ArrowRight size={14} /></button></form></div><div className="admin-form-card glass member-admin-card"><div className="admin-members-heading"><div><div className="panel-label">MEMBERS AND SUBSCRIPTIONS</div><h2>{users.length} accounts</h2></div></div><div className="admin-member-list">{users.map((user) => <div className="admin-member-row" key={user.id}><div><strong>{user.name}</strong><span>{user.email}</span></div><select aria-label={`Subscription for ${user.email}`} value={user.subscriptions[0]?.status || 'INACTIVE'} onChange={(event) => updateSubscription(user.id, event.target.value)}><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option><option value="CANCELED">Canceled</option></select></div>)}</div></div></div>{message && <p className="form-message success-message admin-message">{message}</p>}<p className="admin-note">Uploaded files are stored locally in development. Configure private object storage before deploying.</p></section>
}

export default App
