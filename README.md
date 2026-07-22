<img src="brand/vega-icon.svg" alt="" width="72" height="72">

# Vega

**An AI grading and forum-answering engine for Moodle — the teacher always has the final word.**

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-5B39FF.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-22-5FA04E?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-6-646CFF?logo=vite&logoColor=white)](https://vite.dev/)
[![Fastify](https://img.shields.io/badge/Fastify-5-000000?logo=fastify&logoColor=white)](https://fastify.dev/)

[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Drizzle](https://img.shields.io/badge/Drizzle-ORM-C5F74F?logo=drizzle&logoColor=black)](https://orm.drizzle.team/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-3-06B6D4?logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)
[![Claude](https://img.shields.io/badge/Claude-API-D97757?logo=anthropic&logoColor=white)](https://docs.anthropic.com/)
[![Moodle](https://img.shields.io/badge/Moodle-3%2B-F98012?logo=moodle&logoColor=white)](https://moodle.org/)
[![Docker](https://img.shields.io/badge/Docker-GHCR-2496ED?logo=docker&logoColor=white)](https://docs.docker.com/)
[![CI](https://img.shields.io/badge/CI-GitHub_Actions-2088FF?logo=githubactions&logoColor=white)](.github/workflows)
[![pnpm](https://img.shields.io/badge/pnpm-workspaces-F69220?logo=pnpm&logoColor=white)](https://pnpm.io/)

---

Teaching staff lose hours to two repetitive jobs: marking submissions and answering the same
questions in course forums. Vega takes both on as a first pass, then hands the result to the
teacher to edit and approve. It reads your Moodle, drafts the work, and waits.

## What Vega does

Vega watches the Moodle activities you choose and handles two distinct jobs. They share the same
engine but differ in one decisive way — **whether a grade is involved.**

| | **Assignment submissions** | **Forum questions** |
|---|---|---|
| Moodle activity | `mod_assign` | `mod_forum` |
| What the student sends | A file (PDF, image, document) | A written post |
| What Vega drafts | Per-criterion scores + feedback | A reply to the question |
| Grade published? | **Yes** — score and feedback | **No** — never. Feedback only |
| Teacher's job | Adjust the marks, approve | Edit the reply, approve |

The distinction runs all the way down the stack: an activity's `kind` is `assignment` or `forum`,
and for a forum the grade is structurally `null` — there is no field for the connector to fill in
and no code path that writes a mark back to Moodle.

## How it works

```
                    ┌─ Moodle ────────────────────────┐
                    │  assignment inbox    forum       │
                    └────────┬───────────────┬─────────┘
                             │               │
                    scheduled batch pulls new work
                             │               │
                  file submission        forum post
                             │               │
                  transcription (OCR)        │
                             │               │
                             └───────┬───────┘
                                     ▼
                      AI drafts against your context
                       (global → activity kind → activity)
                                     │
                                     ▼
                    📱 review queue — teacher edits and approves
                                     │
                     ┌───────────────┴───────────────┐
                     ▼                               ▼
             grade + feedback                  forum reply
             published to Moodle             posted to Moodle
```

**Human in the loop by design.** The AI proposes; the teacher disposes. Low-confidence drafts and
transcription doubts arrive flagged. Nothing reaches a student without approval — and per activity
you can loosen that to *review only the uncertain ones* once you trust the results, or keep full
review forever.

## Any subject, not just maths

Vega has no subject baked in. What the AI knows about your course lives entirely in Markdown files
you write — **the prompts are the personalisation**, and they layer in three levels:

```
contexts/global.md                     department-wide policy: tone, rounding, how strict to be
contexts/activity-kinds/<kind>.md      what matters in this format of work
contexts/activities/<slug>.md          this specific assignment or forum
```

More specific layers add to and qualify the general ones; they never erase them. So a maths
department writes rules about method marks and algebraic rigour, while a Spanish literature
department writes about argument structure and register — same engine, different Markdown.

Handwriting transcription and LaTeX rendering ship in the box because handwritten work is common
and hard, not because Vega is a maths tool. A course with typed submissions simply never triggers
the OCR path.

> These context files are the seed shipped with the repository. Once running, teachers edit the
> same three levels from the app — see [`contexts/README.md`](contexts/README.md) for how files and
> database rows relate.

## The AI engine

The design in [`docs/motor-ia.md`](docs/motor-ia.md) is built around one claim, and it is worth
stating plainly because everything else follows from it:

> **A language model will sometimes be wrong. The point is not to pretend otherwise — it is to make
> being wrong *detectable*.**

Vega does that by never letting the model assert something about a student without pointing at the
evidence. Every deduction carries a **literal quote** from the student's own work, and a separate
pass checks — *in code, not with another model* — that the quote actually exists. A fabricated
quote stops being a plausible sentence and becomes a failed string lookup.

Five stages, of which the two cheapest do the most work:

| Stage | Runs on | Cost | What it does |
|---|---|---|---|
| **0 · Triage** (forum only) | cheap model, **blind** to the course context | cents | Sorts a question into *typo · admin · easy · hard · not a question*. Typos are parked at **zero** grading cost |
| **1 · Transcription** | standard model, vision | — | Handwriting → LaTeX. Marks `[ILLEGIBLE]` / `[DOUBT]` rather than guessing |
| **2 · Grading** | expert model, adaptive thinking | the bulk | Per-criterion marks and feedback, each deduction with its literal quote |
| **3 · Mechanical check** | **your code — no model at all** | **zero** | Does every quote exist? Does the arithmetic add up? Exact, always on, not switchable off |
| **4 · AI check** | standard model, **disjoint context** | ~€0.02 | Does the feedback agree with the mark? Are the flagged steps sound? |

Stage 4 deliberately never sees the grading context. A verifier that inherits the grader's
reasoning is not a second opinion.

**What it costs.** About **€0.17** per handwritten submission, **€0.01** per easy question, **€0.07**
per hard one, and **€0** for a typo. Roughly **€54/month** for a mid-sized academy — less than a
couple of hours of the teaching time it gives back.

**What it does not do.** Decide. The mark that reaches a student is signed by a person
([ADR 0004](docs/decisiones/0004-validacion-humana-obligatoria.md)). If the verification failed or
was skipped, autonomous publishing is vetoed in code, not in a comment.

## Writing contexts: what actually changes the output

The prompts *are* the product configuration, so this section is the closest thing Vega has to a
manual. Full guidance lives in [`contexts/README.md`](contexts/README.md); the shape of each layer
is in [`docs/motor-ia.md`](docs/motor-ia.md).

**Write instructions, not a syllabus.** The reader is a corrector, not a student. «Deduct 0.25 for
not stating the domain» does work; «value rigour» does not. Every rule should be one you could
check someone followed.

**Put numbers on it wherever a mark is involved.** Vagueness is where a model invents its own
policy, and it will invent a different one each night.

**Never write anything that invites the model to fill a gap.** The single most dangerous phrase in
a grading prompt is any variant of *"if unclear, assume…"*. The rule that replaces it: say what is
missing, lower the confidence, and let the teacher look. Nine of these prompts were rewritten after
an adversarial review found exactly this pattern hiding in wording that read as helpful.

**Don't repeat a higher layer.** Every line travels on every single call and is paid for on every
single call. Reference it instead — «global §8 applies». Duplication is also how contradictions
start.

**Keep it short enough to read in one screen.** A per-activity context longer than that usually
contains material that belongs one layer up.

### Which layer does a rule belong to?

| If the rule… | it goes in |
|---|---|
| defines the house standard of rigour and format for the whole installation (admin-only) | `installation` |
| is department policy on marking — tone, carry-through errors, rounding | `global` |
| distinguishes a graded submission from a forum reply | `activity_kind` |
| describes a *format* shared by many activities (exam-style problem, theory essay, syllabus document) | `template` |
| is about this one assignment's typical mistakes | `activity` |

### Uploading material: `.tex`, plain text, or PDF?

This trips people up, so it is worth being blunt about it.

| You have… | Do this | Why |
|---|---|---|
| A reference solution in LaTeX | **Upload the `.tex`** | It is text: it goes into the prompt verbatim and gets cached with the rest of the context. Best possible fidelity for notation |
| Notes, a marking matrix, expected contents | **Upload `.md` or `.txt`** | Same path. A matrix as a plain list of items is far easier for the model to work through than a formatted table image |
| A short excerpt (a statement, one rule) | **Paste it into the activity context** | Not worth a file. It ends up in the same prompt either way |
| Legislation, a long regulation | **Upload as text, split by article** | Article-level segmentation is what lets the engine quote *document + article + literal text* — and lets the code verify that quote exists |
| A PDF or an image | **Convert it to text first** | ⚠️ **Vega stores no bytes for binaries.** A PDF attached as *context* is registered as a reference with `hasContent: false` and **its content never reaches the model.** The UI says so rather than pretending otherwise |
| A student's handwritten exam | **Upload as PDF/photo — that is the point** | This is the *submission* path, not the context path. It goes through vision transcription |
| A `.docx` | Extracted to text on upload | Only the extracted text is used |

The rule of thumb: **anything you want the model to read must exist as text.** If you are unsure
whether something actually reached the model, don't guess — open
`GET /api/contexts/resolved/{activityId}`, which shows the exact merged context that gets sent.

## Features

- **Course and activity discovery** — pick a course from Moodle, see its assignments and forums,
  and choose which ones Vega should watch.
- **Three-level grading context**, all teacher-editable Markdown: global policy → activity kind →
  the individual activity, plus a reference solution and points allocation where a grade applies.
- **Handwriting OCR** with Claude vision: full transcription to LaTeX with `[ILEGIBLE]` / `[DUDA]`
  markers, shown side by side with the original scan.
- **Mobile-first review** — swipe between original, transcription and draft; adjust per-criterion
  marks, edit the feedback, approve with your thumb.
- **LMS connectors** behind a minimal interface (`listSubmissions`, `download`, `publishGrade`,
  `publishFeedbackFile`). Moodle 3 ships first; a filesystem connector covers use without an LMS.
  PRs for other platforms welcome.
- **Cost control** — batch runs grouped by activity exploit prompt caching and Anthropic's Batches
  API. Token usage and cost per correction are measured, and the dashboard lets you drill from a
  period's total spend down to the activities that caused it.
- **Self-contained** — its own users (teacher / admin roles), settings screen, installable as a
  PWA, no external identity provider required.

## Stack

TypeScript end to end, in a pnpm monorepo:

| Layer | Choice |
|---|---|
| API | Node 22 + Fastify 5, Zod validation, types shared with the frontend |
| Frontend | React 18 + Vite 6 + Tailwind, PWA, KaTeX rendering |
| Database | PostgreSQL 16 · Drizzle ORM, versioned flat SQL migrations |
| AI | Anthropic SDK (Messages + Batches, prompt caching) |
| Packaging | Multi-stage Docker → GitHub Container Registry (GHCR) |
| CI/CD | GitHub Actions: lint + tests on PRs; image build and push on `main` |

```
apps/api         Fastify server (also applies migrations on boot)
apps/frontend    React PWA — the teacher's working app
packages/core    grading engine — pure, LMS-agnostic, runnable from the CLI
packages/shared  Zod schemas and types shared by api / frontend / core
connectors/      lms interface + moodle3/ + filesystem/
contexts/        teacher-authored Markdown contexts (versioned in git)
brand/           design tokens and the master icon
deploy/          docker-compose.prod.yml + reverse-proxy notes
docs/            design docs, user stories, decision records
```

## Quick start (development)

```bash
git clone https://github.com/jamataran/vega && cd vega
cp .env.example .env            # at minimum, ANTHROPIC_API_KEY
pnpm install
pnpm setup                      # starts postgres, applies migrations
pnpm dev                        # api :3000 · frontend :5174
```

The API creates an initial admin on first boot **only when the database has no users at all** —
`admin@vega.local` / `admin` unless you override `BOOTSTRAP_ADMIN_EMAIL` and
`BOOTSTRAP_ADMIN_PASSWORD`. Change that password immediately; it is printed as a warning on every
boot until you do. Everyone else is created from the Users screen.

**A fresh install starts empty**: no courses, no activities, no submissions. Nothing is ever seeded
automatically beyond the grading contexts from `contexts/`, which are configuration rather than
sample data. To get demo content while working on the UI without a Moodle in front of you:

```bash
pnpm db:demo                    # WIPES the database, then loads sample data
```

It refuses to run with `NODE_ENV=production`.

Grade one submission from the CLI, no LMS involved:

```bash
pnpm --filter @vega/core cli grade --activity tema04 --pdf exam.pdf
```

## Deployment (GitOps)

Every push to `main` publishes two images to GHCR:

- `ghcr.io/jamataran/vega-api`
- `ghcr.io/jamataran/vega-frontend`

Point your orchestrator (a Portainer stack, plain compose, …) at
[`deploy/docker-compose.prod.yml`](deploy/docker-compose.prod.yml). **Schema changes travel inside
the API image**: versioned SQL migrations are applied idempotently on container start, so your
GitOps flow only ever deploys images — no manual migration step. Health endpoints for the reverse
proxy: `GET /api/health` (checks the database) and `/health.txt` on the frontend.

TLS and routing are your reverse proxy's job (nginx, Plesk, Traefik…); see
[`deploy/README.md`](deploy/README.md).

## Configuration and branding

All secrets come from environment variables — [`.env.example`](.env.example) is the reference:
database URL, JWT secret, Anthropic API key, SMTP for batch summaries, LMS credentials.

Put your own institution's face on it without forking — mount a logo and set a name:

```yaml
services:
  frontend:
    volumes:
      - ./branding/logo.png:/usr/share/nginx/html/branding/logo.png:ro
    environment:
      - BRAND_NAME=Example Academy
```

## Connecting Vega to Moodle

Vega talks to Moodle over its REST web services. None of that is on by default, and creating an
external service adds **no functions to it** — you list them one by one. Missing that step is what
produces the first error nearly everyone hits:

```
core_webservice_get_site_info (accessexception): Excepción al control de acceso
```

On a token Moodle otherwise accepts, `accessexception` almost always means *this function is not in
the service*, not *this token is wrong*.

> **Not yet verified against a real Moodle.** The `moodle3` connector is written from the Moodle 3.x
> documentation and is being exercised against a live installation for the first time right now.
> Function names, response shapes and the file download path may still be wrong. The default
> connector in development remains the mock. Separately, `publishFeedbackFile` is unresolved: Moodle
> 3 exposes no clean web service for the `assignfeedback_file` area, so the annotated PDF has no
> route back into Moodle yet — `publishGrade` does carry the score and the feedback as HTML.

Admin paths below use the English Moodle labels; a Spanish install reads *Administración del
sitio → …*.

### 1. Enable web services and REST

1. *Site administration → Advanced features* → tick **Enable web services**.
2. *Site administration → Server → Web services → Manage protocols* → enable **REST protocol**.

Every call goes to one endpoint — `https://<your-moodle>/webservice/rest/server.php` — and is told
apart by a `wsfunction` parameter. Moodle returns its errors with HTTP 200 and a JSON body, so
`curl` against that URL shows you the real reason for a failure.

### 2. Create an external service and add its functions

*Site administration → Server → Web services → External services* → **Add**. Name it (`Vega`), tick
**Enabled**, save, then follow the service's **Functions** link and add the ones below. Nothing is
added for you.

Only course and activity discovery is implemented today (M2). The ingest and publishing calls exist
in the connector but no route or batch job reaches them yet, so the second table is what you will
need later, not now.

**Needed now — course and activity discovery**

| Function | What Vega uses it for |
|---|---|
| `core_webservice_get_site_info` | Identifies the token's owner (`userid`, `username`, `sitename`). The `userid` is not decorative — the next call requires it and the token reveals it nowhere else. Cheapest possible liveness check for a credential |
| `core_enrol_get_users_courses` | The courses the token's owner is enrolled in. **This is the course picker** |
| `mod_assign_get_assignments` | The assignments of the selected course |
| `mod_forum_get_forums_by_courses` | The forums of the selected course |

**Needed later — submission ingest and grade publishing (M3+)**

| Function | What Vega will use it for |
|---|---|
| `mod_assign_get_submissions` | Pull submitted attempts and the URLs of the attached files |
| `mod_forum_get_forum_discussions_paginated` | Read forum discussions. The connector still refuses forum ingest outright |
| `mod_assign_save_grade` | Write the score back, with the feedback as HTML in the comments editor |

Downloading a submission is not a web service call: files come from `pluginfile.php` signed with the
same token, so no extra function is involved. `core_course_get_contents` appears in the connector's
function map but no code path calls it — don't bother adding it yet.

### 3. Capabilities of the token's owner

A Moodle token carries its owner's permissions, no more. The owner needs:

- **`webservice/rest:use`** — required for any REST call at all. If a function is in the service and
  the call still fails, this is the next thing to check. It is also worth confirming the user is an
  authorised user of the service when you restricted it to a list.
- **Read access to the courses in question.** In practice a teacher enrolled with an editing role
  already has it; the functions above return only what that user could see in the web interface.

Beyond `webservice/rest:use`, Vega asserts no capability of its own and there is nothing in the
codebase that checks one, so treat the rest as *probable*, derived from what each function does
rather than from anything we have verified: `moodle/course:view` matters for courses the user is not
enrolled in, `mod/assign:view` for listing assignments, `mod/forum:viewdiscussion` for forums, and
`mod/assign:grade` for publishing scores once M3 lands. An enrolled teacher normally has all of
them.

### 4. Issue the token — one per teacher

*Site administration → Server → Web services → Manage tokens* → **Create token**, choosing the user
and the service you just created.

**In Vega the token belongs to each teacher, not to the installation.** This is forced by Moodle,
not a preference: `core_enrol_get_users_courses` returns the courses of *the token's owner*, so a
shared token would show every teacher the same person's courses — and hand out that person's Moodle
permissions along with them. The URL and the connector, by contrast, are installation-wide and set
once by an admin.

Each teacher pastes their own token in *Settings → My Moodle connection*. Waiting for every teacher
to navigate their own security keys is, in practice, the difference between deploying Vega in an
afternoon and not deploying it, so an admin may also issue tokens on other users' behalf and paste
them from the Users screen. Either way the value is write-only: no API response ever returns a
token, not even to whoever just saved it. See
[`docs/decisiones/0010-credencial-moodle-por-usuario.md`](docs/decisiones/0010-credencial-moodle-por-usuario.md)
for the full reasoning and its costs — the token is stored unencrypted in Postgres, which is a known
and unresolved limitation.

### 5. Environment variables

```bash
LMS_CONNECTOR=moodle3                        # mock (default) · filesystem · moodle3
MOODLE_BASE_URL=https://moodle.example.org   # site root, no /webservice/... suffix
```

Both are the *initial* values only: once an admin saves them in Settings they live in `app_settings`
and that copy wins over the environment.

`MOODLE_TOKEN` also exists but is **a development seed, nothing more**. `pnpm db:demo` assigns it to
the two demo users so that testing against a real Moodle does not mean re-pasting a token after
every reseed; no runtime path reads it. For local credentials use `.env.local` — it is gitignored
and loaded after `.env`, so it overrides the shared file without editing it.

### 6. When it fails

| Moodle says | What it usually means |
|---|---|
| `accessexception` | The function named in the message is not in the external service, or the owner is not authorised for a restricted service. Add exactly the function Vega names |
| `invalidtoken` | Token mistyped, truncated on paste, revoked, or issued for a different service. Reissue it |
| `Invalid parameter value detected` | Moodle rejected an argument — most often a course id that is not numeric, or a response shape that differs on your Moodle version. Treat it as a connector bug and report it, not as something to fix in Moodle |
| HTML instead of JSON | Web services off, REST protocol disabled, or `MOODLE_BASE_URL` pointing somewhere that is not the Moodle root. You are seeing the login page |
| Valid token, zero courses | The owner is enrolled in no courses, or `core_enrol_get_users_courses` is missing from the service |

**Test connection** in Settings — and, for an admin, on any user in the Users screen — probes **every
function required for discovery, one by one, and does not stop at the first failure**. Moodle adds no
functions when you create a service, so it is normal for several to be missing at once; stopping
early would mean one trip to the Moodle panel per missing function. You get the full list back, each
entry naming the exact function to add.

Results come back as a normal `200` — a rejected token is the answer to the question, not a server
error — with one of three states per function:

| State | Meaning |
|---|---|
| ✓ | Moodle answered. The row shows what came back: site and user, course count, forums found |
| ✗ | Moodle rejected it. The row carries the error text and the function name to add to the service |
| – | Not checked, because it depends on one that failed. Only `core_enrol_get_users_courses` can land here: it needs the `userid` that `core_webservice_get_site_info` returns |

A `–` is deliberately not a failure. Reporting it as one would send you off to enable a function that
is probably already there. The two activity functions are probed regardless of whether the token
could be identified, since they take a course list and need no `userid`.

The ingest and publishing functions are **not** probed: nothing calls them yet, and they are listed
above as needed later.

## Privacy

Student submissions are sent to the Anthropic API for transcription and drafting. Whoever deploys
Vega is responsible for reflecting that in their privacy policy (GDPR). Vega minimises exposure by
sending internal identifiers rather than student names.

## Roadmap

Development runs in milestones; each one is shippable on its own.

| | Milestone | State |
|---|---|---|
| **M1** | Login, app shell and CI/CD working end to end | In progress |
| **M2** | Activity configuration: pull courses and activities from Moodle and choose what to watch | Next |
| **M3** | Batch pipeline running against a mocked Anthropic API | Planned |
| **M4** | Real API calls, drafts visible in the app | Planned |
| **M5** | Fully functional application | Planned |

Beyond that: Moodle 4+ connector · Canvas connector · multi-tenant mode · AI-vs-teacher deviation
analytics. User stories live in [`docs/hu/`](docs/hu/), architecture and decision records in
[`docs/`](docs/).

## License

[AGPL-3.0](LICENSE). You may self-host, modify and use Vega commercially; if you offer a modified
version as a network service, you must share your changes. Configuring branding (logo, name) is not
a modification.
