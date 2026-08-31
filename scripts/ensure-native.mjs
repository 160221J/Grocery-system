import { createRequire } from "module";
import { spawnSync } from "child_process";

const require = createRequire(import.meta.url);

function loadAddon() {
  try {
    require("better-sqlite3");
    return { ok: true };
  } catch (error) {
    return { ok: false, error };
  }
}

const first = loadAddon();
if (first.ok) {
  process.exit(0);
}

const message = String(first.error?.message || "");
const code = first.error?.code;
const wrongOsBinary =
  code === "ERR_DLOPEN_FAILED" ||
  /invalid ELF header|not a valid Win32 application|wrong ELF class|is not a valid Win32/i.test(
    message
  );

if (code === "MODULE_NOT_FOUND") {
  console.error("better-sqlite3 is missing. Run npm install first.");
  process.exit(1);
}

if (!wrongOsBinary) {
  console.error(first.error);
  process.exit(1);
}

console.log(
  `[${process.platform}] better-sqlite3 was built for the other OS. Rebuilding...`
);

const rebuild = spawnSync("npm", ["rebuild", "better-sqlite3"], {
  stdio: "inherit",
  shell: true,
});

if (rebuild.status !== 0) {
  console.error(
    "Rebuild failed. On Windows install Visual Studio C++ Build Tools. On Linux install build-essential and python3."
  );
  process.exit(rebuild.status ?? 1);
}

const second = loadAddon();
if (!second.ok) {
  console.error(second.error);
  process.exit(1);
}

console.log(`[${process.platform}] better-sqlite3 is ready.`);
