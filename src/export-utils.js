const path = require("node:path");

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

function validateOptions(options) {
  const resize = String(options?.resize ?? "").trim();
  const quality = Number(options?.quality);

  if (!/^\d+x\d+(?:[><^!])?$/.test(resize)) {
    throw new Error("Resize must look like 2000x2000 (optional suffix: >, <, ^, or !).");
  }
  if (!Number.isInteger(quality) || quality < 1 || quality > 100) {
    throw new Error("Quality must be a whole number from 1 to 100.");
  }
  return { resize, quality };
}

module.exports = { isSupportedImage, outputName, validateOptions };
