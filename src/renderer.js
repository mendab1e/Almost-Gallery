const { DEFAULT_OPTIONS, parseGeometry, validateOptions, resizeDescription } = window.galleryOptions;

const state = {
  folder: null,
  exporting: false,
  savedSignature: null,
  outputFolder: null,
  history: { past: [], present: [], future: [] },
  options: { ...DEFAULT_OPTIONS },
  draggingId: null,
  previewSizeIndex: 2,
  galleryPreview: { open: false, index: 0 },
  galleryPreloads: [],
  suppressPreviewClick: false,
};

const previewSizes = [120, 155, 190, 240, 300];
const photoCards = new Map();
const photoImages = new Map();
const {
  insertPhoto,
  reduceOrderHistory,
  exportSignature,
  exportStateLabel,
  adjustGridSizeIndex,
  controlStates,
  folderOpenStatus,
  movePhotoById,
  reduceGalleryPreview,
} = window.galleryUi;

const elements = {
  openButton: document.querySelector("#open-button"),
  optionsButton: document.querySelector("#options-button"),
  undo: document.querySelector("#undo-button"),
  redo: document.querySelector("#redo-button"),
  summary: document.querySelector("#export-summary"),
  exportState: document.querySelector("#export-state"),
  progress: document.querySelector("#export-progress"),
  reveal: document.querySelector("#reveal-button"),
  width: document.querySelector("#width-input"),
  height: document.querySelector("#height-input"),
  fit: document.querySelector("#fit-input"),
  advanced: document.querySelector("#advanced-input"),
  empty: document.querySelector("#empty-state"),
  workspace: document.querySelector("#workspace"),
  grid: document.querySelector("#photo-grid"),
  folderName: document.querySelector("#folder-name"),
  photoCount: document.querySelector("#photo-count"),
  exportButton: document.querySelector("#export-button"),
  status: document.querySelector("#status"),
  dialog: document.querySelector("#options-dialog"),
  form: document.querySelector("#options-form"),
  resize: document.querySelector("#resize-input"),
  quality: document.querySelector("#quality-input"),
  optionsError: document.querySelector("#options-error"),
  previewSmaller: document.querySelector("#preview-smaller"),
  previewLarger: document.querySelector("#preview-larger"),
  galleryPreviewButton: document.querySelector("#gallery-preview-button"),
  galleryPreviewDialog: document.querySelector("#gallery-preview-dialog"),
  galleryPreviewImage: document.querySelector("#gallery-preview-image"),
  galleryPreviewName: document.querySelector("#gallery-preview-name"),
  galleryPreviewPosition: document.querySelector("#gallery-preview-position"),
  previousPhoto: document.querySelector("#previous-photo"),
  nextPhoto: document.querySelector("#next-photo"),
};

elements.openButton.addEventListener("click", openFolder);
document.querySelector("#empty-open-button").addEventListener("click", openFolder);
elements.optionsButton.addEventListener("click", showOptions);
document.querySelector("#close-options").addEventListener("click", () => elements.dialog.close());
document.querySelector("#reset-options").addEventListener("click", () => {
  populateOptions({ ...DEFAULT_OPTIONS });
  elements.optionsError.textContent = "";
});
elements.undo.addEventListener("click", () => changeHistory("undo"));
elements.redo.addEventListener("click", () => changeHistory("redo"));
elements.reveal.addEventListener("click", async () => {
  if (!state.outputFolder) return;
  try {
    await window.galleryApi.revealFolder();
  } catch (error) {
    showStatus(error.message, "error");
  }
});
elements.advanced.addEventListener("change", toggleAdvanced);
document.addEventListener("keydown", (event) => {
  if (document.querySelector("dialog[open]") || event.target.matches("input, select, textarea")) return;
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
    event.preventDefault();
    changeHistory(event.shiftKey ? "redo" : "undo");
  }
});
elements.form.addEventListener("submit", applyOptions);
elements.exportButton.addEventListener("click", exportPhotos);
elements.previewSmaller.addEventListener("click", () => changePreviewSize(-1));
elements.previewLarger.addEventListener("click", () => changePreviewSize(1));
elements.galleryPreviewButton.addEventListener("click", () => openGalleryPreview(0));
document.querySelector("#close-gallery-preview").addEventListener("click", closeGalleryPreview);
elements.previousPhoto.addEventListener("click", () => navigateGalleryPreview(-1));
elements.nextPhoto.addEventListener("click", () => navigateGalleryPreview(1));
elements.galleryPreviewDialog.addEventListener("keydown", handleGalleryPreviewKeydown);
elements.galleryPreviewDialog.addEventListener("close", () => {
  state.galleryPreview = reduceGalleryPreview(
    state.galleryPreview,
    { type: "close" },
    state.history.present.length,
  );
  elements.galleryPreviewImage.removeAttribute("src");
  state.galleryPreloads = [];
});
window.galleryApi.onProgress(({ current, total }) => {
  if (!state.exporting) return;
  elements.progress.max = total;
  elements.progress.value = current;
  showStatus(`Processing photo ${current} of ${total}…`, "busy");
});
window.galleryApi.onThumbnail(({ albumId, id, url, failed }) => {
  if (albumId !== state.albumId) return;
  const image = photoImages.get(id);
  if (!image) return;
  image.src = url;
  image.classList.toggle("original-fallback", failed);
});
updatePreviewSize();

