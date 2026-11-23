<script setup lang="ts">
/** Home: un riepilogo di ogni modulo con collegamenti diretti alle sue pagine. */
import { computed, onMounted } from 'vue'
import UiIcon from '@/core/ui/UiIcon.vue'
import type { IconName } from '@/core/ui/icons'
import { addDaysTo, fmtLongDay, fmtMonthYear, fmtShortDay, isoWeekday, relativeDays, todayDay, WEEKDAY_LETTERS } from '@/core/utils/dates'
import { formatMoney, formatPercent } from '@/core/utils/format'
import { useFinanceStore } from '@/modules/finance/store/financeStore'
import { computeAccountBalances, computeFlowSummary, computeNetWorth } from '@/modules/finance/domain'
import { useAgendaStore } from '@/modules/agenda/store/agendaStore'
import { useGoalsStore } from '@/modules/goals/store'
import { areaOf, goalProgress, nextMilestone } from '@/modules/goals/domain'
import { useHabitsStore } from '@/modules/habits/store'
import { isScheduled, streak } from '@/modules/habits/domain'
import { MOODS, useJournalStore } from '@/modules/journal/store'

const finance = useFinanceStore()
const agenda = useAgendaStore()
const goals = useGoalsStore()
const habits = useHabitsStore()
const journal = useJournalStore()

onMounted(() => void finance.init())

const today = computed(() => agenda.today)
const greeting = computed(() => {
  const h = new Date().getHours()
  return h < 5 ? 'Buonanotte' : h < 13 ? 'Buongiorno' : h < 18 ? 'Buon pomeriggio' : 'Buonasera'
})

interface QuickLink {
  label: string
  to: string | { name: string }
  icon: IconName
}

// ---- Finanze ----------------------------------------------------------------
const fin = computed(() => {
  const ds = finance.rawDataset ? finance.dataset : null
  if (!ds) return null
  const day = todayDay()
  const ops = ds.operations.filter((o) => o.date.startsWith(day.slice(0, 7)) && o.date <= day)
  const flow = computeFlowSummary(ds, ops)
  const worth = computeNetWorth(ds, computeAccountBalances(ds, { useMarketValue: true }))
  // Barra dei flussi: uscite del mese in proporzione alle entrate (o al totale uscite, se maggiore).
  const invested = Math.max(flow.invested, 0)
  const scale = Math.max(flow.income, flow.necessary + flow.additional + invested, 1)
  const pct = (v: number) => `${Math.max(0, (v / scale) * 100)}%`
  return {
    flow,
    worth,
    currency: ds.baseCurrency,
    demo: finance.source === 'demo',
    rate: flow.income > 0 ? flow.savings / flow.income : null,
    bar: [
      { key: 'necessary', label: 'Necessarie', value: flow.necessary, width: pct(flow.necessary), color: 'var(--flow-necessary)' },
      { key: 'additional', label: 'Aggiuntive', value: flow.additional, width: pct(flow.additional), color: 'var(--flow-additional)' },
      { key: 'invested', label: 'Investite', value: invested, width: pct(invested), color: 'var(--flow-investment)' },
    ],
  }
})
const financeLinks: QuickLink[] = [
  { label: 'Spese del mese', to: { name: 'finance-month' }, icon: 'calendar' },
  { label: 'Dashboard', to: { name: 'finance-dashboard' }, icon: 'dashboard' },
  { label: 'Movimenti', to: { name: 'finance-operations' }, icon: 'list' },
  { label: 'Investimenti', to: { name: 'finance-investments' }, icon: 'trend' },
]

// ---- Agenda -----------------------------------------------------------------
const todayOpen = computed(() => agenda.occurrences(today.value, today.value).filter((o) => o.status !== 'done'))
const agendaNext = computed(() => {
  const week = agenda.occurrences(addDaysTo(today.value, 1), addDaysTo(today.value, 14)).filter((o) => !o.projected && o.status !== 'done')
  return [...agenda.overdue, ...todayOpen.value, ...week].slice(0, 5)
})
const dayNum = (d: string) => Number(d.slice(8, 10))
const monthShort = (d: string) => new Intl.DateTimeFormat('it-IT', { month: 'short', timeZone: 'UTC' }).format(new Date(`${d}T00:00:00Z`))
const agendaLinks: QuickLink[] = [
  { label: 'Oggi', to: { name: 'agenda-today' }, icon: 'sun' },
  { label: 'Task', to: { name: 'agenda-tasks' }, icon: 'checkCircle' },
  { label: 'Calendario', to: { name: 'agenda-calendar' }, icon: 'calendar' },
  { label: 'Scadenze', to: { name: 'agenda-commitments' }, icon: 'bell' },
]

