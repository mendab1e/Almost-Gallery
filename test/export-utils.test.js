const test = require("node:test");
const assert = require("node:assert/strict");
const { isSupportedImage, outputName, validateOptions } = require("../src/export-utils");

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
