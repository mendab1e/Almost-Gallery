const fs = require("node:fs/promises");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { packager } = require("@electron/packager");

const root = path.resolve(__dirname, "..");
const dist = path.join(root, "dist");
const productName = "Almost Gallery";

async function build() {
  await fs.mkdir(dist, { recursive: true });

  const appPaths = await packager({
    dir: root,
    out: dist,
    name: productName,
    platform: "darwin",
    arch: process.arch,
    overwrite: true,
    asar: true,
    prune: true,
    appBundleId: "com.almostgallery.app",
    appCategoryType: "public.app-category.photography",
    ignore: [
      /^\/dist(?:\/|$)/,
      /^\/test(?:\/|$)/,
      /^\/scripts(?:\/|$)/,
      /^\/README\.md$/,
    ],
  });

  if (appPaths.length !== 1) {
    throw new Error(`Expected one packaged app, received ${appPaths.length}.`);
  }

  const appPath = path.join(appPaths[0], `${productName}.app`);
  const architecture = process.arch === "arm64" ? "arm64" : "x64";
  const zipPath = path.join(dist, `Almost-Gallery-${architecture}.zip`);
  const dmgPath = path.join(dist, `Almost-Gallery-${architecture}.dmg`);

  await Promise.all([
    fs.rm(zipPath, { force: true }),
    fs.rm(dmgPath, { force: true }),
  ]);

  await run("ditto", [
    "-c",
    "-k",
    "--sequesterRsrc",
    "--keepParent",
    appPath,
    zipPath,
  ]);

  await run("hdiutil", [
    "create",
    "-volname",
    productName,
    "-srcfolder",
    appPath,
    "-ov",
    "-format",
    "UDZO",
    dmgPath,
  ]);

  console.log(`Created ${appPath}`);
  console.log(`Created ${zipPath}`);
  console.log(`Created ${dmgPath}`);
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit" });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with code ${code}.`));
    });
  });
}

build().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
