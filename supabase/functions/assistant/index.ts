// Assistente IA: lê a pergunta e a agenda que a app envia, responde e PROPÕE ações.
// Nunca altera dados: as propostas só passam a existir quando o utilizador as confirma na app.
// A chave da Anthropic está nos segredos das Edge Functions (ANTHROPIC_API_KEY), nunca no código.
import Anthropic from 'npm:@anthropic-ai/sdk@1.12.0'
import { createClient } from 'npm:@supabase/supabase-js@2'
import { cors, json } from '../_shared/cors.ts'

const MODEL = 'claude-opus-5-5'
const DAILY_LIMIT = 60
const MAX_TURNS = 12
const MAX_CHARS = 4000
const MAX_CONTEXT = 24000

const admin = () => createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })

interface Turn {
  role: 'user' | 'assistant'
  content: string
}

const SYSTEM = `És o assistente da app "Gestão Horário" de um enfermeiro da UCIP que trabalha por turnos. Respondes sempre em português de Portugal, de forma curta e clara.

Recebes a data de hoje, os turnos, os compromissos e as tarefas das próximas semanas, e os intervalos livres. Usa só esses dados: se algo não está lá, diz que não sabes.

Turnos: M 8:30–15:30, T 15:00–22:30, MT 8:30–22:30, N começa às 22:00 e o trabalho continua no dia seguinte (D, saída da noite, até às 9:00). Depois de uma N ou de um D não proponhas nada antes das 13:00 desse dia sem avisar. L = férias, Fe = feriado, folga = livre.

Podes propor criar compromissos ("event") ou tarefas ("task"). Não podes criar, mudar nem apagar nada sozinho, nem enviar emails ou mensagens: o utilizador vê cada proposta e decide se a aceita. Diz isso quando fizer sentido. Antes de propor um compromisso, confirma que não colide com um turno ou outro compromisso; se colidir, diz qual e sugere outra hora livre.

Formato: datas YYYY-MM-DD e horas HH:mm (hora de Lisboa). Num compromisso de dia inteiro, start e end são datas YYYY-MM-DD (end = último dia). Campos que não se aplicam ficam null. Se o pedido for só uma pergunta, proposals fica vazio.`

const nullable = () => ({ type: ['string', 'null'] })
const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['reply', 'proposals'],
  properties: {
    reply: { type: 'string', description: 'Resposta ao utilizador, em português de Portugal.' },
    proposals: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'title', 'start', 'end', 'allDay', 'category', 'location', 'due', 'dueTime', 'priority', 'notes', 'why'],
        properties: {
          kind: { type: 'string', enum: ['event', 'task'] },
          title: { type: 'string' },
          start: { ...nullable(), description: 'Só event: YYYY-MM-DDTHH:mm, ou YYYY-MM-DD se allDay.' },
          end: { ...nullable(), description: 'Só event: YYYY-MM-DDTHH:mm, ou YYYY-MM-DD se allDay.' },
          allDay: { type: ['boolean', 'null'] },
          category: { type: ['string', 'null'], enum: ['trabalho', 'reuniao', 'pessoal', 'pausa', 'bloqueio', null] },
          location: nullable(),
          due: { ...nullable(), description: 'Só task: YYYY-MM-DD.' },
          dueTime: { ...nullable(), description: 'Só task: HH:mm.' },
          priority: { type: ['string', 'null'], enum: ['alta', 'normal', 'baixa', null] },
          notes: nullable(),
          why: { type: 'string', description: 'Uma frase curta: porquê esta proposta.' },
        },
      },
    },
  },
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Método não suportado' }, 405)
  const db = admin()
  const jwt = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? ''
  const { data: auth, error: authErr } = await db.auth.getUser(jwt)
  if (authErr || !auth.user) return json({ error: 'Sessão inválida' }, 401)
  const userId = auth.user.id

  let body: { action?: string; messages?: Turn[]; context?: string; kind?: string; title?: string; decision?: string }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Pedido inválido' }, 400)
  }

  if (body.action === 'status') return json({ ready: Boolean(Deno.env.get('ANTHROPIC_API_KEY')) })

  // Regista no histórico o que o utilizador fez a uma proposta (aceitou ou ignorou).
  if (body.action === 'decision') {
    const kind = body.kind === 'task' ? 'task' : 'event'
    const decision = body.decision === 'accepted' ? 'accepted' : 'dismissed'
    await db.from('audit_log').insert({
      user_id: userId,
      actor: 'ai',
      action: decision === 'accepted' ? 'assistant_accept' : 'assistant_dismiss',
      entity: kind === 'task' ? 'tasks' : 'events',
      detail: { title: String(body.title ?? '').slice(0, 200) },
    })
    return json({ ok: true })
  }

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) return json({ error: 'O assistente ainda não está ligado: falta a chave da Anthropic no Supabase.', code: 'no_key' }, 503)
  const turns = (body.messages ?? [])
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-MAX_TURNS)
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_CHARS) }))
  while (turns.length && turns[0].role !== 'user') turns.shift()
  if (!turns.length || turns[turns.length - 1].role !== 'user') return json({ error: 'Falta a pergunta' }, 400)
  const context = String(body.context ?? '').slice(0, MAX_CONTEXT)

  // Limite diário por utilizador, para não haver custos inesperados.
  const since = new Date(Date.now() - 86_400_000).toISOString()
  const { count } = await db.from('audit_log').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('action', 'assistant_ask').gte('created_at', since)
  if ((count ?? 0) >= DAILY_LIMIT) return json({ error: `Chegaste ao limite de ${DAILY_LIMIT} perguntas em 24 horas. Tenta mais tarde.` }, 429)

  const client = new Anthropic({ apiKey })
  try {
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 8000,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
      system: [
        { type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } },
        { type: 'text', text: `Agenda (dados da app):\n${context}` },
      ],
      messages: turns,
    })
    if (res.stop_reason === 'refusal') return json({ reply: 'Não posso ajudar com esse pedido.', proposals: [] })
    if (res.stop_reason === 'max_tokens') return json({ error: 'A resposta ficou demasiado longa. Faz uma pergunta mais curta.' }, 502)
    const text = res.content.map((b) => (b.type === 'text' ? b.text : '')).join('')
    let out: { reply: string; proposals: unknown[] }
    try {
      out = JSON.parse(text)
    } catch {
      return json({ error: 'O assistente devolveu uma resposta inválida. Tenta outra vez.' }, 502)
    }
    // Só se regista a contagem e os tokens, nunca o texto da conversa.
    await db.from('audit_log').insert({
      user_id: userId,
      actor: 'ai',
      action: 'assistant_ask',
      entity: 'assistant',
      detail: { proposals: out.proposals?.length ?? 0, input_tokens: res.usage.input_tokens, output_tokens: res.usage.output_tokens },
    })
    return json({ reply: out.reply, proposals: out.proposals ?? [] })
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return json({ error: 'A chave da Anthropic não é válida. Confirma-a no Supabase.', code: 'bad_key' }, 503)
    if (e instanceof Anthropic.RateLimitError) return json({ error: 'O assistente está ocupado. Tenta daqui a um minuto.' }, 429)
    if (e instanceof Anthropic.APIError) return json({ error: `Erro do assistente (${e.status}).` }, 502)
    return json({ error: String(e) }, 500)
  }
})