// ---- Obiettivi --------------------------------------------------------------
const activeGoals = computed(() => goals.goals.filter((g) => g.status === 'active'))
const doneGoals = computed(() => goals.goals.filter((g) => g.status === 'done').length)
const avgProgress = computed(() => (activeGoals.value.length ? activeGoals.value.reduce((s, g) => s + goalProgress(g), 0) / activeGoals.value.length : null))
const topGoals = computed(() =>
  [...activeGoals.value]
    .sort((a, b) => (a.targetDate ?? '9999').localeCompare(b.targetDate ?? '9999'))
    .slice(0, 3)
    .map((g) => ({ goal: g, area: areaOf(g.area), progress: goalProgress(g), next: nextMilestone(g) })),
)

// ---- Abitudini --------------------------------------------------------------
const todayHabits = computed(() => habits.habits.filter((h) => isScheduled(h, today.value)))
const habitsDone = computed(() => todayHabits.value.filter((h) => habits.isDone(h.id, today.value)).length)
const habitsRatio = computed(() => (todayHabits.value.length ? habitsDone.value / todayHabits.value.length : 0))
const RING = 2 * Math.PI * 34
const bestStreak = computed(() =>
  habits.habits.reduce<{ name: string; emoji: string; n: number } | null>((best, h) => {
    const n = streak(h, habits.doneSet(h.id), today.value)
    return n > (best?.n ?? 0) ? { name: h.name, emoji: h.emoji, n } : best
  }, null),
)

// ---- Diario -----------------------------------------------------------------
const todayEntry = computed(() => journal.get(today.value))
const journalWeek = computed(() =>
  Array.from({ length: 7 }, (_, i) => {
    const date = addDaysTo(today.value, i - 6)
    const entry = journal.get(date)
    const mood = MOODS.find((m) => m.value === entry?.mood) ?? null
    return { date, letter: WEEKDAY_LETTERS[isoWeekday(date) - 1], entry, mood, isToday: date === today.value }
  }),
)
const weekEntries = computed(() => journalWeek.value.filter((d) => d.entry).length)
const journalStreak = computed(() => {
  let n = 0
  let d = todayEntry.value ? today.value : addDaysTo(today.value, -1)
  while (journal.get(d)) {
    n++
    d = addDaysTo(d, -1)
  }
  return n
})
</script>

