const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { loadAlbumState } = require("../src/album-state");
const { saveExportManifest } = require("../src/manifest-store");

async function temporaryAlbum(t) {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), "almost-gallery-album-"));
  t.after(() => fs.rm(folder, { recursive: true, force: true }));
  return folder;
}

test("loads saved options and order while appending newly added photos", async (t) => {
  const folder = await temporaryAlbum(t);
  const images = [
    { name: "01.jpg" },
    { name: "02.jpg" },
    { name: "03.jpg" },
    { name: "new.jpg" },
  ];
  await saveExportManifest(
    folder,
    ["03.jpg", "missing.jpg", "01.jpg", "02.jpg"],
    { resize: "1200x1200", quality: 82 },
  );

  assert.deepEqual(await loadAlbumState(folder, images), {
    images: [
      { name: "03.jpg" },
      { name: "01.jpg" },
      { name: "02.jpg" },
      { name: "new.jpg" },
    ],
    options: { resize: "1200x1200", quality: 82 },
    projectLoaded: true,
    savedPhotos: ["03.jpg", "missing.jpg", "01.jpg", "02.jpg"],
  });
});

test("keeps natural folder order when there is no manifest", async (t) => {
  const folder = await temporaryAlbum(t);
  const images = [{ name: "01.jpg" }, { name: "02.jpg" }];
  assert.deepEqual(await loadAlbumState(folder, images), {
    images,
    options: null,
    projectLoaded: false,
  });
});
