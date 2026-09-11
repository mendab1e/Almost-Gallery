const fs = require("node:fs/promises");
const path = require("node:path");
const { outputName, validateOptions } = require("./export-utils");
const { validateAlbumPhotos } = require("./album-validation");
const { saveExportManifest } = require("./manifest-store");

const activeExports = new Set();

const OUTPUT_DIRECTORY = "output";
const STAGING_DIRECTORY = ".almost_gallery_output_staging";
const BACKUP_DIRECTORY = ".almost_gallery_output_backup";

async function exportAlbum({
  folder,
  photos,
  options,
  runMagick,
  onProgress = () => {},
  saveManifest = saveExportManifest,
}) {
  const validatedOptions = validateOptions(options);
  validateExportRequest(folder, photos, runMagick);
  const lockFolder = await fs.realpath(folder);
  if (activeExports.has(lockFolder)) throw new Error("An export is already running for this album.");
  activeExports.add(lockFolder);
  try {
    await validateAlbumPhotos(folder, photos);
    return await performExport();
  } finally {
    activeExports.delete(lockFolder);
  }

  async function performExport() {
    const outputFolder = path.join(folder, OUTPUT_DIRECTORY);
    const stagingFolder = path.join(folder, STAGING_DIRECTORY);
    const backupFolder = path.join(folder, BACKUP_DIRECTORY);

    await fs.rm(stagingFolder, { recursive: true, force: true });
    await fs.mkdir(stagingFolder, { recursive: true });

    try {
      for (let index = 0; index < photos.length; index += 1) {
        const source = photos[index].path;
        const destination = path.join(
          stagingFolder,
          outputName(index, photos.length),
        );
        await runMagick([
          source,
          "-auto-orient",
          "-resize",
          validatedOptions.resize,
          "-quality",
          String(validatedOptions.quality),
          destination,
        ]);
        onProgress({ current: index + 1, total: photos.length });
      }

      let manifestPath;
      await replaceOutputFolder({
        outputFolder,
        stagingFolder,
        backupFolder,
        commit: async () => {
          manifestPath = await saveManifest(
            folder,
            photos.map((photo) => path.basename(photo.path)),
            validatedOptions,
          );
        },
      });

      return {
        outputFolder,
        manifestPath,
        count: photos.length,
      };
    } finally {
      await fs.rm(stagingFolder, { recursive: true, force: true }).catch(() => {});
    }
  }
}

function validateExportRequest(folder, photos, runMagick) {
  if (
    typeof folder !== "string" ||
    !path.isAbsolute(folder) ||
    !Array.isArray(photos) ||
    photos.length === 0 ||
    typeof runMagick !== "function"
  ) {
    throw new Error("Open a folder containing photos before exporting.");
  }

}

async function replaceOutputFolder({
  outputFolder,
  stagingFolder,
  backupFolder,
  commit = async () => {},
}) {
  // A retained backup may be the only recoverable output after a rollback failure.
  try {
    await fs.lstat(backupFolder);
    throw new Error("An export backup exists. Recover it before exporting again.");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  let previousOutputExists = false;

  try {
    await fs.rename(outputFolder, backupFolder);
    previousOutputExists = true;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  let installed = false;
  try {
    await fs.rename(stagingFolder, outputFolder);
    installed = true;
    await commit();
  } catch (error) {
    if (installed) await fs.rm(outputFolder, { recursive: true, force: true });
    if (previousOutputExists) {
      await fs.rename(backupFolder, outputFolder);
    }
    throw error;
  }

  if (previousOutputExists) {
    // The transaction has committed; cleanup failure must not report export failure.
    await fs.rm(backupFolder, { recursive: true, force: true }).catch(() => {});
  }
}

module.exports = {
  BACKUP_DIRECTORY,
  OUTPUT_DIRECTORY,
  STAGING_DIRECTORY,
  exportAlbum,
  replaceOutputFolder,
  validateExportRequest,
};
