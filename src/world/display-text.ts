/** Shared display domain, not transition code. No normalization may hide a submitted edit. */
export function isDisplayText(value: string): boolean {
  return value === value.normalize('NFC') && !/\p{Cf}/u.test(value);
}
