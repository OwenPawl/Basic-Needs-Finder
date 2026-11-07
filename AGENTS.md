# Working on Basic Needs Finder

Read README.md, docs/MVP.md, docs/DOMAIN.md, and the current task packet before implementation. docs/PROJECT_PLAN.txt preserves the user's original plan.

- Check the current repository state first. Preserve teammates' changes and keep work in a task-specific branch using the `codex/` prefix.
- Confirm live mesh ownership before shared work. Export a packet and checkpoint before handoff. Mesh tokens and local `.agent/` state never belong in this repository.
- Implement the assigned bounded task. Coordinate shared schema and interface changes before editing them across branches.
- Prioritize the complete MVP exchange before advanced carpooling or notification features.
- Enforce authorization and validation on the server. Avoid public contact details, hardcoded secrets, and production email-verification bypasses.
- Preserve the inventory invariants in docs/DOMAIN.md. Test concurrency against the actual database behavior, not just an in-memory imitation.
- Add meaningful tests for stock receipt, last-item contention, repeated commands, cancellation, expiry, pickup, and unauthorized access as those features are implemented.
- Use fictional seed data. Represent unknown allergen information honestly and keep food offerings within the supplied MVP restrictions.
- Keep installation, environment, database, seed, development, and test instructions accurate as real commands become available.
- Report what was implemented and verified. Do not mark work reviewed or demo-ready without the required independent review and integration evidence.

The repository initially contains planning documents only. Do not report a working application until it exists and has been exercised.
