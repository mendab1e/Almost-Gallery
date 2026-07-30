const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("galleryApi", {
  openFolder: () => ipcRenderer.invoke("folder:open"),
  generateThumbnails: (request) =>
    ipcRenderer.invoke("thumbnails:generate", request),
  exportPhotos: (request) => ipcRenderer.invoke("photos:export", request),
  revealFolder: (folder) => ipcRenderer.invoke("folder:reveal", folder),
  onProgress: (callback) => {
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on("photos:progress", listener);
    return () => ipcRenderer.removeListener("photos:progress", listener);
  },
  onThumbnail: (callback) => {
    const listener = (_event, thumbnail) => callback(thumbnail);
    ipcRenderer.on("photos:thumbnail", listener);
    return () => ipcRenderer.removeListener("photos:thumbnail", listener);
  },
});
