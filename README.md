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
git clone https://github.com/<your-user>/vega && cd vega
cp .env.example .env            # at minimum, ANTHROPIC_API_KEY
pnpm install
pnpm setup                      # starts postgres, applies migrations, seeds demo data
pnpm dev                        # api :3000 · frontend :5174
pnpm create-admin               # create the first admin user
```

Grade one submission from the CLI, no LMS involved:

```bash
pnpm --filter @vega/core cli grade --activity tema04 --pdf exam.pdf
```

## Deployment (GitOps)

Every push to `main` publishes two images to GHCR:

- `ghcr.io/<your-user>/vega-api`
- `ghcr.io/<your-user>/vega-frontend`

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
