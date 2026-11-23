# Ritmia · Gestão Horário

App pessoal para gerir turnos de enfermagem (UCIP), compromissos e tarefas num só sítio, com sincronização com o Google Calendar, lembretes no telemóvel, conferência do vencimento e um assistente IA que propõe mas nunca age sozinho.

Estado a 23/11/2026: as 5 fases do plano de otimização estão feitas. Funciona como site (PWA) e como app Android.

---

## 1. Onde está cada coisa

| O quê | Onde |
|---|---|
| Código | GitHub `luiscarlosporto-cyber/gest-o-hor-rio` (repositório **público**) |
| Site (app web) | https://luiscarlosporto-cyber.github.io/gest-o-hor-rio/ |
| App Android (APK) | https://github.com/luiscarlosporto-cyber/gest-o-hor-rio/releases/tag/android |
| Base de dados e servidor | Supabase, projeto `gestao-horario` (id `solpuulailtlewntgwjm`, região eu-west-1, plano gratuito) |
| Google Cloud | projeto `gestao-horario` (OAuth, Calendar API, Gmail API) |
| Plano de otimização | https://claude.ai/artifact/4b6PF9p8H9aKdN5p3tnC1c |

Regra fixa: este projeto **nunca** se mistura com o MyStationBox (projeto Supabase `cttxkrqduclhaqmaxyls`).

---

## 2. O que a app faz

### Turnos
- Carregar o mês a partir do **PDF do SISQUAL** (inicial ou final), lido só no aparelho. A app procura a linha pelo número mecanográfico. Os turnos a verde ficam marcados como **extra**.
- Em alternativa, colar a linha do horário, com pré-visualização antes de gravar.
- Tipos de turno configuráveis. Os predefinidos:

| Código | Significado | Horas |
|---|---|---|
| M | Manhã | 08:30–15:30 |
| T | Tarde | 15:00–22:30 |
| 6:30 T | Tarde curta | 15:30–22:30 |
| MT / MT2 | Manhã e tarde | 08:30–22:30 |
| N | Noite | 22:00–09:00 (conta 9 h) |
| D | Saída da noite | vem sempre depois de uma N; um D sem N antes é erro |
| DS, DC, F | Descanso semanal, descanso complementar, folga | dia inteiro |
| Fe, L | Feriado, férias | dia inteiro |

- O horário **final** do SISQUAL prevalece sobre o inicial, também no Google Calendar.
- Resumo do mês com dias e horas de trabalho, e aviso de erros (por exemplo, um D sem N antes).

### Agenda
- Vistas de dia, semana e mês. Compromissos com categoria, local, notas e repetição (diária, semanal, mensal, anual), editando só uma ocorrência ou a série toda.
- Deteção de conflitos com turnos e outros compromissos, e intervalos livres.
- **Pesquisa global** (Ctrl+K ou "/") em compromissos, turnos e tarefas, sem acentos.

### Tarefas
- Escrita rápida ("Ligar à Ana amanhã 14h !" fica com data, hora e prioridade alta).
- Sugestões a partir do **Gmail** (só leitura). A app propõe e o utilizador aceita ou ignora.

### Google Calendar
- Sincronização nos dois sentidos. Os turnos aparecem no Google como eventos de dia inteiro com o código (M, N, D…).
- O Google avisa a app quando há mudanças (canal "watch"), e o servidor sincroniza sozinho de 6 em 6 horas e renova esse canal.

### Lembretes e notificações
- Avisos antes de cada turno e compromisso, tarefas a vencer e resumo do dia (por omissão às 07:00).
- No site: Web Push enviado pelo servidor de minuto a minuto, mesmo com a app fechada.
- Na app Android: notificações do próprio telemóvel, agendadas para 14 dias, que funcionam sem rede.

### Vencimento
- Projeção do salário do mês: base (tabela TRU 2026, categoria e posição), trabalho noturno (20h–7h, confirmado com um talão), sábados à tarde, domingos e feriados (nacionais e o municipal de Penafiel, 11/11), prémio de 14,28 % da base pago em 11 meses (não em junho), subsídio de refeição e descontos (SS/CGA, ADSE, IRS).
- O talão do mês M paga o trabalho do mês M-1.
- **Conferir o talão**: carrega-se o PDF do talão e a app compara as horas pagas com as do horário. Guarda só rubricas, horas e valores, **nunca** nome, NIF, IBAN, n.º de beneficiário nem n.º de apólice.

### Assistente IA (desligado)
- Desligado a 23/11/2026 por decisão do utilizador (a API da Anthropic é paga). O código fica no repositório e liga-se mudando `ASSISTANT_ENABLED` em `src/App.tsx` e guardando a chave `ANTHROPIC_API_KEY` na Supabase.
- Perguntas em português sobre a agenda: "quando tenho tempo livre esta semana?", "marca dentista na próxima folga às 10h".
- Responde com base em 3 semanas de turnos, compromissos e tarefas. Cada proposta aparece num cartão com "Adicionar" ou "Ignorar". **Nada é gravado sem confirmação.**
- Não recebe vencimento, talões nem emails. Pede consentimento na primeira utilização.
- Usa o modelo Claude da Anthropic no servidor, com limite de 60 perguntas por 24 horas.