<template>
  <div class="home">
    <!-- Benvenuto + la giornata in sintesi -->
    <header class="hero">
      <div class="hero__text">
        <p class="hero__date">{{ fmtLongDay(today) }}</p>
        <h1>{{ greeting }}</h1>
      </div>
      <nav class="hero__pills" aria-label="La tua giornata">
        <RouterLink :to="{ name: 'agenda-today' }" class="pill">
          <UiIcon name="calendar" :size="16" />
          <span><strong class="num">{{ todayOpen.length }}</strong> {{ todayOpen.length === 1 ? 'impegno' : 'impegni' }} oggi</span>
          <span v-if="agenda.overdue.length" class="pill__warn">{{ agenda.overdue.length }} in ritardo</span>
        </RouterLink>
        <RouterLink to="/abitudini" class="pill">
          <UiIcon name="repeat" :size="16" />
          <span><strong class="num">{{ habitsDone }}/{{ todayHabits.length }}</strong> abitudini</span>
        </RouterLink>
        <RouterLink to="/diario" class="pill">
          <UiIcon :name="todayEntry ? 'checkCircle' : 'edit'" :size="16" />
          <span>{{ todayEntry ? 'Diario scritto' : 'Diario da scrivere' }}</span>
        </RouterLink>
      </nav>
    </header>

    <div class="bento">
      <!-- Finanze -->
      <section class="tile tile--fin" style="--mod: var(--series-8)" aria-labelledby="h-fin">
        <header class="tile__head">
          <span class="tile__icon" aria-hidden="true"><UiIcon name="wallet" /></span>
          <h2 id="h-fin">Finanze</h2>
          <RouterLink to="/finanze" class="tile__open" aria-label="Apri Finanze"><UiIcon name="arrowUpRight" :size="18" /></RouterLink>
        </header>

        <div v-if="fin" class="fin">
          <div class="fin__worth">
            <span class="eyebrow">Patrimonio netto</span>
            <span class="fin__big num">{{ formatMoney(fin.worth.netWorth, fin.currency) }}</span>
            <div class="fin__split">
              <span><i class="dot" style="background: var(--series-5)" />Liquidità <strong class="num">{{ formatMoney(fin.worth.liquidity, fin.currency) }}</strong></span>
              <span><i class="dot" style="background: var(--flow-investment)" />Investimenti <strong class="num">{{ formatMoney(fin.worth.investments, fin.currency) }}</strong></span>
            </div>
            <span v-if="fin.demo" class="tag">Dati dimostrativi</span>
          </div>

          <div class="fin__month">
            <div class="fin__month-head">
              <span class="eyebrow">{{ fmtMonthYear(today) }}</span>
              <span v-if="fin.rate !== null" class="tag" :class="fin.rate >= 0 ? 'tag--pos' : 'tag--neg'">Risparmio {{ formatPercent(fin.rate, 0) }}</span>
            </div>
            <dl class="flows">
              <div><dt><i class="dot" style="background: var(--flow-income)" />Entrate</dt><dd class="num">{{ formatMoney(fin.flow.income, fin.currency) }}</dd></div>
              <div><dt><i class="dot" style="background: var(--flow-necessary)" />Spese</dt><dd class="num">{{ formatMoney(fin.flow.expenses, fin.currency) }}</dd></div>
              <div><dt>Risparmio</dt><dd class="num" :class="fin.flow.savings >= 0 ? 'pos' : 'neg'">{{ formatMoney(fin.flow.savings, fin.currency, { sign: true }) }}</dd></div>
            </dl>
            <div class="flowbar" role="img" :aria-label="`Uscite del mese rispetto alle entrate`">
              <span v-for="s in fin.bar" :key="s.key" :style="{ width: s.width, background: s.color }" :title="`${s.label}: ${formatMoney(s.value, fin.currency)}`" />
            </div>
            <div class="legend">
              <span v-for="s in fin.bar" :key="s.key"><i class="dot" :style="{ background: s.color }" />{{ s.label }}</span>
            </div>
          </div>
        </div>
        <div v-else class="empty">
          <UiIcon :name="finance.syncing ? 'refresh' : 'sheet'" :class="{ spin: finance.syncing }" />
          {{ finance.syncing ? 'Caricamento dei dati dal foglio…' : 'Nessun dato finanziario sincronizzato.' }}
        </div>

        <nav class="links" aria-label="Pagine Finanze">
          <RouterLink v-for="l in financeLinks" :key="l.label" :to="l.to" class="link"><UiIcon :name="l.icon" :size="15" />{{ l.label }}</RouterLink>
        </nav>
      </section>

      <!-- Agenda -->
      <section class="tile tile--agenda" style="--mod: var(--series-4)" aria-labelledby="h-agenda">
        <header class="tile__head">
          <span class="tile__icon" aria-hidden="true"><UiIcon name="calendar" /></span>
          <h2 id="h-agenda">Agenda</h2>
          <RouterLink to="/agenda" class="tile__open" aria-label="Apri Agenda"><UiIcon name="arrowUpRight" :size="18" /></RouterLink>
        </header>
        <div class="counters">
          <div><strong class="num">{{ todayOpen.length }}</strong><span>oggi</span></div>
          <div :class="{ 'is-warn': agenda.overdue.length }"><strong class="num">{{ agenda.overdue.length }}</strong><span>in ritardo</span></div>
          <div><strong class="num">{{ agenda.upcoming.length }}</strong><span>in arrivo</span></div>
        </div>
        <ul v-if="agendaNext.length" class="events">
          <li v-for="o in agendaNext" :key="`${o.commitment.id}-${o.date}`" class="event" :class="`event--${o.status}`">
            <span class="event__date" aria-hidden="true">
              <strong class="num">{{ dayNum(o.date) }}</strong>
              <span>{{ monthShort(o.date) }}</span>
            </span>
            <span class="event__body">
              <span class="event__title">{{ o.commitment.title }}</span>
              <span class="event__when">{{ relativeDays(o.date, today) }}</span>
            </span>
          </li>
        </ul>
        <div v-else class="empty"><UiIcon name="sun" />Niente in programma nelle prossime due settimane.</div>
        <nav class="links" aria-label="Pagine Agenda">
          <RouterLink v-for="l in agendaLinks" :key="l.label" :to="l.to" class="link"><UiIcon :name="l.icon" :size="15" />{{ l.label }}</RouterLink>
        </nav>
      </section>

      <!-- Obiettivi -->
      <section class="tile" style="--mod: var(--series-3)" aria-labelledby="h-goals">
        <header class="tile__head">
          <span class="tile__icon" aria-hidden="true"><UiIcon name="target" /></span>
          <h2 id="h-goals">Obiettivi</h2>
          <RouterLink to="/obiettivi" class="tile__open" aria-label="Apri Obiettivi"><UiIcon name="arrowUpRight" :size="18" /></RouterLink>
        </header>
        <div class="counters">
          <div><strong class="num">{{ activeGoals.length }}</strong><span>attivi</span></div>
          <div><strong class="num">{{ formatPercent(avgProgress, 0) }}</strong><span>avanzamento</span></div>
          <div><strong class="num">{{ doneGoals }}</strong><span>raggiunti</span></div>
        </div>
        <ul v-if="topGoals.length" class="goals">
          <li v-for="g in topGoals" :key="g.goal.id" class="goal">
            <span class="goal__emoji" :style="{ '--area': `var(${g.area.color})` }" aria-hidden="true">{{ g.area.emoji }}</span>
            <div class="goal__body">
              <div class="goal__row">
                <span class="goal__title">{{ g.goal.title }}</span>
                <span class="goal__pct num">{{ formatPercent(g.progress, 0) }}</span>
              </div>
              <div class="bar" role="progressbar" :aria-valuenow="Math.round(g.progress * 100)" aria-valuemin="0" aria-valuemax="100" :aria-label="g.goal.title">
                <span :style="{ width: `${g.progress * 100}%`, background: `var(${g.area.color})` }" />
              </div>
              <span v-if="g.next" class="goal__next">{{ g.next.title }}<template v-if="g.next.due"> · {{ fmtShortDay(g.next.due) }}</template></span>
            </div>
          </li>
        </ul>
        <div v-else class="empty"><UiIcon name="flag" />Nessun obiettivo attivo.</div>
      </section>

      <!-- Abitudini -->
      <section class="tile" style="--mod: var(--series-1)" aria-labelledby="h-habits">
        <header class="tile__head">
          <span class="tile__icon" aria-hidden="true"><UiIcon name="repeat" /></span>
          <h2 id="h-habits">Abitudini</h2>
          <RouterLink to="/abitudini" class="tile__open" aria-label="Apri Abitudini"><UiIcon name="arrowUpRight" :size="18" /></RouterLink>
        </header>
        <div class="habits">
          <div class="ring" role="img" :aria-label="`${habitsDone} abitudini su ${todayHabits.length} fatte oggi`">
            <svg viewBox="0 0 80 80" aria-hidden="true">
              <circle cx="40" cy="40" r="34" class="ring__track" />
              <circle cx="40" cy="40" r="34" class="ring__fill" :stroke-dasharray="RING" :stroke-dashoffset="RING * (1 - habitsRatio)" />
            </svg>
            <span class="ring__label"><strong class="num">{{ habitsDone }}</strong><span class="num">/{{ todayHabits.length }}</span></span>
          </div>
          <div class="streak">
            <span class="eyebrow">Serie migliore</span>
            <span class="streak__value"><UiIcon name="flame" :size="20" /><strong class="num">{{ bestStreak?.n ?? 0 }}</strong> giorni</span>
            <span v-if="bestStreak" class="muted small">{{ bestStreak.emoji }} {{ bestStreak.name }}</span>
          </div>
        </div>
        <ul v-if="todayHabits.length" class="chips">
          <li v-for="h in todayHabits" :key="h.id" class="chip" :class="{ 'chip--done': habits.isDone(h.id, today) }">
            <span aria-hidden="true">{{ h.emoji }}</span>{{ h.name }}
            <UiIcon v-if="habits.isDone(h.id, today)" name="check" :size="13" />
          </li>
        </ul>
        <div v-else class="empty"><UiIcon name="sun" />Nessuna abitudine prevista oggi.</div>
      </section>

      <!-- Diario -->
      <section class="tile" style="--mod: var(--series-7)" aria-labelledby="h-journal">
        <header class="tile__head">
          <span class="tile__icon" aria-hidden="true"><UiIcon name="book" /></span>
          <h2 id="h-journal">Diario</h2>
          <RouterLink to="/diario" class="tile__open" aria-label="Apri Diario"><UiIcon name="arrowUpRight" :size="18" /></RouterLink>
        </header>
        <ol class="week" aria-label="Ultimi 7 giorni">
          <li v-for="d in journalWeek" :key="d.date" class="week__day" :class="{ 'week__day--today': d.isToday }">
            <span class="week__letter">{{ d.letter }}</span>
            <span
              class="week__dot"
              :class="{ 'week__dot--on': d.entry }"
              :style="d.mood ? { background: d.mood.color } : undefined"
              :title="`${fmtShortDay(d.date)}: ${d.entry ? (d.mood?.label ?? 'pagina scritta') : 'nessuna pagina'}`"
            >
              <template v-if="d.mood">{{ d.mood.emoji }}</template>
              <UiIcon v-else-if="d.entry" name="check" :size="13" />
            </span>
          </li>
        </ol>
        <p class="muted small">
          <strong class="num">{{ weekEntries }}</strong> pagine questa settimana · <strong class="num">{{ journalStreak }}</strong> giorni di fila
        </p>
        <RouterLink to="/diario" class="cta">
          <UiIcon :name="todayEntry ? 'book' : 'edit'" :size="16" />
          {{ todayEntry ? 'Rileggi la pagina di oggi' : 'Scrivi la pagina di oggi' }}
        </RouterLink>
      </section>
    </div>
  </div>
