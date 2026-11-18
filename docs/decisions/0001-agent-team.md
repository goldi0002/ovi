# 0001: Develop Ovi with a Claude agent team

- **Status:** accepted
- **Date:** 2026-11-18

## Context

The owner wants the project developed by a team of agents that discuss issues with each other and hold human-team standards: design before code, owned areas, tests, and independent review.

## Decision

- **Team feature:** use Claude Code agent teams, switched on with `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` in `.claude/settings.json`. The main session is the lead.
- **Teammates:** eleven, each defined once in `.claude/agents/`: product manager, architect, backend, database, frontend, UX, QA, security reviewer, code reviewer, DevOps and technical writer.
- **Working agreement:** ownership, workflow, definition of done and message format are in `docs/team.md`.
- **Memory:** each agent has project memory, committed under `.claude/agent-memory/`.

## Alternatives

- **Plain subagents:** cheaper, but they only report to the caller and can't discuss things with each other.
- **Fewer, broader roles:** less coordination, but weaker independent review.

## Consequences

- **Cost:** a full team uses many times the tokens of one session, so the lead starts only the roles a task needs.
- **Experimental feature:** agent teams can change, and teammates don't survive a session resume.
- **Spawning:** with teams enabled, subagents that Claude names start as teammates.
