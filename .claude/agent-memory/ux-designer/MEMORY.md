# ux-designer memory

## Conventions
- Segmented control: bg-segment track, bg-segment-on + shadow-control for selected; role="group" + aria-pressed (LinksTable.tsx), role=tablist only on Admin.
- Copy sizes: body 0.8125rem, headings 0.9375rem, muted helper text-xs. Sentence case, no exclamation except "Copied!".
- Errors: ui.ts `errorBox` with role="alert"; field-level server messages shown verbatim.
- Contrast check: python WCAG formula against page #fff/#121213, surface #fff/#1c1c1e, subtle #f5f5f7/#2a2a2d.

## Tokens added
- --color-success light-dark(#1e7b34, #30d158) (2026-11, bulk shortening): only for done ticks/result headings.

## Decisions
- Bulk shortening (docs/product/bulk-shortening.md): "One link / Many links" toggle in ShortenCard; signed-in only; error summary focused, items "Line N: url — msg" mapped to textarea line numbers (not urls[i]); results card focuses its heading, no aria-live on the list. CopyButton got an ariaLabel prop so "Copy all" doesn't read every URL.

## Pitfalls
- A submit button with `disabled` while saving drops keyboard focus to <body> on any error. Use aria-disabled while saving; disabled only for "can't submit yet".
- Anything that unmounts the focused control (e.g. a 401 swapping submit for Log in) must move focus somewhere on purpose.
- Screenshot review: mock with page.route (Playwright: the LAST registered matching route wins, so register catch-alls first). Scripts: Vite on :5173, colorScheme + reducedMotion per context, log document.activeElement and scrollWidth>clientWidth.
- `break-all` on a whole list item splits normal words; put it only on the URL span.
- CopyButton's default aria-label is `${label} ${text}`; for multi-URL text pass ariaLabel.
- FAQ text lives in Faq.tsx (frontend) AND index.html JSON-LD (mine): keep them in sync.
