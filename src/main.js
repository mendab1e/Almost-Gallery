const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { pathToFileURL } = require("node:url");
const { loadAlbumState } = require("./album-state");
const { isSupportedImage } = require("./export-utils");
const { resolveImageMagick } = require("./image-magick");
const { MANIFEST_FILENAME } = require("./manifest-store");
const { exportAlbum } = require("./photo-exporter");

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 760,
    minHeight: 560,
    titleBarStyle: "hiddenInset",
    backgroundColor: "#f5f3ee",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.loadFile(path.join(__dirname, "index.html"));
}

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

ipcMain.handle("folder:open", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Choose a photo folder",
    properties: ["openDirectory"],
  });
  if (result.canceled) return null;

  const folder = result.filePaths[0];
  const entries = await fs.readdir(folder, { withFileTypes: true });
  let images = entries
    .filter((entry) => entry.isFile() && isSupportedImage(entry.name))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
    .map((entry) => {
      const filePath = path.join(folder, entry.name);
      return {
        id: filePath,
        name: entry.name,
        path: filePath,
        url: pathToFileURL(filePath).href,
      };
    });

  let savedOptions = null;
  let projectLoaded = false;
  let loadWarning = null;
  try {
    const albumState = await loadAlbumState(folder, images);
    images = albumState.images;
    savedOptions = albumState.options;
    projectLoaded = albumState.projectLoaded;
  } catch (error) {
    loadWarning = `Could not load ${MANIFEST_FILENAME}: ${error.message}`;
  }

  return {
    folder,
    images,
    options: savedOptions,
    projectLoaded,
    loadWarning,
  };
});

ipcMain.handle("folder:reveal", async (_event, folder) => {
  if (typeof folder === "string") await shell.openPath(folder);
});

ipcMain.handle("photos:export", async (_event, request) => {
  return exportAlbum({
    folder: request?.folder,
    photos: request?.photos,
    options: request?.options,
    runMagick,
    onProgress: (progress) => {
      mainWindow?.webContents.send("photos:progress", progress);
    },
  });
});

async function runMagick(args) {
  const executable = await resolveImageMagick();
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      if (error.code === "ENOENT") {
        reject(
          new Error(
            "ImageMagick was not found. Install it with: brew install imagemagick",
          ),
        );
      } else {
        reject(error);
      }
    });
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `ImageMagick exited with code ${code}.`));
    });
  });
}
