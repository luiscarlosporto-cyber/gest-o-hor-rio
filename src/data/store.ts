import { DEFAULT_SHIFT_TYPES } from '../domain/shifts'
import type { AppData } from '../domain/types'

/**
 * Onde os dados vivem. Hoje: o browser (localStorage). Quando o projeto Supabase
 * existir, um SupabaseStore implementa a mesma interface (ver supabase/migrations).
 */
export interface DataStore {
  readonly kind: 'local' | 'supabase'
  load(): Promise<AppData>
  save(data: AppData): Promise<void>
}

export const emptyData = (): AppData => ({
  version: 1,
  events: [],
  shiftDays: [],
  shiftTypes: DEFAULT_SHIFT_TYPES,
})

const KEY = 'gestao-horario:v1'

export class LocalStore implements DataStore {
  readonly kind = 'local' as const
  private storage: Storage
  constructor(storage: Storage = window.localStorage) {
    this.storage = storage
  }

  async load(): Promise<AppData> {
    try {
      const raw = this.storage.getItem(KEY)
      if (!raw) return emptyData()
      const parsed = JSON.parse(raw) as Partial<AppData>
      return {
        ...emptyData(),
        ...parsed,
        shiftTypes: parsed.shiftTypes?.length ? parsed.shiftTypes : DEFAULT_SHIFT_TYPES,
        version: 1,
      }
    } catch {
      return emptyData()
    }
  }

  async save(data: AppData): Promise<void> {
    this.storage.setItem(KEY, JSON.stringify(data))
  }
}

/** Exportar e importar (cópia de segurança enquanto os dados vivem no browser). */
export function exportJson(data: AppData): string {
  return JSON.stringify(data, null, 2)
}

export function importJson(text: string): AppData {
  const parsed = JSON.parse(text) as Partial<AppData>
  if (!Array.isArray(parsed.events) || !Array.isArray(parsed.shiftDays)) {
    throw new Error('Ficheiro inválido: faltam eventos ou turnos.')
  }
  return { ...emptyData(), ...parsed, version: 1 }
}
