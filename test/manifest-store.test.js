const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {
  MANIFEST_FILENAME,
  loadExportManifest,
  saveExportManifest,
} = require("../src/manifest-store");

async function temporaryAlbum(t) {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), "almost-gallery-test-"));
  t.after(() => fs.rm(folder, { recursive: true, force: true }));
  return folder;
}

test("saves the export manifest with the JSON filename and expected contents", async (t) => {
  const folder = await temporaryAlbum(t);
  const manifestPath = await saveExportManifest(
    folder,
    ["second.heic", "first.jpg"],
    { resize: "1400x900", quality: 78 },
  );

  assert.equal(manifestPath, path.join(folder, "almost_gallery_output.json"));
  assert.equal(MANIFEST_FILENAME, "almost_gallery_output.json");

  const saved = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  assert.deepEqual(saved, {
    version: 1,
    imageMagick: { resize: "1400x900", quality: 78 },
    photos: ["second.heic", "first.jpg"],
  });

  await assert.rejects(
    fs.access(path.join(folder, "almost_gallery_output.txt")),
    { code: "ENOENT" },
  );
  await assert.rejects(
    fs.access(path.join(folder, ".almost_gallery_output.json.tmp")),
    { code: "ENOENT" },
  );
});

test("loads saved photo order and ImageMagick options from disk", async (t) => {
  const folder = await temporaryAlbum(t);
  await saveExportManifest(
    folder,
    ["03.jpg", "01.jpg", "02.jpg"],
    { resize: "1000x1000>", quality: 91 },
  );

  assert.deepEqual(await loadExportManifest(folder), {
    options: { resize: "1000x1000>", quality: 91 },
    photos: ["03.jpg", "01.jpg", "02.jpg"],
  });
});

test("returns null when an album has no saved export manifest", async (t) => {
  const folder = await temporaryAlbum(t);
  assert.equal(await loadExportManifest(folder), null);
});

test("rejects a malformed manifest file", async (t) => {
  const folder = await temporaryAlbum(t);
  await fs.writeFile(
    path.join(folder, MANIFEST_FILENAME),
    "{ not valid JSON",
    "utf8",
  );
  await assert.rejects(loadExportManifest(folder), SyntaxError);
});
