// Fala com o assistente no servidor. A chave da Anthropic fica no Supabase, nunca na app.

import type { AssistantTurn, Proposal } from '../domain/assistant'
import { supabase } from './supabase'

export interface AssistantAnswer {
  reply: string
  proposals: Proposal[]
}

async function call<T>(body: object): Promise<T> {
  if (!supabase) throw new Error('O assistente precisa de uma conta. Entra em Definições.')
  const { data, error } = await supabase.functions.invoke<T & { error?: string }>('assistant', { body })
  if (data && 'error' in data && data.error) throw new Error(data.error)
  if (error) {
    // Respostas 4xx/5xx trazem a mensagem no corpo.
    const ctx = (error as { context?: Response }).context
    const msg = ctx ? await ctx.json().then((j: { error?: string }) => j.error).catch(() => undefined) : undefined
    throw new Error(msg ?? error.message)
  }
  if (!data) throw new Error('Sem resposta do assistente.')
  return data
}

export const assistantReady = () => call<{ ready: boolean }>({ action: 'status' }).then((r) => r.ready)

export const askAssistant = (messages: AssistantTurn[], context: string) => call<AssistantAnswer>({ messages, context })

export const logDecision = (kind: Proposal['kind'], title: string, decision: 'accepted' | 'dismissed') =>
  call<{ ok: boolean }>({ action: 'decision', kind, title, decision }).catch(() => undefined)
