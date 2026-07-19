const LOCALE = 'es-ES';

const scoreFormatter = new Intl.NumberFormat(LOCALE, {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const pointsFormatter = new Intl.NumberFormat(LOCALE, {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

const euroFormatter = new Intl.NumberFormat(LOCALE, {
  style: 'currency',
  currency: 'EUR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const euroPreciseFormatter = new Intl.NumberFormat(LOCALE, {
  style: 'currency',
  currency: 'EUR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});

const integerFormatter = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 });

const dateTimeFormatter = new Intl.DateTimeFormat(LOCALE, {
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

const relativeFormatter = new Intl.RelativeTimeFormat(LOCALE, { numeric: 'auto' });

/** Nota total: siempre dos decimales, para que la columna no baile. */
export function formatScore(value: number): string {
  return scoreFormatter.format(value);
}

/** Puntos de un apartado: sin decimales sobrantes ("2", "1,25", "0,5"). */
export function formatPoints(value: number): string {
  return pointsFormatter.format(value);
}

/** Diferencia respecto a la propuesta de la IA, con signo explícito. */
export function formatDelta(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  if (rounded === 0) return '0';
  return `${rounded > 0 ? '+' : '−'}${pointsFormatter.format(Math.abs(rounded))}`;
}

/** El contrato guarda los costes en céntimos para no arrastrar coma flotante. */
export function formatEurosFromCents(cents: number): string {
  return euroFormatter.format(cents / 100);
}

/** Costes muy pequeños (por corrección) necesitan más decimales para decir algo. */
export function formatPreciseEurosFromCents(cents: number): string {
  return euroPreciseFormatter.format(cents / 100);
}

export function formatInteger(value: number): string {
  return integerFormatter.format(value);
}

export function formatPercent(ratio: number): string {
  return `${Math.round(ratio * 100)} %`;
}

export function formatDateTime(iso: string): string {
  return dateTimeFormatter.format(new Date(iso));
}

const DIVISIONS = [
  { amount: 60, unit: 'second' },
  { amount: 60, unit: 'minute' },
  { amount: 24, unit: 'hour' },
  { amount: 7, unit: 'day' },
  { amount: 4.34524, unit: 'week' },
  { amount: 12, unit: 'month' },
  { amount: Number.POSITIVE_INFINITY, unit: 'year' },
] as const satisfies readonly { amount: number; unit: Intl.RelativeTimeFormatUnit }[];

/** "hace 5 min", "ayer"… Lo que el profesor necesita saber de un vistazo. */
export function formatRelativeTime(iso: string, now: number = Date.now()): string {
  let duration = (new Date(iso).getTime() - now) / 1000;
  for (const division of DIVISIONS) {
    if (Math.abs(duration) < division.amount) {
      return relativeFormatter.format(Math.round(duration), division.unit);
    }
    duration /= division.amount;
  }
  return dateTimeFormatter.format(new Date(iso));
}

/** Tiempo en pie del servidor, en la pantalla de ajustes. */
export function formatUptime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (days > 0) return `${days} d ${hours} h`;
  if (hours > 0) return `${hours} h ${minutes} min`;
  return `${minutes} min`;
}

/** Tokens: los millones cansan de leer, los abreviamos. */
export function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${pointsFormatter.format(value / 1_000_000)} M`;
  if (value >= 1_000) return `${pointsFormatter.format(Math.round(value / 100) / 10)} k`;
  return integerFormatter.format(value);
}