async function openFolder() {
  if (state.exporting) return;
  try {
    const result = await window.galleryApi.openFolder();
    if (!result) return;
    state.folder = result.folder;
    state.albumId = result.albumId;
    state.options = result.options || { ...DEFAULT_OPTIONS };
    state.history = { past: [], present: result.images, future: [] };
    state.savedSignature = result.savedPhotos
      ? exportSignature(result.savedPhotos, state.options)
      : null;
    state.outputFolder = null;
    elements.reveal.classList.add("hidden");
    elements.status.classList.add("hidden");
    render();
    updateExportDetails();
    void requestThumbnails(result.albumId, result.images);
    const status = folderOpenStatus(result);
    if (status) showStatus(status.message, status.kind);
  } catch (error) {
    showStatus(error.message, "error");
  }
}

function render() {
  const hasFolder = Boolean(state.folder);
  const controls = controlStates(state.history.present.length);
  elements.empty.classList.toggle("hidden", hasFolder);
  elements.workspace.classList.toggle("hidden", !hasFolder);
  elements.exportButton.disabled = controls.exportDisabled;
  elements.galleryPreviewButton.disabled = controls.galleryPreviewDisabled;
  if (!hasFolder) return;

  elements.folderName.textContent = state.folder.split("/").pop();
  elements.folderName.title = state.folder;
  elements.photoCount.textContent = `${state.history.present.length} photo${state.history.present.length === 1 ? "" : "s"}`;
  photoCards.clear();
  photoImages.clear();
  elements.grid.replaceChildren(...state.history.present.map(createPhotoCard));
  syncGridOrder();
}

function createPhotoCard(photo, index) {
  const card = document.createElement("article");
  card.className = "photo-card";
  card.draggable = true;
  card.tabIndex = 0;
  card.setAttribute("aria-describedby", "reorder-help");
  card.addEventListener("keydown", (event) => {
    const index = state.history.present.findIndex((item) => item.id === photo.id);
    if (event.altKey && ["ArrowLeft", "ArrowRight"].includes(event.key)) {
      event.preventDefault();
      const target = state.history.present[index + (event.key === "ArrowLeft" ? -1 : 1)];
      if (target) movePhoto(photo.id, target.id);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openGalleryPreview(index);
    }
  });
  card.dataset.id = photo.id;

  const image = document.createElement("img");
  image.alt = photo.name;
  image.draggable = false;
  image.loading = "lazy";
  image.decoding = "async";
  image.title = "Open gallery preview";
  image.addEventListener("click", () => {
    const currentIndex = state.history.present.findIndex(
      (item) => item.id === photo.id,
    );
    if (!state.suppressPreviewClick && currentIndex >= 0) {
      openGalleryPreview(currentIndex);
    }
  });

  const meta = document.createElement("div");
  meta.className = "photo-meta";
  const order = document.createElement("span");
  order.className = "order";
  order.textContent = String(index).padStart(3, "0");
  const name = document.createElement("span");
  name.className = "source-name";
  name.textContent = photo.name;
  name.title = photo.name;
  meta.append(order, name);
  card.append(image, meta);
  photoCards.set(photo.id, card);
  photoImages.set(photo.id, image);

  card.addEventListener("dragstart", (event) => {
    if (state.exporting) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", photo.id);
    state.draggingId = photo.id;
    state.suppressPreviewClick = true;
    card.classList.add("dragging");
  });
  card.addEventListener("dragend", () => {
    state.draggingId = null;
    card.classList.remove("dragging");
    clearDropMarkers();
    window.setTimeout(() => {
      state.suppressPreviewClick = false;
    }, 100);
  });
  card.addEventListener("dragover", (event) => {
    if (!state.draggingId || state.exporting) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    clearDropMarkers();
    if (state.draggingId !== photo.id) {
      card.classList.add(dropAfter(event, card) ? "drag-after" : "drag-before");
    }
  });
  card.addEventListener("dragleave", () => card.classList.remove("drag-before", "drag-after"));
  card.addEventListener("drop", (event) => {
    event.preventDefault();
    card.classList.remove("drag-before", "drag-after");
    if (!state.exporting) {
      commitOrder(insertPhoto(state.history.present, state.draggingId, photo.id, dropAfter(event, card)));
    }
  });
  return card;
}

