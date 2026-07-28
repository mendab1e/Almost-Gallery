const state = {
  folder: null,
  photos: [],
  options: { resize: "2000x2000", quality: 85 },
  draggingId: null,
};

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
window.galleryApi.onProgress(({ current, total }) => {
  showStatus(`Processing photo ${current} of ${total}…`, "busy");
});

async function openFolder() {
  try {
    const result = await window.galleryApi.openFolder();
    if (!result) return;
    state.folder = result.folder;
    state.photos = result.images;
    render();
    if (state.photos.length === 0) showStatus("No supported photos were found in this folder.", "error");
  } catch (error) {
    showStatus(error.message, "error");
  }
}

function render() {
  const hasFolder = Boolean(state.folder);
  elements.empty.classList.toggle("hidden", hasFolder);
  elements.workspace.classList.toggle("hidden", !hasFolder);
  elements.exportButton.disabled = state.photos.length === 0;
  if (!hasFolder) return;

  elements.folderName.textContent = state.folder.split("/").pop();
  elements.folderName.title = state.folder;
  elements.photoCount.textContent = `${state.photos.length} photo${state.photos.length === 1 ? "" : "s"}`;
  elements.grid.replaceChildren(...state.photos.map(createPhotoCard));
}

function createPhotoCard(photo, index) {
  const card = document.createElement("article");
  card.className = "photo-card";
  card.draggable = true;
  card.dataset.id = photo.id;

  const image = document.createElement("img");
  image.src = photo.url;
  image.alt = photo.name;
  image.draggable = false;

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

  card.addEventListener("dragstart", () => {
    state.draggingId = photo.id;
    card.classList.add("dragging");
  });
  card.addEventListener("dragend", () => {
    state.draggingId = null;
    card.classList.remove("dragging");
    document.querySelectorAll(".drag-over").forEach((item) => item.classList.remove("drag-over"));
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
  const from = state.photos.findIndex((photo) => photo.id === sourceId);
  const to = state.photos.findIndex((photo) => photo.id === targetId);
  if (from < 0 || to < 0 || from === to) return;
  const [moved] = state.photos.splice(from, 1);
  state.photos.splice(to, 0, moved);
  render();
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
    showStatus(`${result.count} photos saved to output. Click to reveal.`, "success", () => {
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
