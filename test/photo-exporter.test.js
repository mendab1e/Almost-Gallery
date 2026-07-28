const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {
  BACKUP_DIRECTORY,
  STAGING_DIRECTORY,
  exportAlbum,
} = require("../src/photo-exporter");
const {
  loadExportManifest,
  saveExportManifest,
} = require("../src/manifest-store");

async function temporaryAlbum(t) {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), "almost-gallery-export-"));
  t.after(() => fs.rm(folder, { recursive: true, force: true }));
  return folder;
}

test("exports ordered photos, reports progress, replaces stale output, and saves state", async (t) => {
  const folder = await temporaryAlbum(t);
  const first = path.join(folder, "first.jpg");
  const second = path.join(folder, "second.heic");
  await fs.writeFile(first, "original first");
  await fs.writeFile(second, "original second");
  await fs.mkdir(path.join(folder, "output"));
  await fs.writeFile(path.join(folder, "output", "009.jpg"), "stale");

  const calls = [];
  const progress = [];
  const runMagick = async (args) => {
    calls.push(args);
    await fs.writeFile(args.at(-1), `converted ${path.basename(args[0])}`);
  };

  const result = await exportAlbum({
    folder,
    photos: [{ path: second }, { path: first }],
    options: { resize: "1600x900>", quality: 76 },
    runMagick,
    onProgress: (value) => progress.push(value),
  });

  assert.deepEqual(await fs.readdir(result.outputFolder), [
    "000.jpg",
    "001.jpg",
  ]);
  assert.equal(
    await fs.readFile(path.join(result.outputFolder, "000.jpg"), "utf8"),
    "converted second.heic",
  );
  assert.deepEqual(calls, [
    [
      second,
      "-auto-orient",
      "-resize",
      "1600x900>",
      "-quality",
      "76",
      path.join(folder, STAGING_DIRECTORY, "000.jpg"),
    ],
    [
      first,
      "-auto-orient",
      "-resize",
      "1600x900>",
      "-quality",
      "76",
      path.join(folder, STAGING_DIRECTORY, "001.jpg"),
    ],
  ]);
  assert.deepEqual(progress, [
    { current: 1, total: 2 },
    { current: 2, total: 2 },
  ]);
  assert.deepEqual(await loadExportManifest(folder), {
    options: { resize: "1600x900>", quality: 76 },
    photos: ["second.heic", "first.jpg"],
  });
  assert.equal(await fs.readFile(first, "utf8"), "original first");
  await assert.rejects(
    fs.access(path.join(folder, STAGING_DIRECTORY)),
    { code: "ENOENT" },
  );
  await assert.rejects(
    fs.access(path.join(folder, BACKUP_DIRECTORY)),
    { code: "ENOENT" },
  );
});

test("a failed conversion preserves the previous output and manifest", async (t) => {
  const folder = await temporaryAlbum(t);
  const first = path.join(folder, "first.jpg");
  const second = path.join(folder, "second.jpg");
  await fs.writeFile(first, "first");
  await fs.writeFile(second, "second");
  await fs.mkdir(path.join(folder, "output"));
  await fs.writeFile(path.join(folder, "output", "000.jpg"), "previous export");
  await saveExportManifest(
    folder,
    ["old.jpg"],
    { resize: "900x900", quality: 70 },
  );

  let call = 0;
  await assert.rejects(
    exportAlbum({
      folder,
      photos: [{ path: first }, { path: second }],
      options: { resize: "2000x2000", quality: 85 },
      runMagick: async (args) => {
        call += 1;
        if (call === 2) throw new Error("conversion failed");
        await fs.writeFile(args.at(-1), "partial");
      },
    }),
    /conversion failed/,
  );

  assert.equal(
    await fs.readFile(path.join(folder, "output", "000.jpg"), "utf8"),
    "previous export",
  );
  assert.deepEqual(await loadExportManifest(folder), {
    options: { resize: "900x900", quality: 70 },
    photos: ["old.jpg"],
  });
  await assert.rejects(
    fs.access(path.join(folder, STAGING_DIRECTORY)),
    { code: "ENOENT" },
  );
});

test("rejects photos outside the selected album", async (t) => {
  const folder = await temporaryAlbum(t);
  await assert.rejects(
    exportAlbum({
      folder,
      photos: [{ path: path.join(folder, "..", "outside.jpg") }],
      options: { resize: "2000x2000", quality: 85 },
      runMagick: async () => {},
    }),
    /invalid file/,
  );
});
