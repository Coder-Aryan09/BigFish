// BigFish MCP tool contracts (zod v4). The 12 browser tools are defined here.
import { z } from "zod";

export interface ToolContract {
  name: string;
  description: string;
  input: z.ZodObject<any>;
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean };
}

export const TOOLS: ToolContract[] = [
  {
    name: "browser_ping",
    description: "Check that the BigFish extension is connected.",
    input: z.object({}),
    annotations: { readOnlyHint: true },
  },
  {
    name: "browser_tabs",
    description: "List, switch, or close tabs in the browser.",
    input: z.object({
      action: z.enum(["list", "switch", "close"]),
      tab: z.number().optional(),
    }),
  },
  {
    name: "browser_navigate",
    description: "Open a URL or go back, forward, or reload.",
    input: z.object({
      url: z.string().optional(),
      action: z.enum(["back", "forward", "reload"]).optional(),
      tab: z.number().optional(),
      new_tab: z.boolean().optional(),
    }),
  },
  {
    name: "browser_snapshot",
    description: "Compact view of the page interactive elements or text.",
    input: z.object({
      tab: z.number().optional(),
      mode: z.enum(["interactive", "text"]).optional().default("interactive"),
      within: z.string().optional(),
      max_chars: z.number().optional().default(3000),
      offset: z.number().optional().default(0),
    }),
    annotations: { readOnlyHint: true },
  },
  {
    name: "browser_find",
    description: "Search the page for an element or text match.",
    input: z.object({
      query: z.string(),
      tab: z.number().optional(),
      kind: z.enum(["element", "text"]).optional().default("element"),
    }),
    annotations: { readOnlyHint: true },
  },
  {
    name: "browser_click",
    description: "Click an element by its ref ID.",
    input: z.object({
      ref: z.string(),
    }),
    annotations: { destructiveHint: true },
  },
  {
    name: "browser_type",
    description: "Type text into an input field by ref ID.",
    input: z.object({
      ref: z.string(),
      text: z.string(),
      submit: z.boolean().optional().default(false),
      clear: z.boolean().optional().default(true),
    }),
    annotations: { destructiveHint: true },
  },
  {
    name: "browser_fill_form",
    description: "Fill multiple fields in one round trip and submit.",
    input: z.object({
      fields: z.array(z.object({ ref: z.string(), value: z.string() })).max(15),
      submit_ref: z.string().optional(),
    }),
    annotations: { destructiveHint: true },
  },
  {
    name: "browser_select",
    description: "Pick an option in a dropdown or combobox.",
    input: z.object({
      ref: z.string(),
      option: z.string(),
    }),
    annotations: { destructiveHint: true },
  },
  {
    name: "browser_press_key",
    description: "Press a keyboard key such as Enter, Escape, or Tab.",
    input: z.object({
      key: z.string(),
      ref: z.string().optional(),
    }),
    annotations: { destructiveHint: true },
  },
  {
    name: "browser_scroll",
    description: "Scroll the page or a scrollable element up or down.",
    input: z.object({
      direction: z.enum(["up", "down"]),
      ref: z.string().optional(),
      amount: z.enum(["page", "half"]).optional().default("page"),
    }),
    annotations: { readOnlyHint: true },
  },
  {
    name: "browser_wait_for",
    description: "Wait until text, URL, or element condition is met.",
    input: z.object({
      text: z.string().optional(),
      gone_text: z.string().optional(),
      url_contains: z.string().optional(),
      ref: z.string().optional(),
      timeout_ms: z.number().optional().default(5000),
    }),
    annotations: { readOnlyHint: true },
  },
  {
    name: "browser_extract",
    description: "Pull links, tables, or fields as structured text.",
    input: z.object({
      what: z.enum(["links", "table", "fields"]),
      within: z.string().optional(),
      filter: z.string().optional(),
      max: z.number().optional().default(25),
    }),
    annotations: { readOnlyHint: true },
  },
];
