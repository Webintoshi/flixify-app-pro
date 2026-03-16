const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { app, BrowserWindow, shell } = require("electron");

app.disableHardwareAcceleration();

function normalizeApiBaseUrl(value) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) {
    return null;
  }

  try {
    const parsed = new URL(trimmed);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return null;
    }
    return parsed.toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}

function readExternalRuntimeConfig() {
  try {
    const configPath = path.join(app.getPath("userData"), "app-config.json");
    if (!fs.existsSync(configPath)) {
      return null;
    }

    const parsed = JSON.parse(fs.readFileSync(configPath, "utf8"));
    if (!parsed || typeof parsed !== "object") {
      return null;
    }

    return normalizeApiBaseUrl(parsed.apiBaseUrl);
  } catch {
    return null;
  }
}

function resolveApiBaseUrlOverride() {
  const fromEnv = normalizeApiBaseUrl(process.env.FLIXIFY_API_BASE_URL);
  if (fromEnv) {
    return fromEnv;
  }

  return readExternalRuntimeConfig();
}

async function createMainWindow() {
  const mainWindow = new BrowserWindow({
    width: 1366,
    height: 820,
    minWidth: 1024,
    minHeight: 640,
    autoHideMenuBar: true,
    backgroundColor: "#05070B",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  const indexPath = path.join(__dirname, "..", "web-dist", "index.html");
  if (!fs.existsSync(indexPath)) {
    mainWindow.loadURL(
      "data:text/html;charset=UTF-8," +
        encodeURIComponent(
          "<h2>Flixify Pro paketi hazir degil.</h2><p>Calistirmadan once `npm run prepare:win` komutunu calistirin.</p>"
        )
    );
    return;
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  // Prevent stale hashed CSS/JS from previous installs causing broken layouts.
  await mainWindow.webContents.session.clearCache().catch(() => undefined);
  const entryUrl = pathToFileURL(indexPath);
  const apiBaseUrlOverride = resolveApiBaseUrlOverride();
  if (apiBaseUrlOverride) {
    entryUrl.searchParams.set("apiBaseUrl", apiBaseUrlOverride);
  }

  void mainWindow.loadURL(entryUrl.toString());
}

app.whenReady().then(() => {
  void createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
