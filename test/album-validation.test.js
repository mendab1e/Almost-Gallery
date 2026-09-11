const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { validateAlbumPhotos } = require("../src/album-validation");

test("validates real album files and rejects duplicates, links, directories, and unsupported files", async (t) => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), "almost-validation-"));
  t.after(() => fs.rm(folder, { recursive: true, force: true }));
  const photo = { path: path.join(folder, "photo.JPG") };
  await fs.writeFile(photo.path, "source");
  await validateAlbumPhotos(folder, [photo]);
  await fs.symlink(photo.path, path.join(folder, "link.jpg"));
  await fs.mkdir(path.join(folder, "directory.jpg"));
  await fs.writeFile(path.join(folder, "notes.txt"), "text");
  for (const photos of [[photo, photo], ...["link.jpg", "directory.jpg", "notes.txt", "../outside.jpg", "missing.jpg"].map((name) => [{ path: path.join(folder, name) }])]) {
    await assert.rejects(validateAlbumPhotos(folder, photos));
  }
  await assert.rejects(validateAlbumPhotos("", []));
  await assert.rejects(validateAlbumPhotos(photo.path, []), /folder/);
});