### Os meus dados (RGPD)
- Descarregar tudo (JSON) e a agenda num ficheiro que abre no Excel (CSV com ";").
- Cópias de segurança diárias às 03:15, guardadas 14 dias, que se podem descarregar ou repor.
- Histórico de alterações: quem mudou o quê e quando (tu, a sincronização com o Google ou o assistente). Fica guardado 1 ano.
- Apagar a conta: apaga todos os dados e retira o acesso ao Google. Pede para escrever APAGAR.

---

## 3. Como está montada

### Tecnologia
- **Frontend:** React 19, TypeScript, Vite 8. Os ecrãs carregam só quando se abrem. É uma PWA, com service worker que a deixa abrir sem rede e um aviso de versão nova.
- **Android:** Capacitor 8 (`pt.gestaohorario.app`), a mesma app web construída com `vite build --mode android`.
- **Servidor:** Supabase (Postgres com RLS por utilizador, Auth com Google, Edge Functions em Deno, pg_cron, pg_net, Vault).
- **Testes:** vitest (105 testes) e Playwright (teste de ponta a ponta no telemóvel e no computador antes de cada publicação).

### Pastas
```
src/
  domain/   regras do negócio sem interface: datas, turnos, SISQUAL, conflitos,
            recorrência, tarefas, vencimento, talão, lembretes, pesquisa, assistente
  data/     Supabase, armazenamento local, leitura de PDFs, notificações, conta
  state/    estado da app, gravação automática, desfazer
  ui/       ecrãs (Início, Agenda, Tarefas, IA, Turnos, Resumo, Ajustes)
  native.ts só na app Android: login, notificações locais
supabase/
  migrations/  esquema da base de dados (11 migrações)
  functions/   Edge Functions
android/       projeto Android (Capacitor)
e2e/           teste de ponta a ponta (Playwright)
.github/workflows/  publicar o site (pages.yml) e criar o APK (android.yml)
```

### Base de dados (tabelas principais)
`profiles` (definições do vencimento e dos lembretes), `shift_types`, `shift_days`, `events`, `tasks`, `payslips`, `suggestions` (Gmail), `google_accounts`, `push_subscriptions`, `reminders`, `backups` e `audit_log`. Todas têm RLS ("cada um só vê o que é seu") e apagam em cascata quando a conta é apagada.

### Edge Functions
| Função | Para quê |
|---|---|
| `google` | ligar, sincronizar e desligar o Google; ler o Gmail |
| `google-webhook` | recebe os avisos de mudança do Google Calendar |
| `push` | envia as notificações (cron de minuto a minuto) e mantém a sincronização (de 6 em 6 horas) |
| `assistant` | assistente IA |
| `account` | apagar a conta |

### Tarefas automáticas (pg_cron)
| Nome | Quando | O quê |
|---|---|---|
| `enviar-lembretes` | a cada minuto | envia os avisos que estão na hora |
| `manter-google` | de 6 em 6 horas | sincroniza com o Google e renova o canal |
| `copias-diarias` | 03:15 UTC | cópia de segurança de cada conta |
| `limpar-registo` | 03:30 UTC | apaga o histórico com mais de 1 ano |

### Segredos (nunca no código)
- **Vault do Supabase:** refresh token do Google de cada conta, chaves VAPID das notificações e o segredo do cron.
- **Segredos das Edge Functions:** `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` e, quando existir, `ANTHROPIC_API_KEY`.
- No código só há valores públicos: o URL do Supabase, a chave publicável e a chave pública VAPID.

---

## 4. Como trabalhar no projeto

```bash
npm install
npm run dev            # http://localhost:5173
npx vitest run         # testes
npm run build          # site em dist/
npm run e2e            # teste de ponta a ponta (depois do build)
npx vite build --mode android && npx cap sync android   # app Android
```

- **Publicar o site:** cada envio para `main` corre testes, build e teste de ponta a ponta, e publica no GitHub Pages.
- **Publicar a app Android:** cada envio para `main` cria um APK novo no release "android".
- **Alterar a base de dados:** criar um ficheiro em `supabase/migrations/` e correr o SQL no SQL Editor do Supabase.

---

## 5. O que falta ou está pendente

1. **Atualizações da app Android:** cada APK novo vem assinado com uma chave de teste diferente, por isso é preciso desinstalar antes de instalar a versão nova. Para instalar por cima, falta guardar uma chave de assinatura nos segredos do GitHub (`ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`).
2. **Vencimento:** faltam turnos de junho (6, 9, 11, 16, 20, 24 e 29) para afinar a comparação com o talão de julho, e o trabalho suplementar precisa das horas contratadas.
3. **Para vender** (decidido não avançar por agora): várias contas, pagamentos (Stripe), termos, Supabase pago, repositório privado (o Pages privado exige GitHub pago) e a revisão de segurança da Google ao acesso ao Gmail.

---

## 6. Regras de privacidade do projeto

- Nunca pôr credenciais nem segredos no código, e nunca os pedir no chat.
- O repositório é público: sem PDFs reais nem dados pessoais nos testes.
- Talões: só rubricas, horas e valores.
- Nada é enviado nem alterado em nome do utilizador sem confirmação. O Gmail é só de leitura.
- RGPD: exportar e apagar os dados estão sempre disponíveis na app.
