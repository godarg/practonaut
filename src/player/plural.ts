/** Counted phrases ("1 arrow", "2 arrows"; "1 Pfeil", "2 Pfeile") chosen by the language's plural
 * rules, never by `n === 1` in the caller. `{n}` in the chosen form is replaced by the number. */
import type { Language } from './messages.ts';

const rules = new Map<Language, Intl.PluralRules>();
export function counted(language: Language, n: number, forms: { one: string; other: string }): string {
  let rule = rules.get(language);
  if (!rule) { rule = new Intl.PluralRules(language); rules.set(language, rule); }
  return (rule.select(n) === 'one' ? forms.one : forms.other).replaceAll('{n}', String(n));
}
