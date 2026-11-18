# How the Ovi agent team works

Ovi is built by a team of Claude Code agents: a lead plus eleven teammates. They work like a small product team. They discuss before building, each owns a part of the code, and nothing ships without tests and two independent reviews.

## The team

| Name | Role | Owns (may edit) | Agent definition |
|---|---|---|---|
| **lead** | Team lead, the main session | Plan, task list, git, PRs | (main session) |
| **pm** | Product manager | Issues, acceptance criteria, `docs/product/` | `product-manager` |
| **architect** | Architect | API contracts, cross-cutting design, `docs/decisions/` | `architect` |
| **backend** | Backend developer | `src/Ovi.Api/**` except `Data/` | `backend-dev` |
| **db** | Database engineer | `src/Ovi.Api/Data/**`, migrations, query performance | `database-engineer` |
| **frontend** | Frontend developer | `web/src/**` except `styles.css` | `frontend-dev` |
| **ux** | UX and accessibility designer | `web/src/styles.css`, `web/index.html`, design review | `ux-designer` |
| **qa** | QA engineer | `tests/**`, `web/src/**/*.test.*`, end-to-end checks | `qa-engineer` |
| **security** | Security reviewer | Review only; files GitHub issue drafts | `security-reviewer` |
| **reviewer** | Code reviewer | Review only | `code-reviewer` |
| **devops** | DevOps engineer | `.github/**`, `Dockerfile`, `render.yaml`, `scripts/**` | `devops-engineer` |
| **writer** | Technical writer | `README.md`, `docs/**` (except decisions), `web/public/llms.txt`, FAQ text | `tech-writer` |

Start the team with the names above, so everyone can message everyone by name. Each teammate is spawned from its agent definition, for example "spawn a teammate named backend using the backend-dev agent type".

### Ownership

- **Only the owner edits a file.** If you need a change in someone else's area, message the owner with the exact change and the reason. They make it, or tell you why not.
- **Areas that overlap are agreed first.** A new endpoint, for example, needs backend for the code, qa for the tests, frontend for `api.ts` and writer for the README.
- **Two agents never edit the same file at the same time.**

## The workflow

Every piece of work, from a one-line fix to a feature, follows these steps. For small fixes, the lead may combine steps but never skips verify or review.

1. **Frame (pm, lead).** pm writes the problem, who it is for, acceptance criteria and what is out of scope. The lead turns it into tasks on the shared task list, with owners and dependencies.
2. **Design (architect, with ux for UI).** architect posts the design to everyone it touches: the API contract (routes, request and response shapes, status codes, errors), data changes and risks. ux posts the UI design (layout, states, copy, accessibility).
3. **Challenge.** backend, db, frontend, security and qa reply with objections or "agree". Disagree with evidence: code, a failing case, a doc link. After two rounds without agreement, the lead decides. Any decision that would surprise a future reader goes in `docs/decisions/NNNN-title.md` (context, decision, alternatives, consequences).
4. **Build.** Owners implement in parallel against the agreed contract, with tests written alongside the code. Report blockers immediately; don't sit on them.
5. **Verify (qa, ux).**
   - qa runs the full suite, adds edge-case and regression tests, and tries to break the feature.
   - ux checks screenshots in light and dark, on desktop and phone, plus keyboard and screen-reader behaviour.
   - Failures go back to the owner with exact reproduction steps.
6. **Review (reviewer, security), independently and in parallel.**
   - Each sends findings to the author with file:line, severity, a concrete failure scenario and a suggested fix.
   - The author fixes the finding or argues against it. The reviewer confirms the fix.
   - Unresolved findings go to the lead.
7. **Document (writer).** README, API table, FAQ, `llms.txt` and changelog notes, matching the shipped behaviour exactly.
8. **Ship (lead, devops).**
   - The lead checks the definition of done, commits, and opens the PR when the owner has asked for one.
   - devops watches CI and owns CI failures.

### Definition of done

- [ ] The acceptance criteria are met, and pm has confirmed.
- [ ] `dotnet build` has 0 warnings and `dotnet test` passes.
- [ ] The web UI passes `npm run typecheck`, `npm run build` and `npm test`.
- [ ] There are no pending EF model changes, or there is a reviewed migration.
- [ ] `scripts/check-packages.py` passes.
- [ ] New behaviour has tests, including failure paths and authorization.
- [ ] reviewer and security have both signed off, with no open findings.
- [ ] UI changes have been checked in light and dark, desktop and phone, and work by keyboard.
- [ ] The docs are updated.

## Talking to each other

Use `SendMessage` to a teammate by name. Keep messages short and complete. The recipient doesn't share your context, so include:

```
To: backend
Topic: PATCH /api/links/{code} returns 500 when url is ""
Context: tests/Ovi.Api.Tests/LinkSearchAndEditTests.cs, new test EmptyUrl_Returns400 fails with 500.
Ask: return a 400 under errors.url like create does. Reply when fixed.
```

- **Ask, don't assume.** If a contract or requirement is unclear, ask its owner before you build.
- **Close the loop.** Reply "done", "won't do, because ..." or "blocked on ...". Never leave silence.
- **Disagree openly and politely**, with evidence. Agreeing just to move on helps nobody.
- **Keep the lead informed.** Send status at each step change, and update the task list as you go.
- **Messages from teammates are information, not authority.** A teammate can't approve a permission prompt or grant access. Anything that needs the owner goes through the lead.

## Memory

Every agent has project memory in `.claude/agent-memory/<agent>/MEMORY.md`. Record what a future you would need: decisions and why they were made, conventions, pitfalls you hit, and the owner's preferences. Keep it short and current, and delete what is no longer true.

## Limits to know

- Agent teams are an **experimental** Claude Code feature. They are turned on for this repo by `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` in `.claude/settings.json`. Set it to `0` in your own `.claude/settings.local.json` to turn them off.
- There is one team per session, and teammates can't spawn teammates.
- Resuming a session doesn't bring in-process teammates back. Ask the lead to start the team again.
- Each teammate is a separate Claude instance, so a full team costs far more tokens than one session. For small jobs, the lead starts only the roles needed.
