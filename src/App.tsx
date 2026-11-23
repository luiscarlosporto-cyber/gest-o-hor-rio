import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react'
import { LocalStore, type DataStore } from './data/store'
import { signInWithGoogle, supabase } from './data/supabase'
import { useAppData } from './state/useAppData'
import { useCloud } from './state/useCloud'
import type { View } from './ui/CalendarPage'
import type { Theme } from './ui/SettingsPage'
import { IconCalendar, IconHome, IconReport, IconSearch, IconSettings, IconShifts, IconTasks } from './ui/icons'
import { GlobalSearch } from './ui/GlobalSearch'
import { HomePage } from './ui/HomePage'
import { pendingCount } from './domain/tasks'
import { onUpdateReady } from './pwa'

// Cada ecrã é carregado só quando é aberto (o Início vem logo no arranque).
const CalendarPage = lazy(() => import('./ui/CalendarPage').then((m) => ({ default: m.CalendarPage })))
const SettingsPage = lazy(() => import('./ui/SettingsPage').then((m) => ({ default: m.SettingsPage })))
const ShiftsPage = lazy(() => import('./ui/ShiftsPage').then((m) => ({ default: m.ShiftsPage })))
const ReportsPage = lazy(() => import('./ui/ReportsPage').then((m) => ({ default: m.ReportsPage })))
const TasksPage = lazy(() => import('./ui/TasksPage').then((m) => ({ default: m.TasksPage })))

type Page = 'home' | 'calendar' | 'tasks' | 'shifts' | 'reports' | 'settings'

const readPref = <T extends string>(key: string, fallback: T): T => {
  try {
    return (localStorage.getItem(key) as T) || fallback
  } catch {
    return fallback
  }
}

