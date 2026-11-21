# tech-writer memory

- Changelog lives in `docs/CHANGELOG.md` (created for bulk shortening, 2026-11-18; lead approved). Newest first, "Unreleased" on top.
- FAQ text exists twice: `web/src/components/Faq.tsx` (frontend) and the FAQPage JSON-LD in `web/index.html` (ux). Send both the identical text; never edit them myself.
- README API docs: the Endpoints table, then "Validation rules", "Click counting", "Rate limits for making links", "Errors", a curl example, then a "Bulk create" subsection.
- Create budget (`Security/CreateBudget.cs`): single create, PATCH and bulk share one budget counted in links. Bulk costs N, and a 400 or 429 batch costs 0. Single create and PATCH cost 1 even on a 400.
- Pitfall: product specs can disagree with the shipped code (bulk spec said 429 for a low CreatePerMinute, but the code gives 400). Always document the code and tests.
- UI button labels can be dynamic (for example "Shorten 3 URLs"), so don't name them in the FAQ.
