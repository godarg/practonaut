/**
 * Motion values for scripted (Web Animations) motion. They come from the tokens so the CSS and the
 * script can never disagree; reduced motion is honoured here as well as in CSS.
 */
const read = (name: string): string => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const milliseconds = (value: string): number => (value.endsWith('ms') ? parseFloat(value) : parseFloat(value) * 1000);

export interface Motion { calm: boolean; fast: number; base: number; slow: number; standard: string; out: string; spring: string }

export function motion(): Motion {
  return {
    calm: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    fast: milliseconds(read('--pn-duration-fast')), base: milliseconds(read('--pn-duration-base')), slow: milliseconds(read('--pn-duration-slow')),
    standard: read('--pn-ease-standard'), out: read('--pn-ease-out'), spring: read('--pn-ease-spring'),
  };
}
