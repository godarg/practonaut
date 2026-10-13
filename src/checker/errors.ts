import type { ErrorCode, Failure, Scalar } from "../world/types.ts";

export class CheckerError extends Error implements Failure {
  readonly code: ErrorCode;
  readonly details: Record<string, Scalar>;
  constructor(code: ErrorCode, message: string, details: Record<string, Scalar> = {}) {
    super(`${code}: ${message}`); this.name = "CheckerError"; this.code = code; this.details = details;
  }
}
export function invalid(message: string): never { throw new CheckerError("artifact_invalid", message); }
