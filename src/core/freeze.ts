/** Deep-freezes plain JSON data in place, so a validated world can be shared without copies:
 * a write to it throws instead of changing every holder (PADR-0037). */
export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
