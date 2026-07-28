const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {
  imageMagickCandidates,
  resolveImageMagick,
  resolveImageMagickSync,
} = require("../src/image-magick");

async function temporaryDirectory(t) {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), "almost-gallery-magick-"));
  t.after(() => fs.rm(folder, { recursive: true, force: true }));
  return folder;
}

test("checks an explicit override, Homebrew paths, and PATH without duplicates", () => {
  assert.deepEqual(
    imageMagickCandidates(
      {
        ALMOST_GALLERY_MAGICK: "/custom/magick",
        PATH: ["/bin", "/custom"].join(path.delimiter),
      },
      ["/opt/homebrew/bin/magick", "/custom/magick"],
    ),
    [
      "/custom/magick",
      "/opt/homebrew/bin/magick",
      "/bin/magick",
    ],
  );
});

test("resolves ImageMagick from PATH for terminal launches", async (t) => {
  const folder = await temporaryDirectory(t);
  const executable = path.join(folder, "magick");
  await fs.writeFile(executable, "#!/bin/sh\n", { mode: 0o755 });

  const options = { env: { PATH: folder }, commonPaths: [] };
  assert.equal(await resolveImageMagick(options), executable);
  assert.equal(resolveImageMagickSync(options), executable);
});

test("reports a useful error when ImageMagick cannot be found", async () => {
  await assert.rejects(
    resolveImageMagick({ env: { PATH: "" }, commonPaths: [] }),
    /brew install imagemagick/,
  );
});
