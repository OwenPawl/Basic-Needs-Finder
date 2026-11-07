import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const repository =
  process.env.GITHUB_REPOSITORY?.split("/")[1] ?? "Basic-Needs-Finder";
const result = spawnSync(
  process.execPath,
  ["node_modules/next/dist/bin/next", "build"],
  {
    stdio: "inherit",
    env: { ...process.env, NEXT_PUBLIC_BASE_PATH: `/${repository}` },
  },
);
if (result.status !== 0) process.exit(result.status ?? 1);
writeFileSync("out/.nojekyll", "");
