# CLAUDE.md

All rules and the short project overview live in AGENTS.md, shared by every AI agent:

@AGENTS.md

## Claude Code specifics

- This project starts in **plan mode** (`.claude/settings.json`). Use it to research and write the plan. Do not call ExitPlanMode to start work until the developer has reviewed the plan and said `go`.
- The plan gate hook (`.claude/hooks/plan-gate.mjs`) denies Bash, Edit and Write in a session until the developer sends a message that is exactly `go`. `stop` or `replan` closes the gate again.
- `.claude/hooks/guard.mjs` checks every Bash, Read, Edit, Write, Grep and Glob call against `agent-guardrails/policy.mjs`. Normal Bash commands run without a prompt. Sensitive ones (AGENTS.md rule 2) ask for approval, even in auto mode.
- The guard matches secret file names anywhere in a command string, even inside an exclude filter (`grep -v`, `find -not -name`). Leave those names out of commands entirely.
- When a hook denies a call, report it to the developer. Do not retry the same thing another way.
- Never offer to commit, push or open a PR. Say the change is ready for the developer to review and commit.
- Use `.env.example` files for config. Never read `.env`.

---

## Project context

<!-- claude-init: TODO. Replace this block with project context checked against the code:
     services and ports, core flows, commands (build, dev, lint, test and who may run them),
     conventions, and known gaps and traps. Where docs disagree with code, trust the code. -->
