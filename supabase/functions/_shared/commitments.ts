// Deteção de compromissos em emails (assunto + excerto), em português.
// Puro e sem rede: testado com vitest e usado pela Edge Function.
// Só SUGERE: nada é criado sem o utilizador aceitar.

export interface MailInput {
  id: string
  subject: string
  snippet: string
  from: string
  /** Data de receção (ISO). Serve de referência para "amanhã", "sexta"… */
  received: string
}

export interface Suggestion {
  gmail_id: string
  kind: 'event' | 'task'
  title: string
  date: string | null // YYYY-MM-DD
  time: string | null // HH:mm
  sender: string
  subject: string
  snippet: string
}

const MONTHS: Record<string, number> = {
  janeiro: 1, fevereiro: 2, março: 3, marco: 3, abril: 4, maio: 5, junho: 6,
  julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12,
  jan: 1, fev: 2, mar: 3, abr: 4, mai: 5, jun: 6, jul: 7, ago: 8, set: 9, out: 10, nov: 11, dez: 12,
}

const WEEKDAYS: Record<string, number> = {
  domingo: 0, segunda: 1, terça: 2, terca: 2, quarta: 3, quinta: 4, sexta: 5, sábado: 6, sabado: 6,
}

const EVENT_WORDS =
  /(?<![a-zà-ÿ])(reuni[ãa]o|consulta|marca[çc][ãa]o|entrevista|forma[çc][ãa]o|webinar|encontro|jantar|almo[çc]o|exame|audi[êe]ncia|convocat[óo]ria|sess[ãa]o|confer[êe]ncia|workshop|evento|visita|cerim[óo]nia|aula|teams|zoom|meet)(?![a-zà-ÿ])/i
const TASK_WORDS =
  /(?<![a-zà-ÿ])(prazo|at[ée] (?:ao )?dia|at[ée] [àa]s|entregar|enviar|submeter|responder|pagar|pagamento|renovar|renova[çc][ãa]o|validade|expira|data limite|deadline|confirmar|preencher|assinar)(?![a-zà-ÿ])/i
const NOISE =
  /(?<![a-zà-ÿ])(newsletter|promo[çc][ãa]o|desconto|unsubscribe|cancelar subscri[çc][ãa]o|oferta|campanha|black friday|cup[ãa]o|webinar gratuito)(?![a-zà-ÿ])/i

const pad = (n: number) => String(n).padStart(2, '0')
const key = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`

function lisbonDay(iso: string): Date {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Lisbon', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso))
  const [y, m, d] = parts.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}

const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 864e5)

function validDate(y: number, m: number, d: number): Date | null {
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? dt : null
}

/** Encontra a primeira data no texto, relativa ao dia de receção. */
export function findDate(text: string, received: string): string | null {
  const base = lisbonDay(received)
  const year = base.getUTCFullYear()
  const t = ` ${text.toLowerCase()} `

  // 25 de novembro (de 2026)
  let m = t.match(/\b(\d{1,2})\s+de\s+([a-zç]+)(?:\s+de\s+(\d{4}))?/)
  if (m && MONTHS[m[2]]) {
    let d = validDate(m[3] ? Number(m[3]) : year, MONTHS[m[2]], Number(m[1]))
    if (d && !m[3] && d < addDays(base, -7)) d = validDate(year + 1, MONTHS[m[2]], Number(m[1]))
    if (d) return key(d)
  }
  // 25/11 ou 25/11/2026 ou 25-11-2026
  m = t.match(/\b(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?\b/)
  if (m) {
    let y = m[3] ? Number(m[3]) : year
    if (y < 100) y += 2000
    let d = validDate(y, Number(m[2]), Number(m[1]))
    if (d && !m[3] && d < addDays(base, -7)) d = validDate(year + 1, Number(m[2]), Number(m[1]))
    if (d) return key(d)
  }
  if (/\bdepois de amanh[ãa](?![a-zà-ÿ])/.test(t)) return key(addDays(base, 2))
  if (/\bamanh[ãa](?![a-zà-ÿ])/.test(t)) return key(addDays(base, 1))
  if (/\bhoje\b/.test(t)) return key(base)
  m = t.match(/\b(?:próxim[ao]\s+|proxim[ao]\s+|na\s+|no\s+|esta\s+|este\s+)?(domingo|segunda|ter[çc]a|quarta|quinta|sexta|s[áa]bado)(?:-feira)?(?![a-zà-ÿ])/)
  if (m) {
    const w = WEEKDAYS[m[1]]
    const diff = (w - base.getUTCDay() + 7) % 7 || 7
    return key(addDays(base, diff))
  }
  return null
}

/** Encontra a primeira hora no texto: 14h, 14h30, 14:30, às 9. */
export function findTime(text: string): string | null {
  const t = ` ${text.toLowerCase()} `
  const m = t.match(/\b(\d{1,2})(?:h(\d{2})?|:(\d{2}))(?![\d/])/) ?? t.match(/(?<![a-zà-ÿ])[àa]s\s+(\d{1,2})\b(?![:/\d])/)
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2] ?? m[3] ?? 0)
  if (h > 23 || min > 59) return null
  return `${pad(h)}:${pad(min)}`
}

const cleanSubject = (s: string) =>
  s
    .replace(/^\s*((re|fw|fwd|enc|res)\s*:\s*)+/i, '')
    .replace(/\s+/g, ' ')
    .trim()

const senderName = (from: string) => {
  const m = from.match(/^\s*"?([^"<]+?)"?\s*<[^>]+>\s*$/)
  return (m ? m[1] : from).trim()
}

/** Decide se um email tem um compromisso e devolve a sugestão, ou null. */
export function detectCommitment(mail: MailInput): Suggestion | null {
  const subject = cleanSubject(mail.subject)
  const text = `${subject}. ${mail.snippet}`
  if (NOISE.test(text)) return null
  const isEvent = EVENT_WORDS.test(text)
  const isTask = TASK_WORDS.test(text)
  if (!isEvent && !isTask) return null
  const date = findDate(text, mail.received)
  const time = findTime(text)
  // Sem data não há compromisso concreto a sugerir; datas já passadas também não interessam.
  if (!date || date < key(lisbonDay(mail.received))) return null
  const kind: Suggestion['kind'] = isEvent && time ? 'event' : 'task'
  return {
    gmail_id: mail.id,
    kind,
    title: (subject || mail.snippet.slice(0, 80)).slice(0, 200),
    date,
    time,
    sender: senderName(mail.from).slice(0, 200),
    subject: mail.subject.slice(0, 300),
    snippet: mail.snippet.slice(0, 500),
  }
}
