# Copilot instructions

Follow every rule in `AGENTS.md` at the repo root. In short:

1. Plan first. Do not edit or run anything until the developer reviews the plan and replies exactly `go`.
2. Sensitive commands need the developer's approval: file deletes, database clients, infra changes, package installs, uploads and remote access, printing env vars, inline code, kill/chmod. Full list in AGENTS.md rule 2.
3. Git is read-only. Never add, commit, push, pull, reset, checkout, stash or tag. The developer commits and pushes.
4. Never read or edit `.env`, `.env.*`, private keys. Use `.env.example`.
5. Never delete database data.
6. Stay inside this folder.
7. Ask before deleting any file.
8. No destructive infrastructure commands (`kubectl delete`, `docker prune`, `terraform destroy`, `npm publish`, `sudo`, ...).
