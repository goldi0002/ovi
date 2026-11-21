# frontend memory

## Conventions
- All HTTP in `web/src/api.ts`; methods take one input object typed like the backend request DTO (`create`, `update`, `createMany`) and unwrap response wrappers (`createMany` returns `body.items`).
- `ApiError.fromServer` is true when the message came from the problem body; use it to tell a real API message from a proxy page (e.g. 503 HTML) before showing server text.
- Pure logic goes in plain modules (`bulk.ts`) so qa can unit-test it; qa owns `*.test.*` for pure helpers, I write component tests next to my components. `test/fakeApi.ts` is mine (not a test file).
- Segmented control: `role="group"` + `aria-pressed` buttons, classes as in `LinksTable.tsx`.
- Modes that keep their own state: keep both mounted and put `hidden` on the inactive one (Tailwind v4 preflight makes `[hidden]` display:none !important).
- No prettier config in the repo: format by hand, don't run prettier over files.

## Bulk shortening (2026-11, decision 0002)
- POST /api/links/bulk { urls, expiresAt? } -> 201 { items }. All or nothing, signed in only, max 25 (server may be lower: show errors.urls text).
- Server's `urls[i]` index is into the sent (non-blank) list; map to textarea line numbers with `parseUrlLines` (counts blank lines).
- Error copy: 503 with problem body shows server text (AC 41); other 5xx/413/network show "Couldn't shorten the links. Try again."; 429 and 401 have ux copy.
- CSV: `toCsv` returns CRLF text without BOM (qa's tests assert it); `downloadCsv` adds the BOM and revokes the object URL after the click.

## Pitfalls
- Never set `disabled` on the button the user just pressed while a request runs: focus drops to <body>. Use `aria-disabled` + a ref guard (`inFlight`) in the handler; keep `disabled` only for "can't submit" states.
- When a control unmounts on an error (e.g. submit replaced by Log in), move focus to its replacement. Focus a field whose inline error isn't role=alert.
- Python heredoc edits can fail silently when piped into a backgrounded command: check their output, or use Edit.
- In App-level tests there can be several "Log in" buttons (header, ShortenCard note, bulk note): scope queries with `within(...)`.