</template>

<style scoped>
.home { display: flex; flex-direction: column; gap: var(--space-4); }

/* ---- Benvenuto ---- */
.hero {
  position: relative;
  overflow: hidden;
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  gap: var(--space-5);
  flex-wrap: wrap;
  padding: 30px 32px;
  border-radius: var(--radius-lg);
  background: linear-gradient(135deg, var(--brand) 0%, var(--brand-tile) 55%, var(--brand-soft) 100%);
  color: var(--on-brand);
}
.hero::after {
  content: '';
  position: absolute;
  right: -60px;
  top: -80px;
  width: 260px;
  height: 260px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.28);
  pointer-events: none;
}
.hero__text { position: relative; display: flex; flex-direction: column; gap: 4px; }
.hero__date { font-size: 0.9rem; font-weight: 500; opacity: 0.8; }
.hero h1 { font-size: clamp(1.9rem, 3vw, 2.6rem); font-weight: 500; letter-spacing: -0.035em; }
.hero__pills { position: relative; display: flex; flex-wrap: wrap; gap: var(--space-2); }
.pill {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 9px 14px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.7);
  color: var(--on-brand);
  font-size: 0.88rem;
  backdrop-filter: blur(6px);
  transition: background 0.15s ease, transform 0.15s ease;
}
.pill:hover { background: #fff; text-decoration: none; transform: translateY(-1px); }
.pill strong { font-weight: 650; }
.pill__warn { padding: 1px 8px; border-radius: 999px; background: var(--negative-soft); color: var(--negative); font-size: 0.76rem; font-weight: 600; }

/* ---- Griglia ---- */
.bento {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  grid-template-areas:
    'fin fin agenda'
    'goals habits journal';
  gap: var(--space-4);
}
.tile--fin { grid-area: fin; }
.tile--agenda { grid-area: agenda; }

.tile {
  --mod-soft: color-mix(in srgb, var(--mod) 13%, var(--surface));
  background: var(--surface);
  border-radius: var(--radius-lg);
  padding: 22px 24px;
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  min-width: 0;
  box-shadow: var(--shadow);
  transition: box-shadow 0.2s ease;
}
.tile:hover { box-shadow: 0 10px 30px rgba(18, 24, 33, 0.06); }
.tile__head { display: flex; align-items: center; gap: var(--space-3); }
.tile__head h2 { flex: 1; font-size: 1.05rem; }
.tile__icon { display: grid; place-items: center; width: 38px; height: 38px; border-radius: 12px; background: var(--mod-soft); color: var(--mod); flex: none; }
.tile__open { display: grid; place-items: center; width: 34px; height: 34px; border-radius: 50%; color: var(--text-muted); transition: background 0.15s ease, color 0.15s ease; }
.tile__open:hover { background: var(--mod-soft); color: var(--mod); text-decoration: none; }

.eyebrow { font-size: 0.76rem; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: var(--text-muted); }
.dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 6px; flex: none; }
.tag { align-self: flex-start; padding: 2px 10px; border-radius: 999px; background: var(--surface-2); color: var(--text-secondary); font-size: 0.76rem; font-weight: 600; }
.tag--pos { background: var(--positive-soft); color: var(--positive-strong); }
.tag--neg { background: var(--negative-soft); color: var(--negative); }
.empty { display: flex; align-items: center; gap: 10px; padding: 18px; border-radius: var(--radius-sm); background: var(--surface-2); color: var(--text-muted); font-size: 0.88rem; }
.spin { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

/* ---- Finanze ---- */
.fin { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr); gap: var(--space-4); }
.fin__worth { display: flex; flex-direction: column; gap: 6px; padding: 20px; border-radius: var(--radius); background: var(--mod-soft); }
.fin__big { font-size: clamp(1.7rem, 2.6vw, 2.3rem); font-weight: 500; letter-spacing: -0.04em; line-height: 1.15; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.fin__split { display: flex; flex-direction: column; gap: 4px; margin-top: auto; padding-top: var(--space-3); font-size: 0.84rem; color: var(--text-secondary); }
.fin__split span { display: flex; align-items: center; }
.fin__split strong { margin-left: auto; font-weight: 550; color: var(--text-primary); }
.fin__month { display: flex; flex-direction: column; gap: var(--space-3); padding: 4px 4px 0; }
.fin__month-head { display: flex; justify-content: space-between; align-items: center; gap: var(--space-2); }
.flows { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--space-3); margin: 0; }
.flows div { min-width: 0; }
.flows dt { display: flex; align-items: center; font-size: 0.8rem; color: var(--text-secondary); }
.flows dd { margin: 2px 0 0; font-size: 1.15rem; font-weight: 500; letter-spacing: -0.02em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.flowbar { display: flex; height: 12px; border-radius: 999px; background: var(--grid); overflow: hidden; gap: 2px; }
.flowbar span { height: 100%; transition: width 0.4s ease; }
.legend { display: flex; flex-wrap: wrap; gap: 4px 14px; font-size: 0.78rem; color: var(--text-muted); }
.legend span { display: inline-flex; align-items: center; }

/* ---- Link rapidi ---- */
.links { display: flex; flex-wrap: wrap; gap: 6px; margin-top: auto; }
.link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 12px;
  border-radius: 999px;
  background: var(--surface-2);
  font-size: 0.82rem;
  font-weight: 550;
  color: var(--text-secondary);
  transition: background 0.15s ease, color 0.15s ease;
}
.link:hover { background: var(--mod-soft); color: var(--text-primary); text-decoration: none; }
.link :deep(svg) { color: var(--mod); }

