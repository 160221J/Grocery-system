import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { pipeline } from "stream/promises";
import { createWriteStream } from "fs";
import { Readable } from "stream";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nodeVersion = process.versions.node;
const cacheDir = path.join(root, ".package-cache");
const buildDir = path.join(root, "build");
const releaseDir = path.join(root, "release");
const distDir = path.join(root, "dist");

const targets = [
  {
    id: "windows-x64",
    label: "Windows",
    url: `https://nodejs.org/dist/v${nodeVersion}/node-v${nodeVersion}-win-x64.zip`,
    archiveName: `node-v${nodeVersion}-win-x64.zip`,
    extractedDir: `node-v${nodeVersion}-win-x64`,
    nodeFrom: "node.exe",
    nodeTo: "node.exe",
    starter: "Start Grocery Shop.bat",
    seaName: "GroceryShop.exe",
    kind: "zip",
  },
  {
    id: "linux-x64",
    label: "Linux",
    url: `https://nodejs.org/dist/v${nodeVersion}/node-v${nodeVersion}-linux-x64.tar.xz`,
    archiveName: `node-v${nodeVersion}-linux-x64.tar.xz`,
    extractedDir: `node-v${nodeVersion}-linux-x64`,
    nodeFrom: path.join("bin", "node"),
    nodeTo: "node",
    starter: "Start-Grocery-Shop.sh",
    seaName: "GroceryShop",
    kind: "tar.xz",
  },
  {
    id: "macos-arm64",
    label: "macOS (Apple Silicon)",
    url: `https://nodejs.org/dist/v${nodeVersion}/node-v${nodeVersion}-darwin-arm64.tar.gz`,
    archiveName: `node-v${nodeVersion}-darwin-arm64.tar.gz`,
    extractedDir: `node-v${nodeVersion}-darwin-arm64`,
    nodeFrom: path.join("bin", "node"),
    nodeTo: "node",
    starter: "Start Grocery Shop.command",
    seaName: "GroceryShop",
    kind: "tar.gz",
  },
];

function run(command, cwd = root) {
  execSync(command, { cwd, stdio: "inherit" });
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeStarter(target, destDir) {
  const starterPath = path.join(destDir, target.starter);
  if (target.id.startsWith("windows")) {
    fs.writeFileSync(
      starterPath,
      [
        "@echo off",
        "title Grocery Shop",
        'cd /d "%~dp0"',
        "set SHOPFLOW_OPEN_BROWSER=1",
        "echo.",
        "echo  Grocery Shop is starting...",
        "echo  A browser window should open. If not, visit http://localhost:3000",
        "echo  Leave this window open while you use the shop.",
        "echo  Close this window to stop the shop.",
        "echo.",
        "node.exe server.cjs",
        "echo.",
        "echo  Grocery Shop has stopped.",
        "pause",
        "",
      ].join("\r\n"),
    );
    return;
  }

  const nodeCmd = target.id.startsWith("linux") || target.id.startsWith("macos") ? "./node" : "node";
  fs.writeFileSync(
    starterPath,
    [
      "#!/bin/sh",
      'cd "$(dirname "$0")"',
      "export SHOPFLOW_OPEN_BROWSER=1",
      'echo "Grocery Shop is starting..."',
      'echo "If the browser does not open, visit http://localhost:3000"',
      'echo "Leave this window open while you use the shop."',
      `${nodeCmd} server.cjs`,
      "",
    ].join("\n"),
    { mode: 0o755 },
  );
}

function writeFolderReadme(target, destDir) {
  fs.writeFileSync(
    path.join(destDir, "README.txt"),
    [
      `Grocery Shop — ${target.label}`,
      "",
      "This folder does not need Node.js or npm.",
      "",
      `1. Copy this whole folder to the shop computer.`,
      `2. Double-click: ${target.starter}`,
      "3. Use the shop in your browser at http://localhost:3000",
      "4. Leave the black/terminal window open while you work.",
      "5. Close that window to stop the shop.",
      "",
      "Your products, sales, and stock are saved in grocery.db in this folder.",
      "Copy grocery.db if you want to move or back up the shop data.",
      "",
    ].join("\n"),
  );
}

function walkFiles(dir, relative = "") {
  const entries = [];
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const rel = relative ? `${relative}/${name}` : name;
    if (fs.statSync(full).isDirectory()) {
      entries.push(...walkFiles(full, rel));
    } else {
      entries.push({ full, rel });
    }
  }
  return entries;
}

