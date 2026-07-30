const state = {
  folder: null,
  photos: [],
  options: { resize: "2000x2000", quality: 85 },
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
  adjustGridSizeIndex,
  controlStates,
  folderOpenStatus,
  movePhotoById,
  reduceGalleryPreview,
} = window.galleryUi;

const elements = {
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

document.querySelector("#open-button").addEventListener("click", openFolder);
document.querySelector("#empty-open-button").addEventListener("click", openFolder);
document.querySelector("#options-button").addEventListener("click", showOptions);
document.querySelector("#close-options").addEventListener("click", () => elements.dialog.close());
document.querySelector("#reset-options").addEventListener("click", () => {
  elements.resize.value = "2000x2000";
  elements.quality.value = "85";
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
    state.photos.length,
  );
  elements.galleryPreviewImage.removeAttribute("src");
  state.galleryPreloads = [];
});
window.galleryApi.onProgress(({ current, total }) => {
  showStatus(`Processing photo ${current} of ${total}…`, "busy");
});
window.galleryApi.onThumbnail(({ folder, id, url, failed }) => {
  if (folder !== state.folder) return;
  const image = photoImages.get(id);
  if (!image) return;
  image.src = url;
  image.classList.toggle("original-fallback", failed);
});
updatePreviewSize();

async function openFolder() {
  try {
    const result = await window.galleryApi.openFolder();
    if (!result) return;
    state.folder = result.folder;
    state.photos = result.images;
    state.options = result.options || { resize: "2000x2000", quality: 85 };
    render();
    void requestThumbnails(result.folder, result.images);
    const status = folderOpenStatus(result);
    if (status) showStatus(status.message, status.kind);
  } catch (error) {
    showStatus(error.message, "error");
  }
}

function render() {
  const hasFolder = Boolean(state.folder);
  const controls = controlStates(state.photos.length);
  elements.empty.classList.toggle("hidden", hasFolder);
  elements.workspace.classList.toggle("hidden", !hasFolder);
  elements.exportButton.disabled = controls.exportDisabled;
  elements.galleryPreviewButton.disabled = controls.galleryPreviewDisabled;
  if (!hasFolder) return;

  elements.folderName.textContent = state.folder.split("/").pop();
  elements.folderName.title = state.folder;
  elements.photoCount.textContent = `${state.photos.length} photo${state.photos.length === 1 ? "" : "s"}`;
  photoCards.clear();
  photoImages.clear();
  elements.grid.replaceChildren(...state.photos.map(createPhotoCard));
}

function createPhotoCard(photo, index) {
  const card = document.createElement("article");
  card.className = "photo-card";
  card.draggable = true;
  card.dataset.id = photo.id;

  const image = document.createElement("img");
  image.alt = photo.name;
  image.draggable = false;
  image.loading = "lazy";
  image.decoding = "async";
  image.title = "Open gallery preview";
  image.addEventListener("click", () => {
    const currentIndex = state.photos.findIndex(
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

  card.addEventListener("dragstart", () => {
    state.draggingId = photo.id;
    state.suppressPreviewClick = true;
    card.classList.add("dragging");
  });
  card.addEventListener("dragend", () => {
    state.draggingId = null;
    card.classList.remove("dragging");
    document.querySelectorAll(".drag-over").forEach((item) => item.classList.remove("drag-over"));
    window.setTimeout(() => {
      state.suppressPreviewClick = false;
    }, 100);
  });
  card.addEventListener("dragover", (event) => {
    event.preventDefault();
    if (state.draggingId !== photo.id) card.classList.add("drag-over");
  });
  card.addEventListener("dragleave", () => card.classList.remove("drag-over"));
  card.addEventListener("drop", (event) => {
    event.preventDefault();
    card.classList.remove("drag-over");
    movePhoto(state.draggingId, photo.id);
  });
  return card;
}

function movePhoto(sourceId, targetId) {
  const reordered = movePhotoById(state.photos, sourceId, targetId);
  if (reordered === state.photos) return;
  state.photos = reordered;
  syncGridOrder();
}

function syncGridOrder() {
  const fragment = document.createDocumentFragment();
  state.photos.forEach((photo, index) => {
    const card = photoCards.get(photo.id);
    if (!card) return;
    card.querySelector(".order").textContent = String(index).padStart(3, "0");
    fragment.append(card);
  });
  elements.grid.append(fragment);
}

async function requestThumbnails(folder, photos) {
  try {
    await window.galleryApi.generateThumbnails({
      folder,
      photos: photos.map(({ id, path }) => ({ id, path })),
    });
  } catch (error) {
    if (folder === state.folder) showStatus(error.message, "error");
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
    state.photos.length,
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
    state.photos.length,
  );
  renderGalleryPreview();
}

function renderGalleryPreview() {
  const photo = state.photos[state.galleryPreview.index];
  if (!photo) return;
  const controls = controlStates(
    state.photos.length,
    state.galleryPreview.index,
  );
  elements.galleryPreviewImage.src = photo.url;
  elements.galleryPreviewImage.alt = photo.name;
  elements.galleryPreviewName.textContent = photo.name;
  elements.galleryPreviewPosition.textContent = `${state.galleryPreview.index + 1} of ${state.photos.length}`;
  elements.previousPhoto.disabled = controls.previousDisabled;
  elements.nextPhoto.disabled = controls.nextDisabled;
  preloadAdjacentGalleryPhotos();
}

function preloadAdjacentGalleryPhotos() {
  state.galleryPreloads = [-1, 1]
    .map((offset) => state.photos[state.galleryPreview.index + offset])
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

function showOptions() {
  elements.resize.value = state.options.resize;
  elements.quality.value = String(state.options.quality);
  elements.optionsError.textContent = "";
  elements.dialog.showModal();
}

function applyOptions(event) {
  event.preventDefault();
  const resize = elements.resize.value.trim();
  const quality = Number(elements.quality.value);
  if (!/^\d+x\d+(?:[><^!])?$/.test(resize) || !Number.isInteger(quality) || quality < 1 || quality > 100) {
    elements.optionsError.textContent = "Enter valid resize geometry and a quality from 1 to 100.";
    return;
  }
  state.options = { resize, quality };
  elements.dialog.close();
  showStatus(`Export options: ${resize}, quality ${quality}`, "success");
}

async function exportPhotos() {
  elements.exportButton.disabled = true;
  showStatus(`Preparing ${state.photos.length} photos…`, "busy");
  try {
    const result = await window.galleryApi.exportPhotos({
      folder: state.folder,
      photos: state.photos.map(({ path }) => ({ path })),
      options: state.options,
    });
    showStatus(`${result.count} photos and export settings saved. Click to reveal output.`, "success", () => {
      window.galleryApi.revealFolder(result.outputFolder);
    });
  } catch (error) {
    showStatus(error.message, "error");
  } finally {
    elements.exportButton.disabled = state.photos.length === 0;
  }
}

function showStatus(message, kind, onClick) {
  elements.status.textContent = message;
  elements.status.className = `status ${kind}`;
  elements.status.onclick = onClick || null;
  elements.status.classList.toggle("clickable", Boolean(onClick));
  if (kind === "success" && !onClick) {
    window.setTimeout(() => elements.status.classList.add("hidden"), 3500);
  }
}
