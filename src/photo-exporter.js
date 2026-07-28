const fs = require("node:fs/promises");
const path = require("node:path");
const { outputName, validateOptions } = require("./export-utils");
const { saveExportManifest } = require("./manifest-store");

const OUTPUT_DIRECTORY = "output";
const STAGING_DIRECTORY = ".almost_gallery_output_staging";
const BACKUP_DIRECTORY = ".almost_gallery_output_backup";

async function exportAlbum({
  folder,
  photos,
  options,
  runMagick,
  onProgress = () => {},
}) {
  const validatedOptions = validateOptions(options);
  validateExportRequest(folder, photos, runMagick);

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

    await replaceOutputFolder({
      outputFolder,
      stagingFolder,
      backupFolder,
    });

    const manifestPath = await saveExportManifest(
      folder,
      photos.map((photo) => path.basename(photo.path)),
      validatedOptions,
    );

    return {
      outputFolder,
      manifestPath,
      count: photos.length,
    };
  } finally {
    await fs.rm(stagingFolder, { recursive: true, force: true });
  }
}

function validateExportRequest(folder, photos, runMagick) {
  if (
    typeof folder !== "string" ||
    !Array.isArray(photos) ||
    photos.length === 0 ||
    typeof runMagick !== "function"
  ) {
    throw new Error("Open a folder containing photos before exporting.");
  }

  const resolvedFolder = path.resolve(folder);
  for (const photo of photos) {
    if (
      typeof photo?.path !== "string" ||
      path.dirname(path.resolve(photo.path)) !== resolvedFolder
    ) {
      throw new Error("The photo list contains an invalid file.");
    }
  }
}

async function replaceOutputFolder({
  outputFolder,
  stagingFolder,
  backupFolder,
}) {
  await fs.rm(backupFolder, { recursive: true, force: true });
  let previousOutputExists = false;

  try {
    await fs.rename(outputFolder, backupFolder);
    previousOutputExists = true;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  try {
    await fs.rename(stagingFolder, outputFolder);
  } catch (error) {
    if (previousOutputExists) {
      await fs.rename(backupFolder, outputFolder);
    }
    throw error;
  }

  if (previousOutputExists) {
    await fs.rm(backupFolder, { recursive: true, force: true });
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
