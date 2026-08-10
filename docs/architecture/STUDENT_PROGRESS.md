# Student Progress (Monthly Talimi Report)

Per-student monthly study progress capture for Admin and Teacher roles.
Informed by class-level Monthly Talimi Reports (portion + present days).

## UX plan

1. **Nav** — “Student Progress” under attendance-adjacent modules; gated by `progress.view`.
2. **Board** — Filter by month/year/class/search. Grid or table of students with a snapshot
   (portion/topics, present days, progress %, mood). Empty = “No report yet”.
3. **Edit** — Dialog form (`ProgressForm`) with student name pre-populated (read-only).
   Required fields first; optional “More detail” section for suggested fields.
4. **WhatsApp** — Sends a formatted progress summary to the student’s registered `whatsappNo`
   (same walink / business-api pattern as fee receipts). Privacy note shown before send.
5. **States** — `QueryState` loading/empty/error; toast on save/send; optimistic list patch on
   successful PATCH when the board query is cached.
6. **A11y / responsive** — Labelled fields, required indicators, keyboard-focusable actions,
   dialog focus trap (shadcn), stacked filters on small screens, `dir`-aware layout.

### Components

| Component | Role |
|-----------|------|
| `StudentProgressPage` | Board + filters + actions |
| `ProgressForm` | Create/edit modal |
| `WhatsAppLauncher` | Confirm + call send endpoint / open wa.me |
| `StudentProgressCard` / table row | Snapshot cell |

## Data model

```
Student 1──* MonthlyProgress
Staff   1──* MonthlyProgress (editedBy)
UserRole / permissionMatrix.progress.{view,create,update,delete}
```

**MonthlyProgress** (unique `studentId + month + year`):

| Field | Required | Notes |
|-------|----------|-------|
| month, year | yes | 1–12 / academic year |
| hoursStudied | yes | ≥ 0 |
| topicsCovered | yes | “Portion” from Talimi reports |
| assessments | yes | free text |
| attendanceDays | yes | present days (0–31) |
| moodEngagement | yes | enum |
| goals | yes | |
| notes | yes | |
| previousMonthComparison | no | |
| progressPercent | no | 0–100 |
| assignmentsCompleted | no | |
| softSkills | no | |
| reminders | no | |
| nextSteps | no | |
| linksJson | no | `[{url,label?}]` |
| attachmentsJson | no | `[{key,filename,mime,size,uploadedAt}]` |
| whatsappSent | — | server flag |
| editedById, createdAt, updatedAt | — | audit |

## API

Base: `/api/v1/progress` — auth + `progress` resource guards.

| Method | Path | Body / notes |
|--------|------|--------------|
| GET | `/board` | Query: month, year, class_id, q, page, limit → `{items:[{student,progress}],total,…}` |
| GET | `/` | List progress rows |
| GET | `/:id` | One record (+ student, editedBy) |
| POST | `/` | Create DTO |
| PATCH | `/:id` | Partial update |
| DELETE | `/:id` | Delete + best-effort attachment cleanup |
| POST | `/:id/whatsapp` | `{mode,link?,whatsappSent}` |
| POST | `/:id/attachments` | multipart `file` (PDF/JPEG/PNG/WebP ≤ 5MB) |
| DELETE | `/:id/attachments` | Body `{ key }` |

## Permissions

- New resource `progress` (view/create/update/delete).
- Legacy key `progress.manage` → full CRUD.
- Seeded **Teacher** gains `progress.manage` (plus existing attendance).
- **Admin** already `mode: "all"`. Accountant unchanged (no progress).

## Reports tab (Admin / Accountant)

The Reports page includes a **Student Progress** tab (next to Attendance Summary):

- On-screen paginated table: Admission No., Name, Class, Category, Month, plus progress metrics
- Filters: year (required), month (optional = all months), class, category
- Sorting on identity / month / hours / present days / progress %
- Narrow viewports: expand row for secondary fields
- Downloads: PDF (compact columns) and Excel (full field set) via
  `GET /api/v1/reports/student-progress` (+ `/summary` for JSON)

Gated by `reports.view` (not Teacher’s `progress` resource). Teachers capture data on `/progress`; management exports from Reports.

## Implementation steps

1. Prisma `MonthlyProgress` + PG/SQLite migrations; regenerate sqlite schema.
2. Shared Zod + `progress` resource in role catalog (default empty row for old matrices).
3. Repository, routes, upload helpers, audit on mutate/WhatsApp.
4. Seed Teacher permissions; build shared.
5. Client: schemas, types, api hooks, page/form/WhatsApp, nav + i18n.
6. Reports tab: summary JSON + PDF/Excel downloads; filters and responsive table.
7. Jest integration tests; typecheck.
