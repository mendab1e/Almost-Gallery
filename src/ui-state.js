(function exposeUiState(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.galleryUi = api;
})(
  typeof window === "undefined" ? null : window,
  function createUiStateApi() {
    function movePhotoById(photos, sourceId, targetId) {
      const from = photos.findIndex((photo) => photo.id === sourceId);
      const to = photos.findIndex((photo) => photo.id === targetId);
      if (from < 0 || to < 0 || from === to) return photos;
      const reordered = [...photos];
      const [moved] = reordered.splice(from, 1);
      reordered.splice(to, 0, moved);
      return reordered;
    }

    function adjustGridSizeIndex(current, direction, totalSizes) {
      return Math.max(0, Math.min(totalSizes - 1, current + direction));
    }

    function reduceGalleryPreview(current, action, photoCount) {
      if (action.type === "close") return { ...current, open: false };
      if (photoCount <= 0) return { open: false, index: 0 };

      if (action.type === "open") {
        return {
          open: true,
          index: Math.max(0, Math.min(photoCount - 1, action.index || 0)),
        };
      }

      if (action.type === "navigate" && current.open) {
        return {
          open: true,
          index: Math.max(
            0,
            Math.min(photoCount - 1, current.index + action.direction),
          ),
        };
      }
      return current;
    }

    function controlStates(photoCount, previewIndex = 0) {
      return {
        exportDisabled: photoCount === 0,
        galleryPreviewDisabled: photoCount === 0,
        previousDisabled: photoCount === 0 || previewIndex === 0,
        nextDisabled:
          photoCount === 0 || previewIndex >= Math.max(0, photoCount - 1),
      };
    }

    function folderOpenStatus(result) {
      if (result.images.length === 0) {
        return {
          message: "No supported photos were found in this folder.",
          kind: "error",
        };
      }
      if (result.loadWarning) {
        return { message: result.loadWarning, kind: "error" };
      }
      if (result.projectLoaded) {
        return {
          message: "Saved photo order and ImageMagick options loaded.",
          kind: "success",
        };
      }
      return null;
    }

    return {
      adjustGridSizeIndex,
      controlStates,
      folderOpenStatus,
      movePhotoById,
      reduceGalleryPreview,
    };
  },
);
