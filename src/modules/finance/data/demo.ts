import type { RawSheets } from '../domain'

/** PRNG deterministico: i dati demo sono identici a ogni caricamento. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const fmt = (d: Date) => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`

/**
 * Genera un documento demo (14 mesi fino a oggi) nello stesso formato dei fogli
 * Google, incluse due righe volutamente errate per mostrare la validazione.
 */
export function buildDemoSheets(today = new Date()): RawSheets {
  const rnd = mulberry32(42)
  const between = (a: number, b: number) => Math.round((a + rnd() * (b - a)) * 100) / 100
  const pick = <T,>(arr: T[]) => arr[Math.floor(rnd() * arr.length)]

  const H = ['Giorno', 'Conto', 'Categoria', 'Sotto-categoria', 'Descrizione', 'Importo', 'Valuta']
  const entrate: unknown[][] = [[...H, 'Fonte', 'Ricorrenza']]
  const uscite: unknown[][] = [[...H, 'Tipologia', 'Metodo']]
  const transazioni: unknown[][] = [[...H, 'Conto destinazione', 'Valuta destinazione', 'Importo convertito']]

  const start = new Date(today.getFullYear(), today.getMonth() - 13, 1)
  const exp = (d: Date, acc: string, cat: string, sub: string, desc: string, amt: number, type: string, method = 'Carta', cur = 'EUR') => {
    if (d <= today) uscite.push([fmt(d), acc, cat, sub, desc, amt, cur, type, method])
  }

  for (let m = 0; m < 14; m++) {
    const y = start.getFullYear()
    const mo = start.getMonth() + m
    const day = (n: number) => new Date(y, mo, n)
    const inMonth = (n: number) => day(n) <= today

    // Entrate
    if (inMonth(27)) entrate.push([fmt(day(27)), 'Conto Corrente', 'Lavoro', 'Stipendio', 'Stipendio mensile', between(2350, 2450), 'EUR', 'Azienda Srl', 'Mensile'])
    if (m % 3 === 1 && inMonth(15)) entrate.push([fmt(day(15)), 'Conto Corrente', 'Lavoro', 'Freelance', 'Progetto consulenza', between(400, 1200), 'EUR', 'Clienti', 'Una tantum'])
    if (m % 6 === 5 && inMonth(20)) entrate.push([fmt(day(20)), 'Broker ETF', 'Rendite', 'Dividendi', 'Dividendo ETF', between(60, 90), 'EUR', 'ETF World', 'Semestrale'])
    if ((m === 5 || m === 11) && inMonth(18)) entrate.push([fmt(day(18)), 'Conto Corrente', 'Lavoro', 'Bonus', 'Bonus semestrale', 1500, 'EUR', 'Azienda Srl', 'Semestrale'])

    // Uscite necessarie
    exp(day(3), 'Conto Corrente', 'Casa', 'Affitto', 'Affitto', 750, 'Necessaria', 'Bonifico')
    exp(day(10), 'Conto Corrente', 'Casa', 'Bollette', 'Luce e gas', between(70, 150), 'Necessaria', 'Addebito')
    exp(day(12), 'Conto Corrente', 'Casa', 'Internet', 'Fibra', 29.9, 'Necessaria', 'Addebito')
    exp(day(8), 'Conto Corrente', 'Trasporti', 'Abbonamento', 'Abbonamento mezzi', 39, 'Necessaria')
    for (const w of [2, 9, 16, 23]) exp(day(w), 'Conto Corrente', 'Alimentari', 'Supermercato', pick(['Esselunga', 'Coop', 'Conad', 'Lidl']), between(45, 95), 'Necessaria')
    if (m % 2 === 0) exp(day(19), 'Conto Corrente', 'Salute', 'Farmacia', 'Farmacia', between(12, 45), 'Necessaria')
    if (m % 12 === 2) exp(day(14), 'Conto Corrente', 'Trasporti', 'Assicurazione', 'RC auto', 420, 'Necessaria', 'Bonifico')
    exp(day(21), 'Conto Corrente', 'Trasporti', 'Carburante', 'Benzina', between(40, 70), 'Necessaria')

    // Uscite aggiuntive
    for (const w of [6, 13, 20, 27]) if (rnd() > 0.3) exp(day(w), 'Conto Corrente', 'Svago', 'Ristoranti', pick(['Pizzeria', 'Sushi', 'Trattoria', 'Aperitivo']), between(18, 65), 'Aggiuntiva', 'Carta')
    exp(day(14), 'Contanti', 'Svago', 'Bar', 'Caffè e colazioni', between(35, 60), 'Aggiuntiva', 'Contanti')
    exp(day(22), 'Contanti', 'Alimentari', 'Mercato', 'Mercato rionale', between(25, 40), 'Necessaria', 'Contanti')
    exp(day(5), 'Conto Corrente', 'Abbonamenti', 'Streaming', 'Netflix + Spotify', 23.98, 'Aggiuntiva', 'Addebito')
    if (rnd() > 0.4) exp(day(17), 'Conto Corrente', 'Shopping', pick(['Abbigliamento', 'Tecnologia', 'Casa']), pick(['Zalando', 'Amazon', 'IKEA']), between(30, 180), 'Aggiuntiva')
    if (m % 4 === 3) exp(day(11), 'Revolut USD', 'Viaggi', 'Voli', 'Volo New York', between(380, 520), 'Aggiuntiva', 'Carta', 'USD')
    if (m % 4 === 3) exp(day(24), 'Revolut USD', 'Viaggi', 'Alloggio', 'Hotel', between(300, 450), 'Aggiuntiva', 'Carta', 'USD')
    exp(day(25), 'Conto Corrente', 'Crescita personale', pick(['Libri', 'Corsi']), pick(['Libro', 'Corso online']), between(15, 60), 'Aggiuntiva')

    // Investimenti diretti (asset non tracciati come conto)
    if (m % 4 === 0) exp(day(16), 'Conto Corrente', 'Investimenti', 'Crowdfunding', 'Crowdfunding immobiliare', 500, 'Investimento', 'Bonifico')

    // Trasferimenti (neutri per entrate/uscite)
    if (inMonth(28)) transazioni.push([fmt(day(28)), 'Conto Corrente', 'Risparmio', 'PAC', 'PAC ETF mensile', 300, 'EUR', 'Broker ETF', '', ''])
    if (inMonth(28)) transazioni.push([fmt(day(28)), 'Conto Corrente', 'Risparmio', 'Accantonamento', 'Fondo emergenze', 200, 'EUR', 'Conto Deposito', '', ''])
    if (inMonth(1)) transazioni.push([fmt(day(1)), 'Conto Corrente', 'Contanti', 'Prelievo', 'Prelievo ATM', 100, 'EUR', 'Contanti', '', ''])
    if (m % 4 === 2 && inMonth(25)) transazioni.push([fmt(day(25)), 'Conto Corrente', 'Valuta', 'Cambio', 'Ricarica USD', 800, 'EUR', 'Revolut USD', 'USD', between(860, 880)])
  }

  // Righe volutamente problematiche: mostrano la validazione dell'import.
  const lastExpense = uscite[uscite.length - 1]
  uscite.push([...lastExpense]) // duplicato esatto
  uscite.push(['31/02/2026', 'Conto Corrente', 'Casa', 'Bollette', 'Data non valida', 40, 'EUR', 'Necessaria', 'Addebito'])

  return {
    Conti: [
      ['Conto', 'Tipo', 'Valuta', 'Saldo iniziale', 'Valore di mercato'],
      ['Conto Corrente', 'Conto corrente', 'EUR', 3200, ''],
      ['Contanti', 'Contanti', 'EUR', 120, ''],
      ['Conto Deposito', 'Risparmio', 'EUR', 5000, ''],
      ['Revolut USD', 'Carta', 'USD', 250, ''],
      ['Broker ETF', 'Investimento', 'EUR', 8000, 13450],
    ],
    Valute: [
      ['Valuta', 'Tasso'],
      ['USD', 0.92],
    ],
    Entrate: entrate,
    Uscite: uscite,
    Transazioni: transazioni,
  }
}
