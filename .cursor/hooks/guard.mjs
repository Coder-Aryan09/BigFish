#!/usr/bin/env node
// Cursor hook adapter for the repo guardrail policy. Managed by claude-init.
// The rules live in agent-guardrails/policy.mjs (shared with Claude Code).
//
// Events handled (see .cursor/hooks.json):
//   beforeSubmitPrompt    "go" opens the plan gate, "stop"/"replan" closes it
//   beforeShellExecution  plan gate + shell policy (git, secrets, DB, folder);
//                         only sensitive commands ask, the rest run freely
//   beforeMCPExecution    plan gate + approval for every MCP tool call
//   beforeReadFile        secret files and paths outside the project
//
// Cursor has no pre-edit hook, so file edits before "go" cannot be blocked
// here; the rule is still stated in AGENTS.md and .cursor/rules.

import { readFileSync, writeFileSync, existsSync, rmSync, mkdirSync } from "node:fs";
import path from "node:path";
import {
  CONFIG, evaluateShell, evaluateFile, isGoMessage, isStopMessage, gateStateDir,
} from "../../agent-guardrails/policy.mjs";

const out = (obj) => {
  process.stdout.write(JSON.stringify(obj));
  process.exit(0);
};

let input;
try {
  input = JSON.parse(readFileSync(0, "utf8"));
} catch {
  out({ permission: "deny", userMessage: "Guardrail could not read the hook input." });
}

const event = input.hook_event_name;
const projectDir = input.workspace_roots?.[0] || process.cwd();
const cwd = input.cwd || projectDir;
const convo = String(input.conversation_id || "unknown").replace(/[^\w-]/g, "_");
const stateDir = gateStateDir(projectDir);
const flag = path.join(stateDir, `go-cursor-${convo}`);
const gateOpen = () => !CONFIG.planGate || existsSync(flag);

const GATE_MSG = "Planning phase: nothing runs until the developer reviews the plan and replies exactly \"go\". See AGENTS.md.";

if (event === "beforeSubmitPrompt") {
  if (isGoMessage(input.prompt)) {
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(flag, new Date().toISOString());
  } else if (isStopMessage(input.prompt)) {
    rmSync(flag, { force: true });
  }
  out({ continue: true });
}

if (event === "beforeShellExecution") {
  if (!gateOpen()) out({ permission: "deny", userMessage: GATE_MSG, agentMessage: GATE_MSG });
  const { decision, reason } = evaluateShell(input.command, { projectDir, cwd });
  out({ permission: decision, userMessage: `[repo guardrail] ${reason}`, agentMessage: `[repo guardrail] ${reason}. See AGENTS.md.` });
}

if (event === "beforeMCPExecution") {
  if (!gateOpen()) out({ permission: "deny", userMessage: GATE_MSG, agentMessage: GATE_MSG });
  out({ permission: "ask", userMessage: "[repo guardrail] every tool call needs your approval in this repo" });
}

if (event === "beforeReadFile") {
  const { decision, reason } = evaluateFile("read", input.file_path, { projectDir, cwd });
  out(decision === "allow" ? { permission: "allow" } : { permission: "deny", userMessage: `[repo guardrail] ${reason}` });
}

out({ permission: "allow" });
