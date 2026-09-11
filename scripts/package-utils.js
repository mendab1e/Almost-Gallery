const fs = require("node:fs/promises");
const path = require("node:path");

const KEPT_ELECTRON_LOCALES = new Set([
  "en.lproj",
  "en_GB.lproj",
]);

async function removeUnusedLocales(resourcesPath) {
  let entries;

  try {
    entries = await fs.readdir(resourcesPath, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return 0;
    throw error;
  }

  const unusedLocales = entries.filter((entry) => (
    entry.isDirectory()
    && entry.name.endsWith(".lproj")
    && !KEPT_ELECTRON_LOCALES.has(entry.name)
  ));

  await Promise.all(unusedLocales.map((entry) => (
    fs.rm(path.join(resourcesPath, entry.name), { recursive: true, force: true })
  )));

  return unusedLocales.length;
}

async function stripUnusedElectronLocales(buildPath) {
  const appPath = path.join(buildPath, "Electron.app", "Contents");
  const resourcePaths = [
    path.join(appPath, "Resources"),
    path.join(
      appPath,
      "Frameworks",
      "Electron Framework.framework",
      "Versions",
      "A",
      "Resources",
    ),
  ];

  const removedCounts = await Promise.all(
    resourcePaths.map(removeUnusedLocales),
  );

  return removedCounts.reduce((total, count) => total + count, 0);
}

module.exports = {
  KEPT_ELECTRON_LOCALES,
  removeUnusedLocales,
  stripUnusedElectronLocales,
};
