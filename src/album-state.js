const { applySavedOrder } = require("./export-utils");
const { loadExportManifest } = require("./manifest-store");

async function loadAlbumState(folder, images) {
  const manifest = await loadExportManifest(folder);
  if (!manifest) {
    return {
      images,
      options: null,
      projectLoaded: false,
    };
  }
  return {
    images: applySavedOrder(images, manifest.photos),
    options: manifest.options,
    projectLoaded: true,
  };
}

module.exports = { loadAlbumState };
