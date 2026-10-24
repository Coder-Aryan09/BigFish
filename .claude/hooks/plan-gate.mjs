#!/usr/bin/env node
// Claude Code plan gate: nothing in the project is executed or edited until
// the developer has reviewed the plan and replied with exactly "go".
// Managed by claude-init. Turned off by "planGate": false in
// agent-guardrails/config.json.
//
//   UserPromptSubmit  "go"            -> opens the gate for this session
//                     "stop"/"replan" -> closes it again
//   PreToolUse        Bash / Edit / Write / ... -> denied while closed
//
// Reading and searching stay allowed so the plan can be researched.

import { readFileSync, writeFileSync, existsSync, rmSync, mkdirSync } from "node:fs";
import path from "node:path";
import { CONFIG, isGoMessage, isStopMessage, gateStateDir } from "../../agent-guardrails/policy.mjs";

if (!CONFIG.planGate) process.exit(0);

const GATED_TOOLS = new Set(["Bash", "Edit", "Write", "MultiEdit", "NotebookEdit"]);

let input;
try {
  input = JSON.parse(readFileSync(0, "utf8"));
} catch {
  process.exit(0);
}

const projectDir = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
const sessionId = String(input.session_id || "unknown").replace(/[^\w-]/g, "_");
const stateDir = gateStateDir(projectDir);
const flag = path.join(stateDir, `go-${sessionId}`);

if (input.hook_event_name === "UserPromptSubmit") {
  if (isGoMessage(input.prompt)) {
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(flag, new Date().toISOString());
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "UserPromptSubmit",
        additionalContext: "[plan gate] The developer said go. You may now execute the approved plan. Sensitive commands still need their approval.",
      },
    }));
  } else if (isStopMessage(input.prompt)) {
    rmSync(flag, { force: true });
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "UserPromptSubmit",
        additionalContext: "[plan gate] The developer closed the gate. Go back to planning; do not edit or run anything until they say go.",
      },
    }));
  }
  process.exit(0);
}

const tool = input.tool_name || "";
const gated = GATED_TOOLS.has(tool) || tool.startsWith("mcp__terminal__");
if (gated && !existsSync(flag)) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason:
        "[plan gate] Planning phase: nothing is executed or edited yet. Finish the plan, let the developer review it, and wait until they reply exactly \"go\". See AGENTS.md.",
    },
  }));
}
process.exit(0);
