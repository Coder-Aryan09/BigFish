import { sanitizeObservationForModel } from "../../safety/privacy.ts";

export interface SnapshotOptions {
  slot: number;
  title: string;
  url: string;
  scrollY: number;
  scrollHeight: number;
  elements: Array<{
    ref: string;
    role: string;
    name: string;
    value?: string;
    href?: string;
  }>;
  mode?: "interactive" | "text";
  maxChars?: number;
}

export function buildPageSnapshot(opts: SnapshotOptions): string {
  const shortUrl = opts.url.replace(/^https?:\/\//, "").slice(0, 45);
  const scrollInfo = `scroll ${Math.round(opts.scrollY)}/${Math.round(opts.scrollHeight)}`;
  const header = `[tab ${opts.slot}] ${opts.title.slice(0, 40)} | ${shortUrl} | ${scrollInfo}`;

  const lines: string[] = [header];

  for (const el of opts.elements) {
    let line = `${el.ref} ${el.role} "${el.name.replace(/"/g, "'")}"`;
    if (el.value !== undefined) {
      line += ` ="${el.value.slice(0, 30)}"`;
    }
    if (el.href) {
      const shortHref = el.href.replace(/^https?:\/\/[^/]+/, "");
      line += ` →${shortHref.slice(0, 30)}`;
    }
    lines.push(line);
  }

  let fullText = lines.join("\n");
  const max = opts.maxChars || 3000;
  if (fullText.length > max) {
    fullText = fullText.slice(0, max) + `\n… more elements below (scroll or use find)`;
  }

  return sanitizeObservationForModel(fullText, opts.url);
}

export function summarizeDelta(action: string, detail?: string): string {
  return `ok ${action}${detail ? ` | ${detail}` : ""}`;
}
