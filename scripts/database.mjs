import { spawnSync } from "node:child_process";

const runtime = ["docker", "podman"].find(
  (tool) => spawnSync(tool, ["info"], { stdio: "ignore" }).status === 0,
);
if (!runtime)
  throw new Error(
    "Start Docker or Podman, then run this command again. Alternatively set DATABASE_URL to an existing PostgreSQL database.",
  );
const name = "basic-needs-finder-postgres";
function run(args) {
  const result = spawnSync(runtime, args, { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
const command = process.argv[2];
if (command === "stop") run(["stop", name]);
else if (command === "start") {
  const exists =
    spawnSync(runtime, ["container", "inspect", name], { stdio: "ignore" })
      .status === 0;
  if (exists) run(["start", name]);
  else
    run([
      "run",
      "--detach",
      "--name",
      name,
      "--publish",
      "127.0.0.1:55432:5432",
      "--env",
      "POSTGRES_USER=campus",
      "--env",
      "POSTGRES_PASSWORD=campus_local_only",
      "--env",
      "POSTGRES_DB=basic_needs",
      "--volume",
      "basic-needs-finder-data:/var/lib/postgresql/data",
      "docker.io/library/postgres:17-alpine",
    ]);
  let ready = false;
  for (let i = 0; i < 30; i++) {
    if (
      spawnSync(
        runtime,
        ["exec", name, "pg_isready", "-U", "campus", "-d", "basic_needs"],
        { stdio: "ignore" },
      ).status === 0
    ) {
      ready = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  if (!ready)
    throw new Error(
      "PostgreSQL did not become ready. Inspect the container logs.",
    );
  console.log(
    "PostgreSQL is ready at 127.0.0.1:55432. Data stays in the named volume when stopped.",
  );
} else throw new Error("Use start or stop.");
