/**
 * How a rate is shown (PADR-0039 B.2): always as the fraction k/n; a percentage only at a resolution
 * of at least 1/n — none below n = 100, whole percent from 100, one decimal from 1000. Interval bounds
 * are estimates, not observed rates: whole percent, rounded outward so the shown interval is never
 * narrower than the computed one.
 */
import { wilson } from './stats.ts';

export type Language = 'en' | 'de';

/** A number in the report's language (German uses a decimal comma). */
export function number(value: number, digits: number, language: Language): string {
  return new Intl.NumberFormat(language === 'de' ? 'de-DE' : 'en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits, useGrouping: true }).format(value);
}

/** The decimals a percentage of n may show: null below 100 (none at all), 0 from 100, 1 from 1000. */
export function percentDigits(n: number): number | null { return n >= 1000 ? 1 : n >= 100 ? 0 : null; }

/** `k/n`, plus the percentage where n allows one: `150/200 (75 %)`. A fraction that is neither none
 * nor all is never shown as 0 % or 100 %: below the smallest step it reads `< 1 %`, above the largest
 * `> 99 %` (one decimal from n = 1000). */
export function rateText(k: number, n: number, language: Language): string {
  const digits = percentDigits(n);
  if (digits === null || n === 0) return `${k}/${n}`;
  const step = 10 ** -digits, shown = Number(((100 * k) / n).toFixed(digits));
  const percent = k > 0 && shown === 0 ? `< ${number(step, digits, language)}` : k < n && shown === 100 ? `> ${number(100 - step, digits, language)}` : number((100 * k) / n, digits, language);
  return `${k}/${n} (${percent} %)`;
}

/** The 95 % Wilson interval of k/n in whole percent, rounded outward. */
export function intervalPercent(k: number, n: number): { low: number; high: number } {
  const { low, high } = wilson(k, n);
  // A tiny epsilon keeps exact integers (0.25 → 25) from moving a whole percent outward by float noise.
  return { low: Math.max(0, Math.floor(low * 100 + 1e-9)), high: Math.min(100, Math.ceil(high * 100 - 1e-9)) };
}
