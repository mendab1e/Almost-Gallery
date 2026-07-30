const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

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
  validateThumbnailRequest(folder, photos, cacheFolder, runMagick);
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
        const sourceStats = await fs.stat(photo.path);
        const cachePath = thumbnailPath(cacheFolder, photo.path, sourceStats);
        if (await fileExists(cachePath)) {
          summary.cached += 1;
        } else {
          const temporaryPath = `${cachePath}.${process.pid}.${index}.tmp.jpg`;
          try {
            await runMagick([
              "-limit",
              "thread",
              "1",
              photo.path,
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
            summary.generated += 1;
          } finally {
            await fs.rm(temporaryPath, { force: true });
          }
        }
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

function thumbnailPath(cacheFolder, source, stats) {
  const identity = [
    path.resolve(source),
    stats.size,
    Math.trunc(stats.mtimeMs),
  ].join("\0");
  const key = crypto.createHash("sha256").update(identity).digest("hex");
  return path.join(cacheFolder, `${key}.jpg`);
}

function validateThumbnailRequest(folder, photos, cacheFolder, runMagick) {
  if (
    typeof folder !== "string" ||
    !Array.isArray(photos) ||
    typeof cacheFolder !== "string" ||
    typeof runMagick !== "function"
  ) {
    throw new Error("The thumbnail request is invalid.");
  }
  const resolvedFolder = path.resolve(folder);
  for (const photo of photos) {
    if (
      typeof photo?.id !== "string" ||
      typeof photo?.path !== "string" ||
      path.dirname(path.resolve(photo.path)) !== resolvedFolder
    ) {
      throw new Error("The thumbnail request contains an invalid file.");
    }
  }
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
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
