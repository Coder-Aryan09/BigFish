// BigFish tool error codes.
export const ErrorCode = {
  NOT_CONNECTED: "NOT_CONNECTED",
  TAB_NOT_FOUND: "TAB_NOT_FOUND",
  RESTRICTED_PAGE: "RESTRICTED_PAGE",
  FORBIDDEN_URL: "FORBIDDEN_URL",
  STALE_REF: "STALE_REF",
  NOT_ACTIONABLE: "NOT_ACTIONABLE",
  NOT_EDITABLE: "NOT_EDITABLE",
  OPTION_NOT_FOUND: "OPTION_NOT_FOUND",
  TIMEOUT: "TIMEOUT",
  PAGE_UNRESPONSIVE: "PAGE_UNRESPONSIVE",
  APPROVAL_DENIED: "APPROVAL_DENIED",
  APPROVAL_PENDING: "APPROVAL_PENDING",
  STALE_APPROVAL: "STALE_APPROVAL",
  POLICY_BLOCKED: "POLICY_BLOCKED",
  BUSY: "BUSY",
  KILLED: "KILLED",
  INVALID_ARGS: "INVALID_ARGS",
} as const;
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export function toolError(code: ErrorCode, msg: string, hint?: string): string {
  return `ERROR ${code}: ${msg}${hint ? ` Hint: ${hint}` : ""}`;
}
