import { vault } from "./pii-vault.ts";

// Common PII patterns (emails, phone numbers, Indian PAN & Aadhaar, credit cards, US SSN)
const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const PHONE_REGEX = /(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g;
const PAN_REGEX = /\b[A-Z]{5}[0-9]{4}[A-Z]{1}\b/g;
const AADHAAR_REGEX = /\b\d{4}\s\d{4}\s\d{4}\b/g;
const CARD_REGEX = /\b(?:\d{4}[-\s]?){3}\d{4}\b/g;
const SSN_REGEX = /\b\d{3}-\d{2}-\d{4}\b/g;

export function sanitizeObservationForModel(text: string, origin: string): string {
  if (!text) return text;
  let sanitized = text;

  sanitized = sanitized.replace(EMAIL_REGEX, (match) => vault.tokenize("email", match, origin));
  sanitized = sanitized.replace(PAN_REGEX, (match) => vault.tokenize("pan", match, origin));
  sanitized = sanitized.replace(CARD_REGEX, (match) => vault.tokenize("card", match, origin));
  sanitized = sanitized.replace(AADHAAR_REGEX, (match) => vault.tokenize("aadhaar", match, origin));
  sanitized = sanitized.replace(SSN_REGEX, (match) => vault.tokenize("ssn", match, origin));
  sanitized = sanitized.replace(PHONE_REGEX, (match) => vault.tokenize("phone", match, origin));

  return sanitized;
}

export function rehydrateArgs(
  tool: string,
  args: any,
  targetOrigin: string
): { args: any; crossOrigins: string[] } {
  if (!args || typeof args !== "object") {
    return { args, crossOrigins: [] };
  }

  const crossOriginsSet = new Set<string>();
  const cloned = JSON.parse(JSON.stringify(args));

  function walkAndRehydrate(obj: any) {
    for (const key of Object.keys(obj)) {
      const val = obj[key];
      if (typeof val === "string") {
        const { text, crossOrigins } = vault.rehydrateText(val, targetOrigin);
        obj[key] = text;
        crossOrigins.forEach((o) => crossOriginsSet.add(o));
      } else if (val && typeof val === "object") {
        walkAndRehydrate(val);
      }
    }
  }

  walkAndRehydrate(cloned);
  return { args: cloned, crossOrigins: Array.from(crossOriginsSet) };
}
