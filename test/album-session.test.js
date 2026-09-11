const test = require("node:test");
const assert = require("node:assert/strict");
const { createAlbumSession } = require("../src/album-session");

test("album session resolves only a complete ordering of selected photos", () => {
  const session = createAlbumSession();
  const photos = [{ id: "a", path: "/album/a.jpg" }, { id: "b", path: "/album/b.jpg" }];
  const albumId = session.select("/album", photos);
  assert.deepEqual(session.resolve({ albumId, photoIds: ["b", "a"], folder: "/untrusted" }), {
    folder: "/album", photos: [photos[1], photos[0]],
  });
  for (const photoIds of [["a"], ["a", "a"], ["a", "unknown"], null]) {
    assert.throws(() => session.resolve({ albumId, photoIds }));
  }
  session.select("/album", photos);
  assert.throws(() => session.resolve({ albumId, photoIds: ["a", "b"] }), /Reopen/);
});

test("session blocks overlapping exports and album changes and unlocks on failure", async () => {
  const session = createAlbumSession();
  const albumId = session.select("/album", [{ id: "a" }]);
  const request = { albumId, photoIds: ["a"] };
  let release;
  const blocked = new Promise((resolve) => { release = resolve; });
  const first = session.export(request, async () => {
    await blocked;
    throw new Error("failed");
  });
  assert.equal(session.exporting, true);
  try {
    assert.throws(() => session.select("/other", []), /Wait/);
    await assert.rejects(session.export(request, async () => {}), /already running/);
  } finally { release(); }
  await assert.rejects(first, /failed/);
  assert.equal(await session.export(request, async () => "success"), "success");
});
