/** A generator's refusal by name; `generateInstance` draws an instance again on most codes. */
export class ChallengeError extends Error {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.name = 'ChallengeError'; this.code = code; }
}
