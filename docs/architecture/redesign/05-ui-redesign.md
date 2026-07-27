# Makthab v3 — UI Redesign (Phase 5)

**Status:** Proposal. Runs as a parallel track alongside Phases 1-4 (see
[00-overview-and-prioritization.md](./00-overview-and-prioritization.md) §3-4);
only per-tenant white-label theming depends on Phase 4
([04-multi-tenant-architecture.md](./04-multi-tenant-architecture.md)).

---

## 1. Executive summary

Makthab's client is already on a solid, modern foundation — React 18 + TS +
Vite + Tailwind + shadcn/ui, with existing Arabic/RTL support. The redesign
work here is not a stack replacement; it's formalizing what's implicit
today (ad hoc per-page styling, no documented component catalog, RTL
retrofitted rather than structural) into a real design system, then using
that system to make the app read as a polished, trustworthy product for
non-technical Masjid staff rather than an internal tool. The second driver
is role-adaptive UX: Admin, Accountant, and Teacher do fundamentally
different jobs in this app today and currently get the same generic page
shells — the highest-leverage redesign work is making each role's daily
workflow (report oversight, fee data-entry, attendance marking) fast and
purpose-built, not just prettier.

This phase runs in parallel with the backend phases from day one — tokens,
component catalog, accessibility, and i18n work touch the client only.
The one dependency is white-label theming (per-Masjid logo/colors), which
needs Phase 4's tenant branding model to exist server-side first, so it's
sequenced as the last milestone here, timed to land alongside Phase 4.

---

## 2. Design principles

1. **Speed over flourish for data-entry workflows.** Fee collection and
   attendance marking happen dozens of times a day per user. Keyboard
   navigation, minimal clicks, and inline validation matter more than
   animation or decorative UI in these flows. Reports and dashboards can
   afford more visual polish since they're consumed, not operated.
2. **Trustworthy, not flashy.** This app holds people's money (fee/expense
   records) and children's data (student records, attendance). The visual
   language should read as professional and careful — clear hierarchy,
   restrained color, unambiguous status indicators — not consumer-app
   playful.
3. **RTL-first, not RTL-retrofitted.** Build with CSS logical properties
   (`margin-inline-start`, `text-align: start`, etc.) and Tailwind's
   `rtl:`/`ltr:` variants from the token layer up, so Arabic isn't a mirrored
   afterthought bolted onto an LTR-designed layout.
4. **Role-adaptive, not one-size-fits-all.** Admin, Accountant, and Teacher
   see different dashboards, different nav priorities, and different
   default views of shared pages (e.g., Accountant's Students list defaults
   to a fee-status view; Teacher's defaults to today's attendance class).
5. **Multi-tenant-ready visual system.** Every design token should be able
   to trace back to a themeable variable, even before Phase 4 exists, so
   white-labeling later is a data problem, not a redesign.

---

## 3. Architecture & design decisions

### 3.1 Stay on Tailwind + shadcn/ui (don't replace the stack)

**Decision:** keep Tailwind CSS + shadcn/ui (Radix primitives) as the
component foundation; invest in tokens and a documented catalog on top of
it, rather than migrating to a different UI kit (MUI, Chakra, Ant, etc.).

**Rationale:** shadcn/ui components are already integrated across every
current page, are copy-owned (live in `client/src/components/ui`, not a
black-box dependency), and are Radix-based — which gives strong
accessibility primitives (focus management, ARIA roles, keyboard nav) for
free. A framework swap would be weeks of pure migration risk for no
functional gain, and would directly compete with every other phase's
timeline. The "modern, marketable" goal is achievable by re-theming and
extending this stack; it doesn't require replacing it.

**Trade-off accepted:** shadcn/ui's copy-in-repo model means updates are
manual (no `npm update` for component internals). Acceptable given the
team already owns this trade-off today.

### 3.2 Design token architecture