function dropAfter(event, card) {
  const rect = card.getBoundingClientRect();
  return event.clientX >= rect.left + rect.width / 2;
}

function clearDropMarkers() {
  elements.grid.querySelectorAll(".drag-before, .drag-after").forEach((card) => {
    card.classList.remove("drag-before", "drag-after");
  });
}

function movePhoto(sourceId, targetId) {
  if (state.exporting) return;
  commitOrder(movePhotoById(state.history.present, sourceId, targetId));
}

function commitOrder(photos) {
  changeHistory("move", photos);
}

function changeHistory(type, photos) {
  if (state.exporting) return;
  const nextHistory = reduceOrderHistory(state.history, { type, photos });
  if (nextHistory === state.history) return;
  state.history = nextHistory;
  syncGridOrder();
  updateExportDetails();
  showStatus("Photo order updated.", "success");
}

function updateExportDetails() {
  elements.summary.textContent = `${state.history.present.length} photos · JPEG · ${resizeDescription(state.options.resize)} · Quality ${state.options.quality}`;
  elements.exportState.textContent = state.folder
    ? exportStateLabel(state.history.present, state.options, state.savedSignature)
    : "Open a folder to begin";
  elements.undo.disabled = state.exporting || state.history.past.length === 0;
  elements.redo.disabled = state.exporting || state.history.future.length === 0;
  elements.exportButton.disabled = state.exporting || state.history.present.length === 0;
  elements.exportButton.textContent = state.exporting ? "Exporting…" : "Export";
  elements.openButton.disabled = state.exporting;
  elements.optionsButton.disabled = state.exporting;
  for (const card of photoCards.values()) card.draggable = !state.exporting;
}

function syncGridOrder() {
  const focused = document.activeElement;
  const fragment = document.createDocumentFragment();
  state.history.present.forEach((photo, index) => {
    const card = photoCards.get(photo.id);
    if (!card) return;
    card.querySelector(".order").textContent = String(index).padStart(3, "0");
    card.setAttribute("aria-label", `${photo.name}, position ${index + 1} of ${state.history.present.length}`);
    fragment.append(card);
  });
  elements.grid.append(fragment);
  if (focused && elements.grid.contains(focused)) {
    focused.focus({ preventScroll: true });
    focused.scrollIntoView({ block: "nearest" });
  }
}

async function requestThumbnails(albumId, photos) {
  try {
    await window.galleryApi.generateThumbnails({
      albumId,
      photoIds: photos.map(({ id }) => id),
    });
  } catch (error) {
    if (albumId === state.albumId) showStatus(error.message, "error");
  }
}

function changePreviewSize(direction) {
  state.previewSizeIndex = adjustGridSizeIndex(
    state.previewSizeIndex,
    direction,
    previewSizes.length,
  );
  updatePreviewSize();
}

function updatePreviewSize() {
  const size = previewSizes[state.previewSizeIndex];
  elements.grid.style.setProperty("--preview-size", `${size}px`);
  elements.previewSmaller.disabled = state.previewSizeIndex === 0;
  elements.previewLarger.disabled = state.previewSizeIndex === previewSizes.length - 1;
}

function openGalleryPreview(index) {
  state.galleryPreview = reduceGalleryPreview(
    state.galleryPreview,
    { type: "open", index },
    state.history.present.length,
  );
  if (!state.galleryPreview.open) return;
  renderGalleryPreview();
  if (!elements.galleryPreviewDialog.open) elements.galleryPreviewDialog.showModal();
}

function closeGalleryPreview() {
  if (elements.galleryPreviewDialog.open) elements.galleryPreviewDialog.close();
}

function navigateGalleryPreview(direction) {
  state.galleryPreview = reduceGalleryPreview(
    state.galleryPreview,
    { type: "navigate", direction },
    state.history.present.length,
  );
  renderGalleryPreview();
}

