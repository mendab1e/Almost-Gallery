const fs = require("node:fs/promises");
const path = require("node:path");
const { isSupportedImage } = require("./export-utils");

async function validateAlbumPhotos(folder, photos) {
  if (typeof folder !== "string" || !path.isAbsolute(folder) || !Array.isArray(photos)) {
    throw new Error("The album request is invalid.");
  }
  const album = await fs.realpath(folder);
  if (!(await fs.stat(album)).isDirectory()) throw new Error("Choose an album folder.");
  const seen = new Set();
  for (const photo of photos) {
    if (typeof photo?.path !== "string" || !path.isAbsolute(photo.path) ||
        path.dirname(path.resolve(photo.path)) !== path.resolve(folder) ||
        !isSupportedImage(photo.path) || seen.has(photo.path)) {
      throw new Error("The photo list contains an invalid file.");
    }
    seen.add(photo.path);
    const stats = await fs.lstat(photo.path);
    if (!stats.isFile() || path.dirname(await fs.realpath(photo.path)) !== album) {
      throw new Error("The photo list contains an invalid file.");
    }
  }
}

module.exports = { validateAlbumPhotos };
