const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { Menu, app, BrowserWindow, shell } = require("electron");

app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

if (
  process.env.FLIXIFY_DISABLE_HARDWARE_ACCELERATION === "1" ||
  process.env.FLIXIFY_DISABLE_HARDWARE_ACCELERATION === "true"
) {
  app.disableHardwareAcceleration();
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
}

function canOpenExternalUrl(value) {
  if (typeof value !== "string") {
    return false;
  }

  try {
    const parsed = new URL(value);
    return ["https:", "http:", "mailto:", "tel:"].includes(parsed.protocol);
  } catch {
    return false;
  }
}

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

    const apiBaseUrl = normalizeApiBaseUrl(parsed.apiBaseUrl);
    const webAppUrl = normalizeWebAppUrl(parsed.webAppUrl);
    return {
      apiBaseUrl,
      webAppUrl
    };
  } catch {
    return null;
  }
}

function normalizeWebAppUrl(value) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const parsed = new URL(trimmed);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

function resolveRuntimeOverrides() {
  const fromEnv = normalizeApiBaseUrl(process.env.FLIXIFY_API_BASE_URL);
  const fromWebEnv = normalizeWebAppUrl(process.env.FLIXIFY_WEB_APP_URL);
  const fromPublicWebEnv = normalizeWebAppUrl(process.env.PUBLIC_APP_BASE_URL);
  const fromViewerWebosEnv = normalizeWebAppUrl(process.env.VITE_WEB_APP_URL);
  const fromConfig = readExternalRuntimeConfig();

  return {
    apiBaseUrl: fromEnv ?? fromConfig?.apiBaseUrl ?? null,
    webAppUrl: fromWebEnv ?? fromPublicWebEnv ?? fromViewerWebosEnv ?? fromConfig?.webAppUrl ?? null
  };
}

async function hardReload(mainWindow) {
  try {
    await mainWindow.webContents.session.clearCache();
  } catch {
    // noop
  }
  mainWindow.webContents.reloadIgnoringCache();
}

async function ensureVersionedCache(mainWindow) {
  const markerPath = path.join(app.getPath("userData"), "cache-marker.txt");
  const markerValue = `${app.getVersion()}::${process.platform}`;
  let previousMarker = null;

  try {
    previousMarker = fs.readFileSync(markerPath, "utf8").trim() || null;
  } catch {
    previousMarker = null;
  }

  if (previousMarker === markerValue) {
    return;
  }

  try {
    await mainWindow.webContents.session.clearCache();
  } catch {
    // noop
  }

  try {
    fs.writeFileSync(markerPath, `${markerValue}\n`, "utf8");
  } catch {
    // noop
  }
}