function renderGalleryPreview() {
  const photo = state.history.present[state.galleryPreview.index];
  if (!photo) return;
  const controls = controlStates(
    state.history.present.length,
    state.galleryPreview.index,
  );
  elements.galleryPreviewImage.src = photo.url;
  elements.galleryPreviewImage.alt = photo.name;
  elements.galleryPreviewName.textContent = photo.name;
  elements.galleryPreviewPosition.textContent = `${state.galleryPreview.index + 1} of ${state.history.present.length}`;
  elements.previousPhoto.disabled = controls.previousDisabled;
  elements.nextPhoto.disabled = controls.nextDisabled;
  preloadAdjacentGalleryPhotos();
}

function preloadAdjacentGalleryPhotos() {
  state.galleryPreloads = [-1, 1]
    .map((offset) => state.history.present[state.galleryPreview.index + offset])
    .filter(Boolean)
    .map((photo) => {
      const image = new Image();
      image.decoding = "async";
      image.src = photo.url;
      return image;
    });
}

function handleGalleryPreviewKeydown(event) {
  if (event.key === "ArrowLeft") {
    event.preventDefault();
    navigateGalleryPreview(-1);
  } else if (event.key === "ArrowRight") {
    event.preventDefault();
    navigateGalleryPreview(1);
  }
}

function populateOptions(options) {
  elements.resize.value = options.resize;
  elements.quality.value = String(options.quality);
  const match = parseGeometry(options.resize);
  elements.width.value = match?.width || "2000";
  elements.height.value = match?.height || "2000";
  elements.fit.value = match?.fit || "";
  elements.advanced.checked = !match || Number(match.width) < 1 || Number(match.height) < 1;
  setOptionsMode();
}

function simpleGeometry() {
  return `${elements.width.value}x${elements.height.value}${elements.fit.value}`;
}

function setOptionsMode() {
  const advanced = elements.advanced.checked;
  elements.resize.disabled = !advanced;
  for (const input of [elements.width, elements.height, elements.fit]) input.disabled = advanced;
  document.querySelector("#geometry-label").classList.toggle("hidden", !advanced);
  document.querySelector("#simple-resize").classList.toggle("hidden", advanced);
  document.querySelector("#fit-label").classList.toggle("hidden", advanced);
}

function toggleAdvanced() {
  if (elements.advanced.checked) {
    elements.resize.value = simpleGeometry();
  } else {
    const match = parseGeometry(elements.resize.value.trim());
    if (!match || Number(match.width) < 1 || Number(match.height) < 1) {
      elements.advanced.checked = true;
      elements.optionsError.textContent = "Enter positive width and height before switching to simple settings.";
      return;
    }
    elements.width.value = match.width;
    elements.height.value = match.height;
    elements.fit.value = match.fit;
  }
  elements.optionsError.textContent = "";
  setOptionsMode();
}

function showOptions() {
  if (state.exporting) return;
  populateOptions(state.options);
  elements.optionsError.textContent = "";
  elements.dialog.showModal();
}

function applyOptions(event) {
  event.preventDefault();
  const resize = elements.advanced.checked ? elements.resize.value.trim() : simpleGeometry();
  const quality = Number(elements.quality.value);
  try {
    state.options = validateOptions({ resize, quality });
  } catch (error) {
    elements.optionsError.textContent = error.message;
    return;
  }
  elements.dialog.close();
  updateExportDetails();
  showStatus("Export settings updated.", "success");
}

async function exportPhotos() {
  if (state.exporting || !state.history.present.length) return;
  state.exporting = true;
  const signature = exportSignature(state.history.present.map((photo) => photo.name), state.options);
  elements.progress.value = 0;
  elements.progress.max = state.history.present.length;
  elements.progress.classList.remove("hidden");
  elements.reveal.classList.add("hidden");
  updateExportDetails();
  showStatus(`Preparing ${state.history.present.length} photos…`, "busy");
  try {
    const result = await window.galleryApi.exportPhotos({
      albumId: state.albumId,
      photoIds: state.history.present.map(({ id }) => id),
      options: state.options,
    });
    state.savedSignature = signature;
    state.outputFolder = result.outputFolder;
    elements.reveal.classList.remove("hidden");
    showStatus(`${result.count} photos exported. Originals unchanged.`, "success");
  } catch (error) {
    showStatus(error.message, "error");
  } finally {
    state.exporting = false;
    elements.progress.classList.add("hidden");
    elements.reveal.classList.toggle("hidden", !state.outputFolder);
    updateExportDetails();
  }
}

function showStatus(message, kind) {
  elements.status.textContent = message;
  elements.status.className = `status ${kind}`;
}
