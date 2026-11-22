# Gestão Horário

App para gerir horários, turnos e compromissos num só sítio. Esta é a **fase 1** do plano: o núcleo de horários, a funcionar na web.

## O que já faz

- **Turnos**: carregar o mês colando a linha do horário (PDF SISQUAL), com pré-visualização antes de gravar; editar dia a dia; tipos de turno configuráveis (MT2, M, N, D, DS, DC, F, Fe, L por omissão); resumo do mês com dias e horas de trabalho. A noite (N) fica no dia em que começa e acaba no dia seguinte.
- **Eventos**: criar, editar e apagar; dia inteiro; categorias (trabalho, reunião, pessoal, pausa, bloqueio); local e notas.
- **Recorrência**: diária, semanal (escolhendo os dias), mensal e anual, com data de fim. Editar ou apagar **só uma ocorrência** ou **toda a série** (mesmo modelo do Google Calendar, para a sincronização da fase 2).
- **Conflitos**: deteção automática de sobreposições (incluindo com turnos), aviso no editor antes de gravar e marcação nas vistas. Pausas, dias inteiros e dias de descanso não contam.
- **Vistas** diária (com horários livres e agenda), semanal e mensal; pesquisa sem acentos; filtros por categoria.
- Modo claro e escuro, layout para telemóvel, atalhos de teclado, desfazer (Ctrl+Z), exportar e importar cópia de segurança.

Os dados ficam, para já, guardados no browser. O esquema da base de dados Supabase (com RLS por utilizador) está em `supabase/migrations` e é ligado quando o projeto Supabase existir.

## Correr localmente

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # testes automáticos
npm run build    # versão de produção em dist/
```

## Estrutura

```
src/
  domain/     regras do negócio, sem interface (datas, recorrência, turnos, conflitos, operações) + testes
  data/       onde os dados vivem (LocalStore hoje; SupabaseStore na fase 2)
  state/      estado da app com gravação automática e desfazer
  ui/         vistas, editor, página de turnos, definições + testes de interface
supabase/
  migrations/ esquema da base de dados com RLS
```

## Decisões técnicas

- **Hora local flutuante** (`2026-11-23T08:30`, fuso Europe/Lisbon): um turno das 08:30 é sempre às 08:30, mesmo na mudança de hora.
- **Recorrência RFC 5545** (`rrule`), o formato do Google Calendar, para a sincronização bidirecional não precisar de conversões.
- **Exceções como no Google**: editar uma ocorrência exclui a data da série (`exdates`) e cria um evento ligado (`recurringEventId`).
- **React + TypeScript + Vite**: o mesmo código serve a web (PWA), Android (Capacitor) e Windows (Tauri) nas fases seguintes.
