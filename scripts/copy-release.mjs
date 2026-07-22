import { copyFileSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const releaseDir = join(root, "src-tauri", "target", "release");
const nsisDir = join(releaseDir, "bundle", "nsis");
const outDir = join(root, "releases");

mkdirSync(outDir, { recursive: true });

const portableExe = join(releaseDir, "screen-pen.exe");
if (!existsSync(portableExe)) {
  console.error(`Missing portable exe: ${portableExe}`);
  process.exit(1);
}
copyFileSync(portableExe, join(outDir, "screen-pen.exe"));
console.log("Copied screen-pen.exe → releases/");

if (!existsSync(nsisDir)) {
  console.error(`Missing NSIS bundle dir: ${nsisDir}`);
  process.exit(1);
}

const installers = readdirSync(nsisDir).filter((name) => name.endsWith(".exe"));
if (installers.length === 0) {
  console.error(`No NSIS installer found in ${nsisDir}`);
  process.exit(1);
}

for (const name of installers) {
  copyFileSync(join(nsisDir, name), join(outDir, name));
  console.log(`Copied ${name} → releases/`);
}

console.log(`\nInstallers ready in: ${outDir}`);
