const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {
  THUMBNAIL_SIZE,
  generateThumbnails,
  thumbnailPath,
} = require("../src/thumbnail-service");

async function temporaryWorkspace(t) {
  const folder = await fs.mkdtemp(
    path.join(os.tmpdir(), "almost-gallery-thumbnails-"),
  );
  t.after(() => fs.rm(folder, { recursive: true, force: true }));
  const album = path.join(folder, "album");
  const cache = path.join(folder, "cache");
  await fs.mkdir(album);
  return { album, cache };
}

test("generates small cached thumbnails with bounded ImageMagick settings", async (t) => {
  const { album, cache } = await temporaryWorkspace(t);
  const first = path.join(album, "first.jpg");
  const second = path.join(album, "second.heic");
  await fs.writeFile(first, "first source");
  await fs.writeFile(second, "second source");

  const calls = [];
  const thumbnails = [];
  const photos = [
    { id: first, path: first },
    { id: second, path: second },
  ];
  const summary = await generateThumbnails({
    folder: album,
    photos,
    cacheFolder: cache,
    concurrency: 2,
    runMagick: async (args) => {
      calls.push(args);
      await fs.writeFile(args.at(-1), "thumbnail");
    },
    onThumbnail: (thumbnail) => thumbnails.push(thumbnail),
  });

  assert.deepEqual(summary, {
    generated: 2,
    cached: 0,
    failed: 0,
    cancelled: false,
  });
  assert.equal(calls.length, 2);
  for (const args of calls) {
    assert.deepEqual(args.slice(0, 3), ["-limit", "thread", "1"]);
    assert.ok([first, second].includes(args[3]));
    assert.equal(args[4], "-auto-orient");
    assert.equal(args[5], "-thumbnail");
    assert.equal(args[6], `${THUMBNAIL_SIZE}x${THUMBNAIL_SIZE}>`);
    assert.equal(args.at(-2), "72");
  }
  assert.equal(thumbnails.length, 2);
  assert.ok(thumbnails.every((thumbnail) => thumbnail.url.startsWith("file:")));
  assert.ok(thumbnails.every((thumbnail) => thumbnail.failed === false));

  const cachedSummary = await generateThumbnails({
    folder: album,
    photos,
    cacheFolder: cache,
    runMagick: async () => {
      throw new Error("cache should prevent regeneration");
    },
  });
  assert.deepEqual(cachedSummary, {
    generated: 0,
    cached: 2,
    failed: 0,
    cancelled: false,
  });
});

test("cache keys change when a source photo changes", async (t) => {
  const { album, cache } = await temporaryWorkspace(t);
  const source = path.join(album, "photo.jpg");
  await fs.writeFile(source, "first version");
  const before = await fs.stat(source);
  const firstPath = thumbnailPath(cache, source, before);

  await fs.appendFile(source, " changed");
  const after = await fs.stat(source);
  const secondPath = thumbnailPath(cache, source, after);
  assert.notEqual(firstPath, secondPath);
});

test("a thumbnail failure falls back to the original photo", async (t) => {
  const { album, cache } = await temporaryWorkspace(t);
  const source = path.join(album, "photo.jpg");
  await fs.writeFile(source, "source");
  const events = [];

  const summary = await generateThumbnails({
    folder: album,
    photos: [{ id: source, path: source }],
    cacheFolder: cache,
    runMagick: async () => {
      throw new Error("unsupported photo");
    },
    onThumbnail: (thumbnail) => events.push(thumbnail),
  });

  assert.equal(summary.failed, 1);
  assert.equal(events[0].failed, true);
  assert.ok(events[0].url.endsWith("/photo.jpg"));
});

test("rejects thumbnail paths outside the selected album", async (t) => {
  const { album, cache } = await temporaryWorkspace(t);
  await assert.rejects(
    generateThumbnails({
      folder: album,
      photos: [{ id: "outside", path: path.join(album, "..", "outside.jpg") }],
      cacheFolder: cache,
      runMagick: async () => {},
    }),
    /invalid file/,
  );
});