function createAppMenu(mainWindow) {
  const template = [
    {
      label: "Flixify Pro",
      submenu: [
        {
          label: "Guncelle",
          accelerator: "CmdOrCtrl+Shift+R",
          click: () => {
            void hardReload(mainWindow);
          }
        },
        { type: "separator" },
        { role: process.platform === "darwin" ? "close" : "quit" }
      ]
    },
    {
      label: "View",
      submenu: [
        {
          label: "Yeniden Yukle",
          accelerator: "CmdOrCtrl+R",
          click: () => {
            mainWindow.webContents.reload();
          }
        },
        {
          label: "Onbelleksiz Yeniden Yukle",
          accelerator: "CmdOrCtrl+Alt+R",
          click: () => {
            void hardReload(mainWindow);
          }
        },
        { type: "separator" },
        { role: "togglefullscreen" },
        { role: "toggleDevTools" }
      ]
    },
    {
      label: "Window",
      submenu: [{ role: "minimize" }, { role: "zoom" }, { role: "front" }]
    }
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function createMainWindow() {
  if (BrowserWindow.getAllWindows().length > 0) {
    return BrowserWindow.getAllWindows()[0];
  }

  const windowIconPath = path.join(__dirname, "..", "web-dist", "favicon.png");
  const windowIcon = fs.existsSync(windowIconPath) ? windowIconPath : undefined;

  const mainWindow = new BrowserWindow({
    width: 1366,
    height: 820,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: "#05070B",
    icon: windowIcon,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      spellcheck: false
    }
  });

  const indexPath = path.join(__dirname, "..", "web-dist", "index.html");
  const runtime = resolveRuntimeOverrides();

  if (!runtime.webAppUrl && !fs.existsSync(indexPath)) {
    mainWindow.loadURL(
      "data:text/html;charset=UTF-8," +
        encodeURIComponent(
          "<h2>Flixify Pro paketi hazir degil.</h2><p>Calistirmadan once `npm run prepare:desktop` komutunu calistirin.</p>"
        )
    );
    return;
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (canOpenExternalUrl(url)) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });

  const entryUrl = runtime.webAppUrl ? new URL(runtime.webAppUrl) : pathToFileURL(indexPath);
  const entryOrigin = entryUrl.protocol === "file:" ? null : entryUrl.origin;
  if (runtime.apiBaseUrl) {
    entryUrl.searchParams.set("apiBaseUrl", runtime.apiBaseUrl);
  }
  const platform =
    process.platform === "win32"
      ? "windows-desktop"
      : process.platform === "darwin"
        ? "macos-desktop"
        : process.platform === "linux"
          ? "linux-desktop"
          : "desktop-app";
  entryUrl.searchParams.set("platform", platform);
  entryUrl.searchParams.set("appVersion", app.getVersion());

  mainWindow.webContents.on("will-navigate", (event, url) => {
    try {
      const nextUrl = new URL(url);
      const isFileNavigation = nextUrl.protocol === "file:";
      const isAppOriginNavigation = entryOrigin ? nextUrl.origin === entryOrigin : false;
      if (isFileNavigation || isAppOriginNavigation) {
        return;
      }
    } catch {
      // Invalid URL should not navigate.
    }

    event.preventDefault();
    if (canOpenExternalUrl(url)) {
      void shell.openExternal(url);
    }
  });

  let failedMainFrameRetryCount = 0;
  mainWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame || mainWindow.isDestroyed()) {
      return;
    }

    if (errorCode === -3) {
      return;
    }

    const isTransientNetworkError = new Set([-2, -7, -21, -105, -106, -118, -137]).has(errorCode);
    if (isTransientNetworkError && failedMainFrameRetryCount < 2) {
      failedMainFrameRetryCount += 1;
      const delayMs = 1000 * failedMainFrameRetryCount;
      setTimeout(() => {
        if (!mainWindow.isDestroyed()) {
          void mainWindow.loadURL(entryUrl.toString());
        }
      }, delayMs);
      return;
    }

    void mainWindow.loadURL(
      "data:text/html;charset=UTF-8," +
        encodeURIComponent(
          `<h2>Flixify Pro baglanti sorunu</h2><p>Sayfa yuklenemedi (${errorCode}).</p><p>${errorDescription || validatedURL || ""}</p><p>CmdOrCtrl+R ile yeniden deneyin.</p>`
        )
    );
  });
  mainWindow.webContents.on("did-finish-load", () => {
    failedMainFrameRetryCount = 0;
  });

  mainWindow.webContents.on("render-process-gone", () => {
    if (!mainWindow.isDestroyed()) {
      setTimeout(() => {
        if (!mainWindow.isDestroyed()) {
          void hardReload(mainWindow);
        }
      }, 800);
    }
  });

  mainWindow.on("unresponsive", () => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.reload();
    }
  });

  await ensureVersionedCache(mainWindow);
  void mainWindow.loadURL(entryUrl.toString());
  mainWindow.once("ready-to-show", () => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
  createAppMenu(mainWindow);
  return mainWindow;
}

app.whenReady().then(() => {
  void createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createMainWindow();
    }
  });
});

app.on("second-instance", () => {
  const [mainWindow] = BrowserWindow.getAllWindows();
  if (!mainWindow) {
    void createMainWindow();
    return;
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  mainWindow.focus();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
