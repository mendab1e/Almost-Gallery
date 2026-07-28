const fs = require("node:fs");
const path = require("node:path");

const COMMON_MAGICK_PATHS = [
  "/opt/homebrew/bin/magick",
  "/usr/local/bin/magick",
  "/usr/bin/magick",
];

function imageMagickCandidates(env = process.env, commonPaths = COMMON_MAGICK_PATHS) {
  const pathCandidates = String(env.PATH || "")
    .split(path.delimiter)
    .filter(Boolean)
    .map((directory) => path.join(directory, "magick"));

  return [
    env.ALMOST_GALLERY_MAGICK,
    ...commonPaths,
    ...pathCandidates,
  ].filter((candidate, index, candidates) =>
    Boolean(candidate) && candidates.indexOf(candidate) === index
  );
}

function resolveImageMagickSync({
  env = process.env,
  commonPaths = COMMON_MAGICK_PATHS,
  accessSync = fs.accessSync,
} = {}) {
  for (const candidate of imageMagickCandidates(env, commonPaths)) {
    try {
      accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // Continue looking in the next supported location.
    }
  }
  throw imageMagickNotFoundError();
}

async function resolveImageMagick({
  env = process.env,
  commonPaths = COMMON_MAGICK_PATHS,
  access = fs.promises.access,
} = {}) {
  for (const candidate of imageMagickCandidates(env, commonPaths)) {
    try {
      await access(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // Continue looking in the next supported location.
    }
  }
  throw imageMagickNotFoundError();
}

function imageMagickNotFoundError() {
  return new Error(
    "ImageMagick was not found. Install it with: brew install imagemagick",
  );
}

module.exports = {
  COMMON_MAGICK_PATHS,
  imageMagickCandidates,
  resolveImageMagick,
  resolveImageMagickSync,
};
