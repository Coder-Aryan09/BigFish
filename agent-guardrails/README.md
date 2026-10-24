# agent-guardrails

Shared guardrail policy for every AI coding agent in this repo, installed by claude-init. The rules themselves are documented in [`AGENTS.md`](../AGENTS.md).

| File | Purpose |
|---|---|
| `policy.mjs` | The single policy: shell, file and plan-gate checks. Edit rules here. |
| `config.json` | Project settings: approval mode, plan gate, secret paths, tests that delete DB data |
| `test-guardrails.mjs` | Self-test for the policy and every installed hook adapter. Follows `config.json` |
| `../.claude/hooks/guard.mjs` | Claude Code adapter (PreToolUse) |
| `../.claude/hooks/plan-gate.mjs` | Claude Code plan gate (UserPromptSubmit + PreToolUse) |
| `../.cursor/hooks.json`, `../.cursor/hooks/guard.mjs` | Cursor adapter |
| `../.githooks/pre-commit` | Blocks committing secrets, for every tool and person |
| `.state/` | Runtime plan-gate flags per session (gitignored) |

## config.json

| Key | Values | Effect |
|---|---|---|
| `approvalMode` | `"sensitive"` or `"all"` | `sensitive`: only sensitive shell commands ask. `all`: every shell command asks |
| `planGate` | `true` or `false` | `true`: no edits or commands until the developer replies exactly `go` |
| `secretPaths` | list of repo-relative paths, `*` and `**` allowed | Extra secret files, on top of `.env`, `.env.*`, `*.pem` private keys, `*.key`, `*.p12`, `*.pfx` |
| `testsDeleteDb` | `true` or `false` | `true`: agents may not run test runners, because the suites delete database data |
| `testsDeleteDbMessage` | text | Reason shown to the agent when a test run is denied |
| `testRunnerPattern` | regex string, optional | Replaces the built-in list of test commands |
| `extraSecretEnvVars` | list of name parts | Extra env var names that count as secrets when printed (`echo $X`) |

`policy.mjs` reads `config.json` on every hook call, so changes apply at once. `.claude/settings.json` deny rules do not read it: when you change `secretPaths` or `testsDeleteDb`, update the matching deny rules (or re-run claude-init with `--force`) and run the self-test, which checks they agree.

## Setup for a new clone

```bash
git config core.hooksPath .githooks
```

```bash
node agent-guardrails/test-guardrails.mjs
```

Requires Node 20+ on `PATH` (the hooks run with `node`).

## Limits

- Shell parsing is pattern based. It catches normal usage, not a determined attempt to hide a command. Approval for sensitive commands (rule 2) is the backstop.
- Cursor has no pre-edit hook, so edits before `go` are covered by instructions only.
- Codex, Antigravity and Copilot get the rules through instruction files and their own sandbox/approval settings, not these hooks.
