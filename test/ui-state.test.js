const test = require("node:test");
const assert = require("node:assert/strict");
const {
  adjustGridSizeIndex,
  controlStates,
  folderOpenStatus,
  movePhotoById,
  reduceGalleryPreview,
} = require("../src/ui-state");

test("drag ordering moves a photo and leaves invalid drops unchanged", () => {
  const photos = [{ id: "a" }, { id: "b" }, { id: "c" }];
  assert.deepEqual(movePhotoById(photos, "c", "a"), [
    { id: "c" },
    { id: "a" },
    { id: "b" },
  ]);
  assert.equal(movePhotoById(photos, "missing", "a"), photos);
});

test("grid size controls stop at their minimum and maximum", () => {
  assert.equal(adjustGridSizeIndex(0, -1, 5), 0);
  assert.equal(adjustGridSizeIndex(2, 1, 5), 3);
  assert.equal(adjustGridSizeIndex(4, 1, 5), 4);
});

test("gallery preview opens selected photos, navigates, clamps, and closes", () => {
  let preview = { open: false, index: 0 };
  preview = reduceGalleryPreview(preview, { type: "open", index: 2 }, 4);
  assert.deepEqual(preview, { open: true, index: 2 });
  preview = reduceGalleryPreview(
    preview,
    { type: "navigate", direction: 1 },
    4,
  );
  assert.deepEqual(preview, { open: true, index: 3 });
  preview = reduceGalleryPreview(
    preview,
    { type: "navigate", direction: 1 },
    4,
  );
  assert.deepEqual(preview, { open: true, index: 3 });
  preview = reduceGalleryPreview(preview, { type: "close" }, 4);
  assert.deepEqual(preview, { open: false, index: 3 });
});

test("button disabled states reflect photo and preview boundaries", () => {
  assert.deepEqual(controlStates(0), {
    exportDisabled: true,
    galleryPreviewDisabled: true,
    previousDisabled: true,
    nextDisabled: true,
  });
  assert.equal(controlStates(3, 0).previousDisabled, true);
  assert.equal(controlStates(3, 0).nextDisabled, false);
  assert.equal(controlStates(3, 2).nextDisabled, true);
});

test("folder-open status prioritizes empty folders and manifest warnings", () => {
  assert.deepEqual(
    folderOpenStatus({
      images: [],
      loadWarning: "broken manifest",
      projectLoaded: false,
    }),
    {
      message: "No supported photos were found in this folder.",
      kind: "error",
    },
  );
  assert.deepEqual(
    folderOpenStatus({
      images: [{ id: "a" }],
      loadWarning: "Could not load almost_gallery_output.json",
      projectLoaded: false,
    }),
    {
      message: "Could not load almost_gallery_output.json",
      kind: "error",
    },
  );
  assert.equal(
    folderOpenStatus({
      images: [{ id: "a" }],
      loadWarning: null,
      projectLoaded: false,
    }),
    null,
  );
});

const {
  insertPhoto,
  reduceOrderHistory,
  exportSignature,
  exportStateLabel,
  resizeDescription,
} = require("../src/ui-state");

test("insertion uses explicit before and after edges in both directions", () => {
  const photos = ["a", "b", "c", "d"].map((id) => ({ id }));
  const ids = (items) => items.map((item) => item.id);
  assert.deepEqual(ids(insertPhoto(photos, "a", "c", false)), ["b", "a", "c", "d"]);
  assert.deepEqual(ids(insertPhoto(photos, "a", "c", true)), ["b", "c", "a", "d"]);
  assert.deepEqual(ids(insertPhoto(photos, "d", "a", false)), ["d", "a", "b", "c"]);
  assert.deepEqual(ids(insertPhoto(photos, "d", "a", true)), ["a", "d", "b", "c"]);
  assert.equal(insertPhoto(photos, "a", "b", false), photos);
  assert.equal(insertPhoto(photos, "b", "a", true), photos);
  assert.equal(insertPhoto(photos, "a", "a", true), photos);
  assert.equal(insertPhoto(photos, "missing", "a", true), photos);
  assert.equal(insertPhoto(photos, "a", "missing", false), photos);
});

test("history supports repeated undo, redo, boundaries and branching", () => {
  const photos = ["a", "b", "c"].map((id) => ({ id }));
  const initial = { past: [], present: photos, future: [] };
  assert.equal(reduceOrderHistory(initial, { type: "undo" }), initial);
  assert.equal(reduceOrderHistory(initial, { type: "redo" }), initial);
  assert.equal(reduceOrderHistory(initial, { type: "move", photos }), initial);
  const moved = movePhotoById(photos, "a", "c");
  const history = reduceOrderHistory(initial, { type: "move", photos: moved });
  const undone = reduceOrderHistory(history, { type: "undo" });
  assert.equal(undone.present, photos);
  assert.deepEqual(reduceOrderHistory(undone, { type: "redo" }), history);
  const branched = reduceOrderHistory(undone, {
    type: "move", photos: movePhotoById(photos, "c", "a"),
  });
  assert.deepEqual(branched.future, []);
  const second = reduceOrderHistory(history, { type: "move", photos });
  assert.equal(reduceOrderHistory(reduceOrderHistory(second, { type: "undo" }), { type: "undo" }).present, photos);
  assert.equal(movePhotoById(photos, "a", undefined), photos);
  assert.equal(movePhotoById(photos, "c", undefined), photos);
});

test("export status tracks order, options, added and removed photos", () => {
  const photos = [{ name: "a.jpg" }, { name: "b.jpg" }];
  const options = { resize: "2000x2000", quality: 85 };
  const saved = exportSignature(photos.map((photo) => photo.name), options);
  assert.equal(exportStateLabel(photos, options, null), "Not exported yet");
  assert.equal(exportStateLabel(photos, options, saved), "Export up to date");
  for (const changed of [[...photos].reverse(), photos.slice(1), [...photos, { name: "c.jpg" }]]) {
    assert.equal(exportStateLabel(changed, options, saved), "Changes since last export");
  }
  assert.equal(exportStateLabel(photos, { ...options, quality: 90 }, saved), "Changes since last export");
  assert.equal(exportStateLabel(photos, { ...options, resize: "1000x1000>" }, saved), "Changes since last export");
  assert.equal(exportStateLabel(photos, options, saved), "Export up to date");
});

test("resize descriptions distinguish fit, shrink, enlarge, cover and stretch", () => {
  assert.equal(resizeDescription("2000x2000"), "Fit within 2000 × 2000");
  assert.equal(resizeDescription("2000x1000>"), "Shrink to fit 2000 × 1000");
  assert.equal(resizeDescription("2000x1000<"), "Enlarge to fit 2000 × 1000");
  assert.equal(resizeDescription("2000x1000^"), "Cover 2000 × 1000");
  assert.equal(resizeDescription("2000x1000!"), "Stretch to 2000 × 1000");
  assert.equal(resizeDescription("invalid"), "invalid");
});
