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
