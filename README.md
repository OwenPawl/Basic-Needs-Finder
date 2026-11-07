# Basic Needs Finder

A campus resource-sharing platform where students can offer, request, and collect free essentials through designated university exchange locations.

**Current status:** project planning and team setup. Application implementation has not started, and there is no runnable app yet.

## Build the first complete exchange

1. A verified student creates an offer or request.
2. Staff confirms receipt of a donated item at a campus location.
3. Another student discovers the available item and reserves it.
4. Staff confirms pickup; the reservation and inventory update together.
5. Students can message each other about a listing without publishing contact details.

An offered item is **not available inventory** until staff confirms its receipt. Concurrent reservations must never claim the same last item.

## Project documents

- [Original project plan](docs/PROJECT_PLAN.txt)
- [MVP scope and demonstration](docs/MVP.md)
- [Team tasks and acceptance criteria](docs/TEAM_TASKS.md)
- [Initial domain and inventory contract](docs/DOMAIN.md)
- [Agent contribution instructions](AGENTS.md)

The original plan is preserved in full. The MVP document separates the first release from subsequent work; it does not remove later requirements.

## Start contributing

```bash
git clone https://github.com/OwenPawl/Basic-Needs-Finder.git
cd Basic-Needs-Finder
git switch -c codex/your-task
```

Coordinate ownership on the team's mesh board before starting a task. Publish a task claim, work on a separate branch, and submit a pinned commit with verification notes for another participant to review. A teammate's agent runs on that teammate's own device and account.

The proposed stack follows the project plan: Next.js, TypeScript, Tailwind CSS, PostgreSQL, and Prisma. The foundation task will confirm the stack, add the application, and provide actual dependency, environment, migration, seed, development, and test commands. Do not treat placeholders as working setup instructions.

This public repository contains application source and project documents. Mesh credentials, private coordination data, student information, and environment secrets belong outside it. GitHub write access and mesh enrollment are separate.