Three-layer token model, implemented as CSS custom properties (already how
shadcn/ui's Tailwind theme works via `hsl(var(--primary))`-style tokens):

| Layer | Example | Owner |
|---|---|---|
| **Primitive** | `--color-blue-600: 217 91% 45%` | Design system (fixed palette) |
| **Semantic** | `--color-brand-primary: var(--color-blue-600)` | Design system default, overridable per tenant |
| **Component** | `--button-primary-bg: var(--color-brand-primary)` | Component layer, consumes semantic only |

Components must reference only semantic/component tokens, never primitives
directly — this is what makes theming (§3.3) a data change instead of a
code change.

### 3.3 Theming system (ties to Phase 4)

**Mechanism:** `OrgProfile` (or its Phase-4 per-tenant equivalent) gains
`brandPrimaryColor`, `brandSecondaryColor`, `logoUrl` fields. On login/app
load, the client fetches the active org's branding via the existing
`/api/v1` org-profile endpoint, and a `ThemeProvider` (new: a thin React
context, not a new dependency) writes the semantic-layer CSS custom
properties onto `:root` at runtime — e.g.
`document.documentElement.style.setProperty('--color-brand-primary', hslFromHex(org.brandPrimaryColor))`.
Tailwind classes and shadcn/ui components keep working unmodified because
they already resolve through those same custom properties.

**Trade-off:** runtime CSS-var injection (chosen) vs. build-time per-tenant
theme bundles. Runtime injection means one static client build serves every
tenant — essential for a shared-schema multi-tenant model (Phase 4 §2) — at
the cost of no per-tenant Tailwind *class* customization (only CSS-var-level
theming: colors, not layout). That's the right trade-off here: Masjid
branding is a palette + logo, not a layout redesign per customer.

**Until Phase 4 lands:** this is a no-op — one hardcoded default theme.
Building the token layer now means Phase 4 only needs to wire the data
source, not restructure CSS.

### 3.4 Dark mode

Not currently present. Add via the same CSS-custom-property mechanism:
`shadcn/ui`'s standard `class`-based dark mode strategy (`.dark` on `html`)
composes cleanly with the tenant theme layer — dark mode toggles which
*primitive* values the semantic tokens resolve to; tenant branding still
overrides the semantic layer on top. Low effort given the token
architecture above is already designed for exactly this kind of override
stacking. Ship as a user preference (persisted client-side), not a tenant
setting.

### 3.5 Component catalog approach

Document (Storybook or a lightweight in-repo MDX/markdown catalog — pick
Storybook only if the team will actually maintain it; otherwise a
`docs/architecture/redesign/component-catalog/` set of usage examples is
lower-overhead and matches this project's dependency-light philosophy) every
shared component with: props, usage example, accessibility notes, RTL
behavior. Prevents the current failure mode where each new feature page
(Students, Fees, Attendance, Finance, Reports) reinvents table/badge/form
patterns slightly differently.

### 3.6 Arabic PDF rendering — font-embedding decision

**Problem:** `server/src/lib/pdf.ts` is a dependency-free ASCII-only writer,
chosen specifically to avoid a Puppeteer/Chromium dependency (offline-friendly,
per `CLAUDE.md`). Arabic receipts/reports currently can't render Arabic text.

**Decision: embed a font, don't swap to Puppeteer.** Recommend adding a
minimal font-embedding capability to the existing PDF writer (embedding a
subset of a Noto Naskh Arabic / Amiri TTF as a CID-keyed font in the PDF,
with a small bidi/shaping pass for Arabic glyph joining) rather than pulling
in Puppeteer.

**Rationale:** Puppeteer reintroduces exactly the dependency/offline-friendliness
problem the original writer was built to avoid, and adds a Chromium binary
to every deployment (meaningful cost in the AWS Fargate image size and cold-start
time from Phase 2). Font embedding is more implementation work up front
(Arabic requires contextual glyph shaping, not just a font file) but keeps
the "dependency-free, offline-capable" property intact. If font-embedding
proves too costly in practice, Puppeteer is the documented fallback — call
this a checkpoint decision at the start of the implementation milestone
below, not a silent scope drop (this exact risk is flagged in the overview
doc's global risk register).

**Trade-off table:**

| Approach | Pros | Cons |
|---|---|---|
| Font-embed in existing writer (recommended) | No new runtime dependency; keeps offline/lightweight deploys; smaller Fargate image | Real implementation effort: Arabic shaping/bidi is non-trivial to get right from scratch |
| Swap to Puppeteer for Arabic docs only | Simpler correctness (real browser text layout) | Chromium dependency reintroduced; slower cold starts; contradicts the original design rationale |

---

## 4. Accessibility

**Target:** WCAG 2.1 AA on all primary workflows (per overview §7 success
metrics): login, student admission, fee collection, attendance marking,
report generation.

**App-specific concerns:**
- **Data-dense tables** (Students list with sortable Age/Category columns):
  ensure sort-state and column headers use proper `aria-sort`, table
  semantics (`<table>`/`scope`) rather than div-grids, and that sort
  controls are keyboard-operable (already likely true via shadcn/ui's
  underlying primitives — verify, don't assume).
- **RTL + screen readers:** verify NVDA/VoiceOver read Arabic-locale content
  in correct logical order when `dir="rtl"` is set at the document level,
  not just visually mirrored.
- **Form validation announcements:** the existing Zod + React Hook Form
  setup should surface errors via `aria-invalid` + `aria-describedby`
  linked to the error message, and errors should be announced
  (`aria-live="polite"` region) — audit every form (Student, Fee, Expense,
  Staff, Attendance) for this pattern consistently.
- **Status/badge color contrast:** fee-status (paid/overdue/partial) and
  attendance-status (present/absent/late) badges must not rely on color
  alone — pair with icon or text label, and verify contrast ratios ≥4.5:1
  for text, ≥3:1 for UI component boundaries.

**Audit plan:**
- **Automated (CI gate):** `axe-core` (via `@axe-core/react` in dev, or
  `jest-axe`/Playwright + axe in CI) run against each core page; fail CI on
  new violations.
- **Manual:** keyboard-only pass and a screen-reader pass (NVDA on Windows,
  VoiceOver on Mac — cover both since staff may use either) on the 6 core
  workflows listed above, done once per major milestone, not just at the end.

---

## 5. Responsiveness

Primary usage is desktop (office/admin work — fee collection, reports,
staff/salary management). Attendance marking is the one workflow plausibly
done from a tablet/phone in a classroom.

| Workflow | Priority | Strategy |
|---|---|---|
| Attendance marking | Mobile/tablet-first | Large touch targets, single-class-at-a-time view, works well down to ~375px |
| Dashboard | Responsive, secondary on mobile | Desktop-optimized layout; mobile gets a simplified stacked summary, not full parity |
| Fee collection | Desktop-first, tablet-usable | Keyboard-optimized on desktop; touch-usable on tablet (front-desk scenario) |
| Students/Reports/Finance | Desktop-first | Data-dense tables; mobile gets horizontal scroll or a card-view fallback, not a redesign priority |

Breakpoints: adopt Tailwind's defaults (`sm/md/lg/xl`) rather than inventing
custom ones — no reason to diverge from the existing config.

---

## 6. Internationalization

Formalize beyond current Arabic/RTL support:

- **Library:** recommend `i18next` + `react-i18next` — mature RTL/pluralization
  support, widely used with Vite/React, straightforward to add without
  disrupting the existing `@makthab/shared` Zod-schema-driven forms (i18n
  wraps display strings, not validation logic).
- **Structure:** extract all UI strings into locale JSON files
  (`client/src/locales/{en,ar}.json` to start) now, even before adding a
  third locale — this is the actual formalization work; adding more
  locales later is then just translation, not re-plumbing.
- **RTL via logical properties, not mirroring:** use Tailwind's logical
  utilities (`ps-4`/`pe-4` instead of `pl-4`/`pr-4`, `text-start` instead of
  `text-left`) so `dir="rtl"` flips layout correctly without per-component
  LTR/RTL conditional classes — avoids the classic "manually mirror every
  page" trap and keeps future locale additions (which may all be LTR) from
  needing RTL-specific overrides removed later.

---

## 7. Reference wireframe/UX blueprint (textual)

**Role-adaptive dashboard:**
- *Admin:* full KPI row (total students, fee collection rate, attendance
  rate, pending expenses), org-wide charts, quick links to all reports.
- *Accountant:* fee-collection-focused — today's collections, defaulters
  list, pending salary payments, expense approval queue front and center;
  no student-profile-edit affordances (role restriction surfaced in UI, not
  just blocked server-side).
- *Teacher:* today's assigned class(es), one-tap "mark attendance" entry
  point, low-attendance alerts for their own classes only. Minimal chrome —
  this persona needs speed, not oversight.

**Fee-collection flow (data-entry speed optimized):** single-screen flow —
student search/autocomplete (already exists per `AutocompleteField`) → fee
structure auto-populated → amount/mode fields with sensible defaults →
submit-and-print-receipt as one action, keyboard-submittable end to end
(no forced mouse use for a front-desk power user doing this repeatedly).

**Students list (data-dense table baseline):** existing sortable Age +
always-visible Category columns (commits `e20f961`/`4f94ea0`) become the
reference pattern for the redesigned table component — sortable headers,
consistent status-badge styling, filter row — then reused for
Fees/Attendance/Expenses/Staff lists so all data tables share one visual
and interaction language instead of being styled ad hoc per page.

---

## 8. Component catalog

| Component | Status | Notes |
|---|---|---|
| Data table (sort, filter, pagination) | Exists ad hoc per page | Formalize as one shared `<DataTable>` built on the Students-list pattern |
| Form field group (label + input + error) | Exists via shadcn/ui `Field`/`AutocompleteField` | Document usage; ensure `aria-describedby` wiring is consistent everywhere |
| Stat/KPI card | Partial (dashboard) | Formalize for role-adaptive dashboards |
| Status badge (fee/attendance states) | Exists ad hoc | Formalize with icon+color+text pattern (accessibility, §4) |
| PDF/receipt preview | Not present | New — preview before print/send, useful given WhatsApp wa.me integration |
| Role-gated nav | Exists (role checks in routing) | Formalize as a documented pattern, not per-page conditionals |
| Theme provider | Not present | New — required for §3.3/3.4 |

---

## 9. Migration/implementation plan

Fits the overview's 6-10 week parallel-track window; runs concurrently with
backend Phases 1-3.

| Milestone | Weeks | Depends on | Deliverable |
|---|---|---|---|
| M1: Token architecture + component catalog scaffold | 1-2 | Nothing (Day 1 start) | 3-layer tokens live in Tailwind config; catalog doc structure created |
| M2: Core component formalization (DataTable, badges, KPI cards) | 2-4 | M1 | Students-list pattern generalized and rolled out to Fees/Attendance/Finance |
| M3: Accessibility baseline (axe-core in CI + first manual pass) | 3-5 | M2 | CI gate active; violations on core pages fixed |
| M4: i18n formalization + dark mode | 4-6 | M1 | String extraction complete; dark mode shipped |
| M5: Role-adaptive dashboards | 5-7 | M2 | Admin/Accountant/Teacher dashboard variants shipped |
| M6: Arabic PDF font-embedding | 4-8 (can run parallel, backend-owned) | Nothing (independent of client work) | Arabic receipts/reports render correctly |
| M7: Tenant white-label theming | after Phase 4 branding API exists | Phase 4 | ThemeProvider wired to live OrgProfile branding data |

M6 is technically backend work (`server/src/lib/pdf.ts`) but is scoped in
this doc per the overview's risk register — flagging ownership here so it
isn't dropped between the UI and backend tracks.

---

## 10. Risk assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Component catalog work never gets documented, drifts back to ad hoc per-page styling | Med | Med | Make catalog docs part of PR review checklist for new UI components |
| Arabic PDF font-embedding (M6) takes longer than estimated (bidi/shaping is genuinely hard) | Med | Med | Time-boxed checkpoint at 3 weeks in; fall back to Puppeteer-for-Arabic-docs-only if not converging (see §3.6 trade-off table) |
| Runtime CSS-var theming has a flash-of-default-theme before org branding loads | Low | Low | Fetch/cache org branding alongside auth bootstrap, apply before first paint where feasible |
| Accessibility retrofitted late, found to require rework of already-shipped components | Med | Med | M3 (axe-core + manual audit) scheduled early (week 3-5), not deferred to the end |
| Role-adaptive dashboards increase QA surface (3x variants to test) | Med | Low | Shared component base per §8 keeps variants to data/config differences, not separate implementations |

---

## 11. Testing/validation plan

- **Visual regression:** snapshot testing (e.g. Playwright screenshot
  comparison) on the core pages/components across light/dark and LTR/RTL —
  catches unintended token-layer regressions as the theme system evolves.
- **Accessibility gate in CI:** `axe-core` run as part of the existing
  `npm run test` / typecheck pipeline; new violations block merge.
- **Usability testing with real users:** given Admin/Accountant/Teacher are
  non-technical staff, run short task-based sessions (e.g. "collect a fee
  payment," "mark today's attendance") with actual or representative users
  at M5 completion — this is the validation that matters most for
  "marketable, user-friendly," and automated tests can't substitute for it.
- **Cross-browser/RTL smoke pass:** verify layout integrity in at least
  Chrome + Safari (WebKit RTL bugs are common) before each milestone ships.
