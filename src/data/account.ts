// RGPD e fiabilidade: exportar todos os dados, cópias diárias, histórico e apagar a conta.

import type { AppData } from '../domain/types'
import { supabase } from './supabase'
import { rowsToAppData, type DataRows } from './supabaseStore'

const db = () => {
  if (!supabase) throw new Error('Sem conta.')
  return supabase
}

async function rows<T>(p: PromiseLike<{ data: T | null; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await p
  if (error) throw new Error(error.message)
  return data as T
}

/** Tudo o que a conta guarda, tal como está nas tabelas (sem tokens nem chaves). */
export async function exportEverything(): Promise<Record<string, unknown>> {
  const c = db()
  const [profile, events, shift_days, shift_types, tasks, payslips, suggestions, reminders, devices, google, audit_log, backups] = await Promise.all([
    rows(c.from('profiles').select('*').maybeSingle()),
    rows(c.from('events').select('*').is('deleted_at', null)),
    rows(c.from('shift_days').select('day, code, extra, updated_at').is('deleted_at', null).order('day')),
    rows(c.from('shift_types').select('*').order('sort_order')),
    rows(c.from('tasks').select('*')),
    rows(c.from('payslips').select('year, month, data')),
    rows(c.from('suggestions').select('*')),
    rows(c.from('reminders').select('key, fire_at, title, body, sent_at')),
    rows(c.from('push_subscriptions').select('user_agent, created_at')),
    rows(c.from('google_status').select('google_email, last_synced_at, last_error, connected_at').maybeSingle()),
    rows(c.from('audit_log').select('created_at, actor, action, entity, entity_id, detail').order('created_at', { ascending: false })),
    rows(c.from('backups').select('day, created_at').order('day', { ascending: false })),
  ])
  return { exported_at: new Date().toISOString(), profile, events, shift_days, shift_types, tasks, payslips, suggestions, reminders, devices, google, audit_log, backups }
}

const csvCell = (v: unknown) => {
  const s = v == null ? '' : String(v)
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** Agenda numa folha de cálculo: uma linha por compromisso, turno ou tarefa (separador ";", como o Excel em português). */
export function agendaCsv(data: AppData): string {
  const lines: unknown[][] = [['tipo', 'data', 'início', 'fim', 'título', 'categoria/código', 'local', 'notas', 'repetição', 'estado']]
  for (const d of [...data.shiftDays].sort((a, b) => a.date.localeCompare(b.date))) {
    const t = data.shiftTypes.find((x) => x.code === d.code)
    lines.push(['turno', d.date, t?.start ?? '', t?.end ?? '', t?.label ?? d.code, d.code, '', d.extra ? 'extra' : '', '', ''])
  }
  for (const e of [...data.events].sort((a, b) => a.start.localeCompare(b.start))) {
    lines.push(['compromisso', e.start.slice(0, 10), e.allDay ? '' : e.start.slice(11, 16), e.allDay ? '' : e.end.slice(11, 16), e.title, e.category, e.location, e.notes, e.rrule, ''])
  }
  for (const t of data.tasks) lines.push(['tarefa', t.due ?? '', t.dueTime ?? '', '', t.title, t.priority, '', t.notes, '', t.done ? 'feita' : 'por fazer'])
  return '﻿' + lines.map((l) => l.map(csvCell).join(';')).join('\r\n')
}

export interface BackupInfo {
  day: string
  created_at: string
}

export const listBackups = () => rows<BackupInfo[]>(db().from('backups').select('day, created_at').order('day', { ascending: false }))

export async function loadBackup(day: string): Promise<AppData> {
  const r = await rows<{ data: DataRows } | null>(db().from('backups').select('data').eq('day', day).maybeSingle())
  if (!r) throw new Error('Cópia não encontrada.')
  return rowsToAppData(r.data)
}

export interface AuditEntry {
  created_at: string
  actor: 'user' | 'sync' | 'ai'
  action: string
  entity: string
  detail: Record<string, unknown> | null
}

export const listAudit = (limit = 60) =>
  rows<AuditEntry[]>(db().from('audit_log').select('created_at, actor, action, entity, detail').order('created_at', { ascending: false }).limit(limit))

export async function deleteAccount(confirm: string): Promise<void> {
  const c = db()
  const { data, error } = await c.functions.invoke<{ ok?: boolean; error?: string }>('account', { body: { action: 'delete', confirm } })
  if (error || !data?.ok) {
    const ctx = (error as { context?: Response } | null)?.context
    const msg = data?.error ?? (ctx ? await ctx.json().then((j: { error?: string }) => j.error).catch(() => undefined) : undefined)
    throw new Error(msg ?? error?.message ?? 'Não foi possível apagar a conta.')
  }
  await c.auth.signOut()
}
