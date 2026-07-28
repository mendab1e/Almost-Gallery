const test = require("node:test");
const assert = require("node:assert/strict");
const {
  applySavedOrder,
  isSupportedImage,
  outputName,
  parseExportManifest,
  serializeExportManifest,
  validateOptions,
} = require("../src/export-utils");

test("recognizes supported photos case-insensitively", () => {
  assert.equal(isSupportedImage("photo.JPG"), true);
  assert.equal(isSupportedImage("scan.tiff"), true);
  assert.equal(isSupportedImage("notes.txt"), false);
});

test("generates Hugo-sortable names", () => {
  assert.equal(outputName(0, 12), "000.jpg");
  assert.equal(outputName(11, 12), "011.jpg");
  assert.equal(outputName(1000, 1001), "1000.jpg");
});

test("validates ImageMagick options", () => {
  assert.deepEqual(validateOptions({ resize: "2000x2000>", quality: 85 }), {
    resize: "2000x2000>",
    quality: 85,
  });
  assert.throws(() => validateOptions({ resize: "anything", quality: 85 }));
  assert.throws(() => validateOptions({ resize: "2000x2000", quality: 101 }));
});

test("restores saved photo order and appends new photos", () => {
  const images = [
    { name: "a.jpg" },
    { name: "b.jpg" },
    { name: "c.jpg" },
    { name: "new.jpg" },
  ];
  assert.deepEqual(
    applySavedOrder(images, ["c.jpg", "missing.jpg", "a.jpg", "c.jpg"]),
    [
      { name: "c.jpg" },
      { name: "a.jpg" },
      { name: "b.jpg" },
      { name: "new.jpg" },
    ],
  );
});

test("round trips the export manifest", () => {
  const contents = serializeExportManifest(
    ["third.heic", "first.jpg"],
    { resize: "1000x1000", quality: 72 },
  );
  assert.deepEqual(parseExportManifest(contents), {
    options: { resize: "1000x1000", quality: 72 },
    photos: ["third.heic", "first.jpg"],
  });
});

test("rejects malformed export manifests", () => {
  assert.throws(() => parseExportManifest("{}"));
  assert.throws(() =>
    parseExportManifest(
      JSON.stringify({
        version: 1,
        imageMagick: { resize: "bad", quality: 85 },
        photos: [],
      }),
    ),
  );
});