export default function App({ store: injected }: { store?: DataStore }) {
  const cloud = useCloud(injected)
  const { store } = cloud
  const { data, loaded, error, update, undo, reload } = useAppData(store)
  cloud.onSynced.current = reload
  const googleLinked = Boolean(cloud.google)
  const { syncNow } = cloud
  const [page, setPage] = useState<Page>('home')
  const [view, setView] = useState<View>(() => readPref<View>('gh:view', 'week'))
  const [cursor, setCursor] = useState(() => new Date())
  const [theme, setTheme] = useState<Theme>(() => readPref<Theme>('gh:theme', 'system'))
  const [signInError, setSignInError] = useState<string | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [applyUpdate, setApplyUpdate] = useState<(() => void) | null>(null)
  useEffect(() => onUpdateReady((apply) => setApplyUpdate(() => apply)), [])

  useEffect(() => {
    document.documentElement.dataset.theme = theme === 'system' ? '' : theme
    try {
      localStorage.setItem('gh:theme', theme)
    } catch {
      /* sem armazenamento */
    }
  }, [theme])
  useEffect(() => {
    try {
      localStorage.setItem('gh:view', view)
    } catch {
      /* sem armazenamento */
    }
  }, [view])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) || t.isContentEditable
      if (((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') || (e.key === '/' && !typing)) {
        e.preventDefault()
        setSearchOpen(true)
        return
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !['INPUT', 'TEXTAREA'].includes(t.tagName)) {
        e.preventDefault()
        undo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo])

  // Primeira entrada na conta: se a nuvem estiver vazia, envia os dados que estavam neste browser.
  const migrated = useRef(false)
  useEffect(() => {
    if (store.kind !== 'supabase' || !loaded || migrated.current) return
    migrated.current = true
    if (data.events.length || data.shiftDays.length || data.tasks.length) return
    new LocalStore().load().then((local) => {
      if (local.events.length || local.shiftDays.length || local.tasks.length) update(() => local)
    })
  }, [store, loaded, data, update])

  // Sincronizar ao abrir, de 5 em 5 minutos e pouco depois de cada alteração.
  useEffect(() => {
    if (store.kind !== 'supabase' || !loaded || !googleLinked) return
    syncNow()
    const t = window.setInterval(() => document.visibilityState === 'visible' && syncNow(), 5 * 60_000)
    return () => window.clearInterval(t)
  }, [store, loaded, googleLinked, syncNow])
  const firstData = useRef(true)
  useEffect(() => {
    if (firstData.current) {
      firstData.current = false
      return
    }
    if (store.kind !== 'supabase' || !googleLinked) return
    const t = window.setTimeout(() => syncNow(), 4000)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data])

  if (!cloud.ready || !loaded) return <div className="splash">A carregar…</div>

  return (
    <div className="app">
      <nav className="sidebar" aria-label="Navegação">
        <div className="brand">
          <span className="brand-mark" aria-hidden>
            <IconShifts />
          </span>
          <span>Gestão Horário</span>
        </div>
        <button className="global-search-btn" onClick={() => setSearchOpen(true)} aria-label="Pesquisar em toda a app">
          <IconSearch />
          <span>Pesquisar</span>
          <kbd>Ctrl K</kbd>
        </button>
        <NavItem icon={<IconHome />} label="Início" active={page === 'home'} onClick={() => setPage('home')} />
        <NavItem icon={<IconCalendar />} label="Calendário" active={page === 'calendar'} onClick={() => setPage('calendar')} />
        <NavItem icon={<IconTasks />} label="Tarefas" badge={pendingCount(data.tasks, new Date())} active={page === 'tasks'} onClick={() => setPage('tasks')} />
        <NavItem icon={<IconShifts />} label="Turnos" active={page === 'shifts'} onClick={() => setPage('shifts')} />
        <NavItem icon={<IconReport />} label="Relatórios" active={page === 'reports'} onClick={() => setPage('reports')} />
        <NavItem icon={<IconSettings />} label="Definições" active={page === 'settings'} onClick={() => setPage('settings')} />
        <div className="sidebar-foot small">
          {supabase && !cloud.session && (
            <button className="btn btn-google" onClick={() => signInWithGoogle().catch((e) => setSignInError(String(e)))}>
              Entrar com Google
            </button>
          )}
          {cloud.session ? (
            <button className="sync-status" onClick={() => setPage('settings')} title={cloud.syncMessage ?? undefined}>
              <span className={`sync-dot is-${cloud.sync}${googleLinked ? '' : ' is-off'}`} />
              <span className="muted">
                {cloud.sync === 'syncing'
                  ? 'A sincronizar…'
                  : cloud.sync === 'error'
                    ? 'Erro na sincronização'
                    : googleLinked
                      ? 'Google Calendar ligado'
                      : 'Google não ligado'}
              </span>
            </button>
          ) : (
            <span className="muted">Dados neste browser</span>
          )}
        </div>
      </nav>
      <main className="main">
        {applyUpdate && (
          <div className="update banner" role="status">
            <span>Há uma versão nova da app.</span>
            <button className="btn btn-sm btn-primary" onClick={applyUpdate}>
              Atualizar
            </button>
          </div>
        )}
        {(error || signInError) && (
          <div className="error banner" role="alert">
            {error ?? signInError}
          </div>
        )}
        <Suspense fallback={<div className="page-loading" aria-busy="true" />}>
        {page === 'home' && (
          <HomePage
            data={data}
            update={update}
            go={(p, date) => {
              if (date) setCursor(date)
              setPage(p)
            }}
          />
        )}
        {page === 'reports' && <ReportsPage data={data} update={update} cursor={cursor} setCursor={setCursor} />}
        {page === 'calendar' && <CalendarPage data={data} update={update} cursor={cursor} setCursor={setCursor} view={view} setView={setView} />}
        {page === 'tasks' && <TasksPage data={data} update={update} cloud={cloud} />}
        {page === 'shifts' && <ShiftsPage data={data} update={update} cursor={cursor} setCursor={setCursor} />}
        {page === 'settings' && <SettingsPage data={data} store={store} theme={theme} setTheme={setTheme} update={update} cloud={cloud} />}
        </Suspense>
      </main>
      {searchOpen && (
        <GlobalSearch
          data={data}
          onClose={() => setSearchOpen(false)}
          openDay={(d) => {
            setCursor(d)
            setView('day')
            setPage('calendar')
          }}
          openShifts={(d) => {
            setCursor(d)
            setPage('shifts')
          }}
          openTasks={() => setPage('tasks')}
        />
      )}
    </div>
  )
}

function NavItem({ icon, label, active, onClick, badge }: { icon: ReactNode; label: string; active: boolean; onClick: () => void; badge?: number }) {
  return (
    <button className={`nav-item${active ? ' is-active' : ''}`} onClick={onClick} aria-current={active ? 'page' : undefined}>
      <span className="nav-icon" aria-hidden>
        {icon}
      </span>
      <span className="nav-label">{label}</span>
      {badge ? (
        <span className="nav-badge" aria-label={`${badge} para hoje ou atrasadas`}>
          {badge}
        </span>
      ) : null}
    </button>
  )
}
