const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const {
  parseExportManifest,
  serializeExportManifest,
} = require("./export-utils");

const MANIFEST_FILENAME = "almost_gallery_output.json";

async function loadExportManifest(folder) {
  try {
    const contents = await fs.readFile(path.join(folder, MANIFEST_FILENAME), "utf8");
    return parseExportManifest(contents);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function saveExportManifest(folder, photoNames, options) {
  const manifestPath = path.join(folder, MANIFEST_FILENAME);
  const temporaryPath = path.join(folder, `.${MANIFEST_FILENAME}.${randomUUID()}.tmp`);
  const contents = serializeExportManifest(photoNames, options);

  try {
    await fs.writeFile(temporaryPath, contents, { encoding: "utf8", flag: "wx" });
    await fs.rename(temporaryPath, manifestPath);
  } finally {
    await fs.rm(temporaryPath, { force: true }).catch(() => {});
  }
  return manifestPath;
}

module.exports = {
  MANIFEST_FILENAME,
  loadExportManifest,
  saveExportManifest,
};
