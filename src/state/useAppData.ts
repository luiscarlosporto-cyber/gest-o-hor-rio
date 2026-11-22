import { useCallback, useEffect, useRef, useState } from 'react'
import type { DataStore } from '../data/store'
import { emptyData } from '../data/store'
import type { AppData } from '../domain/types'

/** Estado da app com gravação automática no DataStore. */
export function useAppData(store: DataStore) {
  const [data, setData] = useState<AppData>(emptyData)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const history = useRef<AppData[]>([])

  useEffect(() => {
    let alive = true
    setLoaded(false)
    history.current = []
    store
      .load()
      .then((d) => alive && (setData(d), setLoaded(true)))
      .catch((e: unknown) => alive && (setError(String(e)), setLoaded(true)))
    return () => {
      alive = false
    }
  }, [store])

  const update = useCallback(
    (fn: (d: AppData) => AppData) => {
      setData((prev) => {
        const next = fn(prev)
        if (next === prev) return prev
        history.current = [...history.current.slice(-19), prev]
        store.save(next).catch((e: unknown) => setError(`Não foi possível gravar: ${String(e)}`))
        return next
      })
    },
    [store],
  )

  const undo = useCallback(() => {
    const prev = history.current.pop()
    if (!prev) return
    setData(prev)
    store.save(prev).catch((e: unknown) => setError(`Não foi possível gravar: ${String(e)}`))
  }, [store])

  /** Volta a ler do armazenamento (ex.: depois de sincronizar com o Google). */
  const reload = useCallback(async () => {
    try {
      setData(await store.load())
    } catch (e) {
      setError(String(e))
    }
  }, [store])

  return { data, loaded, error, update, undo, reload, canUndo: () => history.current.length > 0 }
}