async function download(url, dest) {
  if (fs.existsSync(dest)) {
    console.log(`Using cached ${path.basename(dest)}`);
    return;
  }
  console.log(`Downloading ${url}`);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`);
  }
  await pipeline(Readable.fromWeb(response.body), createWriteStream(dest));
}

function extractArchive(target, archivePath, extractTo) {
  const outDir = path.join(extractTo, target.extractedDir);
  if (fs.existsSync(path.join(outDir, target.nodeFrom))) {
    return outDir;
  }
  ensureDir(extractTo);
  if (target.kind === "zip") {
    run(`unzip -q -o "${archivePath}" -d "${extractTo}"`);
  } else if (target.kind === "tar.xz") {
    run(`tar -xJf "${archivePath}" -C "${extractTo}"`);
  } else {
    run(`tar -xzf "${archivePath}" -C "${extractTo}"`);
  }
  return outDir;
}

function stripPeSignature(src, dest) {
  const script = `
import struct, sys
src, dest = sys.argv[1], sys.argv[2]
data = bytearray(open(src, "rb").read())
if data[:2] != b"MZ":
    raise SystemExit("not a PE file")
e_lfanew = struct.unpack_from("<I", data, 0x3C)[0]
if data[e_lfanew:e_lfanew+4] != b"PE\\x00\\x00":
    raise SystemExit("missing PE header")
magic = struct.unpack_from("<H", data, e_lfanew + 24)[0]
if magic == 0x20B:
    data_dirs = e_lfanew + 24 + 112
elif magic == 0x10B:
    data_dirs = e_lfanew + 24 + 96
else:
    raise SystemExit(f"unknown optional header {magic:#x}")
cert_entry = data_dirs + 32
rva, size = struct.unpack_from("<II", data, cert_entry)
struct.pack_into("<II", data, cert_entry, 0, 0)
struct.pack_into("<I", data, e_lfanew + 24 + 64, 0)
if rva and size and rva < len(data):
    data = data[:rva]
open(dest, "wb").write(data)
print(f"stripped Authenticode rva={rva} size={size}")
`;
  const pyPath = path.join(buildDir, "strip-pe-signature.py");
  fs.writeFileSync(pyPath, script);
  run(`python3 "${pyPath}" "${src}" "${dest}"`);
}

function buildSeaConfig() {
  const assets = {};
  for (const file of walkFiles(distDir)) {
    assets[file.rel] = path.relative(root, file.full);
  }
  const config = {
    main: path.relative(root, path.join(buildDir, "server.cjs")),
    output: path.relative(root, path.join(buildDir, "sea-prep.blob")),
    disableExperimentalSEAWarning: true,
    useCodeCache: false,
    assets,
  };
  const configPath = path.join(buildDir, "sea-config.json");
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  return configPath;
}

function tryBuildSea(target, nodeSource, destFile) {
  try {
    ensureDir(path.dirname(destFile));
    if (target.id.startsWith("windows")) {
      stripPeSignature(nodeSource, destFile);
    } else {
      fs.copyFileSync(nodeSource, destFile);
    }
    fs.chmodSync(destFile, 0o755);
    const blob = path.join(buildDir, "sea-prep.blob");
    const extra = target.id.startsWith("macos") ? " --macho-segment-name NODE_SEA" : "";
    run(
      `npx --yes postject "${destFile}" NODE_SEA_BLOB "${blob}" --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2${extra}`,
    );
    console.log(`Created single-file app: ${destFile}`);
    return true;
  } catch (error) {
    console.warn(`Could not build a single-file app for ${target.id}: ${error.message}`);
    if (fs.existsSync(destFile)) {
      fs.rmSync(destFile);
    }
    return false;
  }
}

function zipFolder(folderPath, zipPath) {
  if (fs.existsSync(zipPath)) {
    fs.rmSync(zipPath);
  }
  run(`zip -q -r "${zipPath}" "${path.basename(folderPath)}"`, path.dirname(folderPath));
}

async function main() {
  ensureDir(cacheDir);
  ensureDir(buildDir);
  fs.rmSync(releaseDir, { recursive: true, force: true });
  ensureDir(releaseDir);

  console.log("Building web app...");
  run("npx vite build");

  console.log("Bundling server...");
  const esbuild = await import("esbuild");
  await esbuild.build({
    entryPoints: [path.join(root, "server.ts")],
    bundle: true,
    platform: "node",
    format: "cjs",
    outfile: path.join(buildDir, "server.cjs"),
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
    legalComments: "none",
    logLevel: "info",
  });

  const seaConfig = buildSeaConfig();
  console.log("Preparing single-file payload...");
  run(`node --experimental-sea-config "${seaConfig}"`);

  const notes = [
    "Grocery Shop — copy to any computer",
    "",
    "You do not need Node.js or npm on the shop computer.",
    "",
  ];

  for (const target of targets) {
    console.log(`\nPackaging ${target.label}...`);
    const archivePath = path.join(cacheDir, target.archiveName);
    await download(target.url, archivePath);
    const extracted = extractArchive(target, archivePath, cacheDir);
    const nodeSource = path.join(extracted, target.nodeFrom);
    if (!fs.existsSync(nodeSource)) {
      throw new Error(`Node binary missing: ${nodeSource}`);
    }

    const folderName = `GroceryShop-${target.id}`;
    const destDir = path.join(releaseDir, folderName);
    ensureDir(destDir);
    fs.copyFileSync(nodeSource, path.join(destDir, target.nodeTo));
    fs.chmodSync(path.join(destDir, target.nodeTo), 0o755);
    fs.copyFileSync(path.join(buildDir, "server.cjs"), path.join(destDir, "server.cjs"));
    fs.cpSync(distDir, path.join(destDir, "dist"), { recursive: true });
    writeStarter(target, destDir);
    writeFolderReadme(target, destDir);

    const seaPath = path.join(destDir, target.seaName);
    const seaOk = tryBuildSea(target, nodeSource, seaPath);

    const zipStageRoot = path.join(releaseDir, "_zips");
    const zipDir = path.join(zipStageRoot, folderName);
    ensureDir(zipDir);
    if (seaOk) {
      fs.copyFileSync(seaPath, path.join(zipDir, target.seaName));
      fs.chmodSync(path.join(zipDir, target.seaName), 0o755);
      fs.writeFileSync(
        path.join(zipDir, "README.txt"),
        [
          `Grocery Shop — ${target.label}`,
          "",
          `1. Unzip this folder onto the shop computer (Desktop is fine).`,
          `2. Double-click: ${target.seaName}`,
          "3. Use the shop in your browser at http://localhost:3000",
          "4. Leave the black/terminal window open while you work.",
          "5. Close that window to stop the shop.",
          "",
          "The shop computer does not need Node.js or npm.",
          "Your products and sales are saved in grocery.db next to the app.",
          "Copy grocery.db if you want to back up or move the shop data.",
          "",
          "Windows may show a SmartScreen warning because the file is unsigned.",
          "Choose More info → Run anyway.",
          "",
        ].join("\n"),
      );
    } else {
      fs.cpSync(destDir, zipDir, { recursive: true });
    }

    const zipPath = path.join(releaseDir, `${folderName}.zip`);
    zipFolder(zipDir, zipPath);

    notes.push(`${target.label}:`);
    notes.push(`  Unzip ${folderName}.zip`);
    notes.push(`  Double-click: ${seaOk ? target.seaName : target.starter}`);
    notes.push("");
  }

  fs.rmSync(path.join(releaseDir, "_zips"), { recursive: true, force: true });

  notes.push("Open http://localhost:3000 if a browser does not open.");
  notes.push("Leave the app window open while you use the shop.");
  notes.push("grocery.db in the same folder is your shop data.");
  notes.push("");
  fs.writeFileSync(path.join(releaseDir, "HOW-TO-RUN.txt"), notes.join("\n"));
  console.log("\nDone. Copy a zip from the release/ folder to the shop computer.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
