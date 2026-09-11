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

    function insertPhoto(photos, sourceId, targetId, after) {
      if (sourceId === targetId) return photos;
      const source = photos.find((photo) => photo.id === sourceId);
      if (!source || !photos.some((photo) => photo.id === targetId)) return photos;
      const next = photos.filter((photo) => photo.id !== sourceId);
      const index = next.findIndex((photo) => photo.id === targetId);
      next.splice(index + (after ? 1 : 0), 0, source);
      return next.every((photo, i) => photo === photos[i]) ? photos : next;
    }

    function reduceOrderHistory(history, action) {
      if (action.type === "undo" && history.past.length) {
        return {
          past: history.past.slice(0, -1),
          present: history.past.at(-1),
          future: [history.present, ...history.future],
        };
      }
      if (action.type === "redo" && history.future.length) {
        return {
          past: [...history.past, history.present],
          present: history.future[0],
          future: history.future.slice(1),
        };
      }
      if (action.type === "move" && action.photos !== history.present) {
        return { past: [...history.past, history.present], present: action.photos, future: [] };
      }
      return history;
    }

    function exportSignature(names, options) {
      return JSON.stringify([names, options.resize, options.quality]);
    }

    function exportStateLabel(photos, options, savedSignature) {
      if (savedSignature === null) return "Not exported yet";
      return exportSignature(photos.map((photo) => photo.name), options) === savedSignature
        ? "Export up to date"
        : "Changes since last export";
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
      insertPhoto,
      reduceOrderHistory,
      exportSignature,
      exportStateLabel,
      adjustGridSizeIndex,
      controlStates,
      folderOpenStatus,
      movePhotoById,
      reduceGalleryPreview,
    };
  },
);
