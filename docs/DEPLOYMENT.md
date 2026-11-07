# GitHub Pages + Supabase Free

The frontend is a static Next.js export. The backend target is Supabase Free; it is not connected to the public directory. No paid service is required by this configuration.

## GitHub Pages

1. In the repository Settings → Pages, set Source to **GitHub Actions**.
2. The `Verify and publish Pages` workflow runs on main and PRs. PRs verify only. Pushes to main deploy after verification.
3. The `github-pages` environment should allow deployments from main. Task branches cannot overwrite the published site.
4. Successful deployment URL: `https://owenpawl.github.io/Basic-Needs-Finder/`. Check the workflow's deployment result before describing the site as live.

The workflow uses only its built-in short-lived GitHub token. It does not receive a production database URL or service key. CI uses disposable PostgreSQL and fictional seed data. Build output contains the curated public resource directory. Fictional database/catalog fixtures are not imported by the public page. The directory needs no backend keys.

Reference: [GitHub Pages custom workflow documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).

## Supabase handoff

The user has opened project `zwmkhxflaznbsusmcncm`. Confirm the intended project in the dashboard before applying migrations. The foundation has only been migrated locally; it has not changed this hosted database.

Auth and inventory owners must implement tested RLS/RPC policies, university verification, photo upload restrictions, private message authorization, and transactional inventory behavior. Configure the GitHub Pages origin and redirect URL in Supabase Auth. Use only a publishable/anon key in browser build configuration. Store the database connection string in a local ignored environment or restricted CI migration secret. Do not pass it to the static build.

Only after those tasks pass should the frontend select live mode. Missing backend configuration must produce an explicit unavailable state, not silently redirect real actions into demo data. Free-plan limits and inactivity behavior are documented in [Supabase pricing](https://supabase.com/pricing).
