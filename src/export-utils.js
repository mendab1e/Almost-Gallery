const path = require("node:path");
const { validateOptions } = require("./export-options");

const SUPPORTED_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".tif",
  ".tiff",
  ".heic",
  ".heif",
]);

function isSupportedImage(filename) {
  return SUPPORTED_EXTENSIONS.has(path.extname(filename).toLowerCase());
}

function outputName(index, total) {
  const width = Math.max(3, String(Math.max(0, total - 1)).length);
  return `${String(index).padStart(width, "0")}.jpg`;
}

function applySavedOrder(images, savedNames) {
  const imagesByName = new Map(images.map((image) => [image.name, image]));
  const ordered = [];
  const usedNames = new Set();

  for (const name of savedNames) {
    const image = imagesByName.get(name);
    if (image && !usedNames.has(name)) {
      ordered.push(image);
      usedNames.add(name);
    }
  }

  for (const image of images) {
    if (!usedNames.has(image.name)) ordered.push(image);
  }
  return ordered;
}

function parseExportManifest(contents) {
  const manifest = JSON.parse(contents);
  if (
    !manifest ||
    manifest.version !== 1 ||
    !Array.isArray(manifest.photos) ||
    !manifest.photos.every((name) => typeof name === "string")
  ) {
    throw new Error("The saved export file has an unsupported format.");
  }
  return {
    options: validateOptions(manifest.imageMagick),
    photos: manifest.photos,
  };
}

function serializeExportManifest(photoNames, options) {
  return `${JSON.stringify(
    {
      version: 1,
      imageMagick: validateOptions(options),
      photos: photoNames,
    },
    null,
    2,
  )}\n`;
}

module.exports = {
  applySavedOrder,
  isSupportedImage,
  outputName,
  parseExportManifest,
  serializeExportManifest,
  validateOptions,
};
