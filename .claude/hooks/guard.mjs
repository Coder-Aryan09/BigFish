#!/usr/bin/env node
// Claude Code PreToolUse adapter for the repo guardrail policy. Managed by claude-init.
// The rules live in agent-guardrails/policy.mjs (shared with other agents).

import { readFileSync } from "node:fs";
import { evaluateShell, evaluateFile } from "../../agent-guardrails/policy.mjs";

// File tools pass through to the normal permission flow on "allow". Shell
// commands send an explicit "allow" so non-sensitive commands run without a
// prompt (unless approvalMode is "all"); settings.json deny rules still
// apply on top of it.
function respond({ decision, reason }, { explicitAllow = false } = {}) {
  if (decision === "allow" && !explicitAllow) process.exit(0);
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: decision,
        permissionDecisionReason: `[repo guardrail] ${reason}. See AGENTS.md.`,
      },
    }),
  );
  process.exit(0);
}

let input;
try {
  input = JSON.parse(readFileSync(0, "utf8"));
} catch {
  // Unreadable input: refuse rather than let an unchecked call through.
  respond({ decision: "deny", reason: "guardrail could not read the tool call" });
}

const tool = input.tool_name || "";
const ti = input.tool_input || {};
const projectDir = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
const ctx = { projectDir, cwd: input.cwd || projectDir };

// Tools that run shell commands: Bash, and the desktop app's terminal tool.
if (tool === "Bash" || tool.startsWith("mcp__terminal__run")) {
  respond(evaluateShell(ti.command || ti.cmd || "", ctx), { explicitAllow: true });
}
if (["Read", "Edit", "Write", "MultiEdit", "NotebookEdit"].includes(tool)) {
  const op = tool === "Read" ? "read" : "write";
  respond(evaluateFile(op, ti.file_path || ti.notebook_path, ctx));
}
if (tool === "Grep" || tool === "Glob") {
  // Grep's `pattern` is the regex searched for, so only its path and glob are
  // file selectors. Glob's `pattern` is a file pattern.
  respond(evaluateFile("search", ti.path, { ...ctx, fileFilter: tool === "Glob" ? ti.pattern : ti.glob }));
}
process.exit(0);
