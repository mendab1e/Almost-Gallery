const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const { validateAlbumPhotos } = require("./album-validation");

const THUMBNAIL_SIZE = 640;
const DEFAULT_CONCURRENCY = 2;

async function generateThumbnails({
  folder,
  photos,
  cacheFolder,
  runMagick,
  onThumbnail = () => {},
  concurrency = DEFAULT_CONCURRENCY,
  shouldContinue = () => true,
}) {
  await validateThumbnailRequest(folder, photos, cacheFolder, runMagick);
  await fs.mkdir(cacheFolder, { recursive: true });

  const summary = { generated: 0, cached: 0, failed: 0 };
  let nextIndex = 0;
  const workerCount = Math.max(
    1,
    Math.min(concurrency, photos.length),
  );

  async function worker() {
    while (nextIndex < photos.length && shouldContinue()) {
      const index = nextIndex;
      nextIndex += 1;
      const photo = photos[index];
      try {
        const { cachePath, cached } = await getOrCreateThumbnail(photo.path, cacheFolder, runMagick);
        summary[cached ? "cached" : "generated"] += 1;
        if (shouldContinue()) {
          onThumbnail({
            folder,
            id: photo.id,
            url: pathToFileURL(cachePath).href,
            failed: false,
          });
        }
      } catch {
        summary.failed += 1;
        if (shouldContinue()) {
          onThumbnail({
            folder,
            id: photo.id,
            url: pathToFileURL(photo.path).href,
            failed: true,
          });
        }
      }
    }
  }

  await Promise.all(
    Array.from({ length: workerCount }, () => worker()),
  );
  summary.cancelled = !shouldContinue();
  return summary;
}

async function getOrCreateThumbnail(source, cacheFolder, runMagick) {
  const stats = await fs.stat(source);
  const cachePath = thumbnailPath(cacheFolder, source, stats);
  if (await fileExists(cachePath)) return { cachePath, cached: true };
  const temporaryPath = `${cachePath}.${crypto.randomUUID()}.tmp.jpg`;
  try {
    await runMagick([
      "-limit",
      "thread",
      "1",
      source,
      "-auto-orient",
      "-thumbnail",
      `${THUMBNAIL_SIZE}x${THUMBNAIL_SIZE}>`,
      "-background",
      "#e8e6e0",
      "-alpha",
      "remove",
      "-alpha",
      "off",
      "-strip",
      "-quality",
      "72",
      temporaryPath,
    ]);
    await fs.rename(temporaryPath, cachePath);
    return { cachePath, cached: false };
  } finally {
    await fs.rm(temporaryPath, { force: true });
  }
}

function thumbnailPath(cacheFolder, source, stats) {
  const identity = [
    path.resolve(source),
    stats.size,
    stats.mtimeMs,
  ].join("\0");
  const key = crypto.createHash("sha256").update(identity).digest("hex");
  return path.join(cacheFolder, `${key}.jpg`);
}

async function validateThumbnailRequest(folder, photos, cacheFolder, runMagick) {
  if (
    typeof folder !== "string" ||
    !Array.isArray(photos) ||
    typeof cacheFolder !== "string" ||
    typeof runMagick !== "function"
  ) {
    throw new Error("The thumbnail request is invalid.");
  }
  if (photos.some((photo) => typeof photo?.id !== "string")) {
    throw new Error("The thumbnail request contains an invalid file.");
  }
  await validateAlbumPhotos(folder, photos);
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return false;
  }
}

module.exports = {
  DEFAULT_CONCURRENCY,
  THUMBNAIL_SIZE,
  generateThumbnails,
  thumbnailPath,
  validateThumbnailRequest,
};
