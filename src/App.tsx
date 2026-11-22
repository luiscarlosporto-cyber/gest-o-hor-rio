import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { LocalStore, type DataStore } from './data/store'
import { useAppData } from './state/useAppData'
import { CalendarPage, type View } from './ui/CalendarPage'
import { SettingsPage, type Theme } from './ui/SettingsPage'
import { ShiftsPage } from './ui/ShiftsPage'
import { IconCalendar, IconSettings, IconShifts } from './ui/icons'

type Page = 'calendar' | 'shifts' | 'settings'

const readPref = <T extends string>(key: string, fallback: T): T => {
  try {
    return (localStorage.getItem(key) as T) || fallback
  } catch {
    return fallback
  }
}

export default function App({ store: injected }: { store?: DataStore }) {
  const store = useMemo(() => injected ?? new LocalStore(), [injected])
  const { data, loaded, error, update, undo } = useAppData(store)
  const [page, setPage] = useState<Page>('calendar')
  const [view, setView] = useState<View>(() => readPref<View>('gh:view', 'week'))
  const [cursor, setCursor] = useState(() => new Date())
  const [theme, setTheme] = useState<Theme>(() => readPref<Theme>('gh:theme', 'system'))

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
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !['INPUT', 'TEXTAREA'].includes(t.tagName)) {
        e.preventDefault()
        undo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo])

  if (!loaded) return <div className="splash">A carregar…</div>

  return (
    <div className="app">
      <nav className="sidebar" aria-label="Navegação">
        <div className="brand">
          <span className="brand-mark" aria-hidden>
            <IconShifts />
          </span>
          <span>Gestão Horário</span>
        </div>
        <NavItem icon={<IconCalendar />} label="Calendário" active={page === 'calendar'} onClick={() => setPage('calendar')} />
        <NavItem icon={<IconShifts />} label="Turnos" active={page === 'shifts'} onClick={() => setPage('shifts')} />
        <NavItem icon={<IconSettings />} label="Definições" active={page === 'settings'} onClick={() => setPage('settings')} />
        <div className="sidebar-foot muted small">{store.kind === 'local' ? 'Dados neste browser' : 'Sincronizado'}</div>
      </nav>
      <main className="main">
        {error && (
          <div className="error banner" role="alert">
            {error}
          </div>
        )}
        {page === 'calendar' && <CalendarPage data={data} update={update} cursor={cursor} setCursor={setCursor} view={view} setView={setView} />}
        {page === 'shifts' && <ShiftsPage data={data} update={update} cursor={cursor} setCursor={setCursor} />}
        {page === 'settings' && <SettingsPage data={data} store={store} theme={theme} setTheme={setTheme} update={update} />}
      </main>
    </div>
  )
}

function NavItem({ icon, label, active, onClick }: { icon: ReactNode; label: string; active: boolean; onClick: () => void }) {
  return (
    <button className={`nav-item${active ? ' is-active' : ''}`} onClick={onClick} aria-current={active ? 'page' : undefined}>
      <span className="nav-icon" aria-hidden>
        {icon}
      </span>
      <span className="nav-label">{label}</span>
    </button>
  )
}
