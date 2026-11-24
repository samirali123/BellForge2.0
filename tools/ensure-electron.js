// ensure-electron.js
//
// Makes sure the development copy of Electron is actually unpacked after
// `npm install`. On some setups (seen on Windows with Node 26) Electron's
// own install step downloads its zip but stops unpacking after the first
// file, leaving node_modules/electron/dist with only LICENSES.chromium.html
// and no path.txt, so `npm start` fails with "Electron failed to install
// correctly".
//
// When that's the case, this unpacks the same zip (from Electron's download
// cache, downloading it if needed) with the operating system's own unzip
// tool, and writes path.txt. When Electron is already fine it does nothing.
// Runs from app/package.json's postinstall, before brand-dev-electron.js.
// Never fails the install: at worst it explains what to do.

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

if (process.env.CI || process.env.ELECTRON_SKIP_BINARY_DOWNLOAD) process.exit(0);

const electronDir = path.join(__dirname, "..", "app", "node_modules", "electron");
const distDir = path.join(electronDir, "dist");
const pathTxt = path.join(electronDir, "path.txt");

// Where the executable lives inside dist on each platform (Electron's own
// install.js uses the same paths).
const EXE = {
  win32: "electron.exe",
  darwin: "Electron.app/Contents/MacOS/Electron",
  linux: "electron",
}[process.platform];

function installed() {
  try {
    const rel = fs.readFileSync(pathTxt, "utf8");
    return fs.existsSync(path.join(distDir, rel));
  } catch {
    return false;
  }
}

function unzip(zipPath, dest) {
  if (process.platform === "win32") {
    execFileSync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", "Expand-Archive -LiteralPath $args[0] -DestinationPath $args[1] -Force", zipPath, dest],
      { stdio: "inherit" }
    );
  } else if (process.platform === "darwin") {
    // ditto keeps the app bundle's symlinks and permissions intact.
    execFileSync("ditto", ["-x", "-k", zipPath, dest], { stdio: "inherit" });
  } else {
    execFileSync("unzip", ["-o", "-q", zipPath, "-d", dest], { stdio: "inherit" });
  }
}

async function main() {
  if (!EXE || !fs.existsSync(electronDir) || installed()) return;

  console.log("ensure-electron: Electron didn't finish unpacking; unpacking it again...");
  const { version } = require(path.join(electronDir, "package.json"));
  const { downloadArtifact } = require(require.resolve("@electron/get", { paths: [electronDir] }));
  // Returns the cached zip when Electron's install already downloaded it.
  const zipPath = await downloadArtifact({ version, artifactName: "electron", platform: process.platform, arch: process.arch });

  fs.rmSync(distDir, { recursive: true, force: true });
  fs.mkdirSync(distDir, { recursive: true });
  unzip(zipPath, distDir);
  fs.writeFileSync(path.join(distDir, "version"), version);
  fs.writeFileSync(pathTxt, EXE);

  if (!installed()) throw new Error(`${EXE} still isn't there after unpacking ${zipPath}`);
  console.log(`ensure-electron: Electron ${version} unpacked.`);
}

main().catch((err) => {
  console.warn(
    `ensure-electron: couldn't repair Electron (${err.message}).\n` +
      "  npm start may fail. Delete app/node_modules/electron and run npm install again,\n" +
      "  or see the README (Developing) for unpacking it by hand."
  );
  process.exit(0);
});
