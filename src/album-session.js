const { randomUUID } = require("node:crypto");

function createAlbumSession() {
  let album = null;
  let exporting = false;
  return {
    get exporting() { return exporting; },
    select(folder, photos) {
      if (exporting) throw new Error("Wait for the export to finish.");
      album = { id: randomUUID(), folder, photos: new Map(photos.map((photo) => [photo.id, photo])) };
      return album.id;
    },
    resolve(request) {
      if (!album || request?.albumId !== album.id || !Array.isArray(request.photoIds) ||
          request.photoIds.length !== album.photos.size ||
          new Set(request.photoIds).size !== request.photoIds.length) {
        throw new Error("Reopen the album and try again.");
      }
      const photos = request.photoIds.map((id) => album.photos.get(id));
      if (photos.some((photo) => !photo)) throw new Error("The photo list contains an invalid file.");
      return { folder: album.folder, photos };
    },
    async export(request, action) {
      if (exporting) throw new Error("An export is already running.");
      const selection = this.resolve(request);
      exporting = true;
      try { return await action(selection); }
      finally { exporting = false; }
    },
  };
}

module.exports = { createAlbumSession };