/* ---- Contatori ---- */
.counters { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); border-radius: var(--radius-sm); background: var(--surface-2); }
.counters div { display: flex; flex-direction: column; align-items: center; padding: 12px 6px; min-width: 0; }
.counters div + div { border-left: 1px solid var(--border); }
.counters strong { font-size: 1.35rem; font-weight: 500; letter-spacing: -0.02em; }
.counters span { font-size: 0.74rem; color: var(--text-muted); }
.counters .is-warn strong { color: var(--negative); }

/* ---- Agenda ---- */
.events { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.event { display: flex; align-items: center; gap: var(--space-3); padding: 6px; border-radius: var(--radius-sm); }
.event:hover { background: var(--surface-2); }
.event__date { display: flex; flex-direction: column; align-items: center; justify-content: center; width: 44px; height: 46px; border-radius: 12px; background: var(--surface-2); flex: none; line-height: 1.1; }
.event__date strong { font-size: 1.05rem; font-weight: 600; }
.event__date span { font-size: 0.68rem; text-transform: uppercase; color: var(--text-muted); letter-spacing: 0.04em; }
.event--today .event__date { background: var(--mod-soft); color: var(--mod); }
.event--overdue .event__date { background: var(--negative-soft); color: var(--negative); }
.event--overdue .event__date span { color: inherit; }
.event__body { display: flex; flex-direction: column; min-width: 0; }
.event__title { font-weight: 550; font-size: 0.9rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.event__when { font-size: 0.78rem; color: var(--text-muted); }
.event--overdue .event__when { color: var(--negative); }

/* ---- Obiettivi ---- */
.goals { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--space-3); }
.goal { display: flex; gap: var(--space-3); align-items: flex-start; }
.goal__emoji { display: grid; place-items: center; width: 36px; height: 36px; border-radius: 11px; background: color-mix(in srgb, var(--area) 15%, var(--surface)); flex: none; font-size: 1.05rem; }
.goal__body { display: flex; flex-direction: column; gap: 5px; flex: 1; min-width: 0; }
.goal__row { display: flex; justify-content: space-between; gap: var(--space-2); }
.goal__title { font-weight: 550; font-size: 0.9rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.goal__pct { font-size: 0.82rem; color: var(--text-secondary); font-weight: 550; }
.goal__next { font-size: 0.76rem; color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bar { height: 6px; border-radius: 999px; background: var(--grid); overflow: hidden; }
.bar span { display: block; height: 100%; border-radius: inherit; transition: width 0.4s ease; }

/* ---- Abitudini ---- */
.habits { display: flex; align-items: center; gap: var(--space-5); }
.ring { position: relative; width: 96px; height: 96px; flex: none; }
.ring svg { width: 100%; height: 100%; transform: rotate(-90deg); }
.ring circle { fill: none; stroke-width: 8; }
.ring__track { stroke: var(--grid); }
.ring__fill { stroke: var(--mod); stroke-linecap: round; transition: stroke-dashoffset 0.5s ease; }
.ring__label { position: absolute; inset: 0; display: grid; place-content: center; grid-auto-flow: column; align-items: baseline; }
.ring__label strong { font-size: 1.5rem; font-weight: 550; }
.ring__label span { font-size: 0.9rem; color: var(--text-muted); }
.streak { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.streak__value { display: flex; align-items: center; gap: 6px; font-size: 0.9rem; color: var(--text-secondary); }
.streak__value :deep(svg) { color: var(--orange); }
.streak__value strong { font-size: 1.5rem; font-weight: 500; color: var(--text-primary); }
.chips { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 6px; }
.chip { display: inline-flex; align-items: center; gap: 6px; padding: 5px 11px; border-radius: 999px; background: var(--surface-2); font-size: 0.8rem; color: var(--text-secondary); }
.chip--done { background: var(--mod-soft); color: var(--positive-strong); }

/* ---- Diario ---- */
.week { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 4px; }
.week__day { display: flex; flex-direction: column; align-items: center; gap: 6px; }
.week__letter { font-size: 0.72rem; font-weight: 600; color: var(--text-muted); }
.week__day--today .week__letter { color: var(--mod); }
.week__dot {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  max-width: 100%;
  border-radius: 50%;
  border: 2px dashed var(--border-strong);
  font-size: 1rem;
}
.week__dot--on { border: 0; background: var(--mod-soft); color: var(--mod); }
.week__day--today .week__dot { box-shadow: 0 0 0 2px var(--surface), 0 0 0 4px var(--mod); }
.cta {
  margin-top: auto;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 11px 16px;
  border-radius: 999px;
  background: var(--mod-soft);
  color: var(--text-primary);
  font-weight: 600;
  font-size: 0.88rem;
  transition: background 0.15s ease;
}
.cta:hover { background: color-mix(in srgb, var(--mod) 22%, var(--surface)); text-decoration: none; }
.cta :deep(svg) { color: var(--mod); }

/* ---- Responsive ---- */
@media (max-width: 1200px) {
  .bento {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    grid-template-areas:
      'fin fin'
      'agenda goals'
      'habits journal';
  }
}
@media (max-width: 760px) {
  .bento { grid-template-columns: minmax(0, 1fr); grid-template-areas: none; }
  .tile--fin, .tile--agenda { grid-area: auto; }
  .fin { grid-template-columns: minmax(0, 1fr); }
  .hero { padding: 24px 20px; }
}
@media (max-width: 480px) {
  .tile { padding: 16px; }
  .flows dd { font-size: 1rem; }
  .habits { gap: var(--space-4); }
  .ring { width: 80px; height: 80px; }
  .week__dot { width: 32px; height: 32px; font-size: 0.9rem; }
}
@media (prefers-reduced-motion: reduce) {
  .pill, .tile, .flowbar span, .bar span, .ring__fill { transition: none; }
  .spin { animation: none; }
}
</style>
