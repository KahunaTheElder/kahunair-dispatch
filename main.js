// Build v0.2.1 - Production release with credential fixes
const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const isDev = require('electron-is-dev');
const fs = require('fs');
const http = require('http');
const os = require('os');

// EMERGENCY LOGGING - writes to a file even if everything fails
const writeEmergencyLog = (msg) => {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${msg}\n`;
  try {
    const logDir = path.join(os.homedir(), '.kahunair');
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    fs.appendFileSync(path.join(logDir, 'emergency-startup.log'), line);
  } catch (e) {
    // Silent fail
  }
  console.log(msg);
};

writeEmergencyLog('================================================================');
writeEmergencyLog('[EMERGENCY LOG] Electron app starting');
writeEmergencyLog('[EMERGENCY LOG] Time: ' + new Date().toISOString());
writeEmergencyLog('[EMERGENCY LOG] Node version: ' + process.version);
writeEmergencyLog('[EMERGENCY LOG] Electron version: ' + process.versions.electron);

// ===== CRITICAL: Load .env BEFORE any credential checks =====
try {
  writeEmergencyLog('[STEP 1] Attempting to load .env file...');

  const possiblePaths = [
    path.join(__dirname, '.env'),
    path.join(__dirname, '..', '.env'),
    path.join(os.homedir(), '.kahunair', '.env'),
    // Fallback: check if running from packaged app bundle
    path.join(__dirname, '..', '..', '..', '.env'),
    // Current working directory
    path.join(process.cwd(), '.env')
  ];

  console.log('[Electron Main] __dirname: ', __dirname);
  console.log('[Electron Main] process.cwd():', process.cwd());
  console.log('[Electron Main] Loading .env for credential verification...');
  let envLoaded = false;

  for (const envPath of possiblePaths) {
    const exists = fs.existsSync(envPath);
    const status = exists ? '✓ FOUND' : '✗ not';
    console.log(`[Electron Main]   ${status}: ${envPath}`);
    if (exists) {
      console.log('[Electron Main] ✓ Loading .env from:', envPath);
      require('dotenv').config({ path: envPath });
      envLoaded = true;

      // Verify it loaded
      console.log('[Electron Main] Credentials after loading:');
      console.log('[Electron Main]   - ONAIR_VA_COMPANY_ID:', process.env.ONAIR_VA_COMPANY_ID ? '✓' : '✗');
      console.log('[Electron Main]   - ONAIR_VA_API_KEY:', process.env.ONAIR_VA_API_KEY ? '✓' : '✗');
      console.log('[Electron Main]   - SI_API_KEY:', process.env.SI_API_KEY ? '✓' : '✗');
      break;
    }
  }

  if (!envLoaded) {
    console.warn('[Electron Main] ⚠ No .env file found!');
    console.warn('[Electron Main] Attempted paths:');
    possiblePaths.forEach(p => console.warn('[Electron Main]   - ' + p));
  } else {
    console.log('[Electron Main] ✓ .env loaded successfully');
  }

  writeEmergencyLog('[STEP 1] PASSED - .env loaded successfully');
} catch (error) {
  writeEmergencyLog('[STEP 1] FAILED - Exception loading .env: ' + error.message);
  console.error('[Electron Main] Error loading .env:', error.message);
}

// Load local modules with error catching
let logger = null;
let CredentialsVerifier = null;
let AutoFlightLoader = null;

try {
  writeEmergencyLog('[STEP 2] Requiring src/logger...');
  logger = require('./src/logger');
  writeEmergencyLog('[STEP 2] PASSED - logger loaded');
} catch (error) {
  writeEmergencyLog('[STEP 2] FAILED - Cannot load logger: ' + error.message);
  writeEmergencyLog('[STEP 2] Stack: ' + error.stack);
  console.error('Failed to load logger:', error);
}

try {
  writeEmergencyLog('[STEP 3] Requiring src/credentialsVerifier...');
  CredentialsVerifier = require('./src/credentialsVerifier');
  writeEmergencyLog('[STEP 3] PASSED - credentialsVerifier loaded');
} catch (error) {
  writeEmergencyLog('[STEP 3] FAILED - Cannot load credentialsVerifier: ' + error.message);
  writeEmergencyLog('[STEP 3] Stack: ' + error.stack);
  console.error('Failed to load credentialsVerifier:', error);
}

try {
  writeEmergencyLog('[STEP 4] Requiring src/autoFlightLoader...');
  AutoFlightLoader = require('./src/autoFlightLoader');
  writeEmergencyLog('[STEP 4] PASSED - autoFlightLoader loaded');
} catch (error) {
  writeEmergencyLog('[STEP 4] FAILED - Cannot load autoFlightLoader: ' + error.message);
  writeEmergencyLog('[STEP 4] Stack: ' + error.stack);
  console.error('Failed to load autoFlightLoader:', error);
}

// Try to load SimConnect service (may fail on non-Windows or if module not available)
let simConnectService = null;
try {
  writeEmergencyLog('[STEP 5] Attempting to load SimConnect service...');
  simConnectService = require('./src/simConnectService');
  writeEmergencyLog('[STEP 5] PASSED - SimConnect service loaded');
  console.log('[Electron] SimConnect service loaded');
} catch (error) {
  writeEmergencyLog('[STEP 5] INFO - SimConnect not available (this is normal): ' + error.message);
  console.warn('[Electron] SimConnect service unavailable:', error.message);
  console.warn('[Electron] This is normal on WSL or if MSFS-simconnect-api-wrapper is not properly installed');
}

writeEmergencyLog('[MODULE LOADING] All module requires completed');

// Check if running in production mode
// Production mode: either NODE_ENV=production or frontend/dist exists
const isProduction = process.env.NODE_ENV === 'production' || fs.existsSync(path.join(__dirname, 'frontend', 'dist'));
console.log('[Electron] Mode: ', isProduction ? 'PRODUCTION' : 'DEVELOPMENT');
console.log('[Electron] isDev:', isDev, '| isProduction:', isProduction);

let mainWindow;
let backendProcess;
let devServerProcess;
let simConnectInitialized = false;

// ===== SHUTDOWN SAFEGUARD SYSTEM =====
const getCleanupMarkerPath = () => {
  const configDir = path.join(os.homedir(), '.kahunair');
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }
  return path.join(configDir, '.cleanup-marker');
};

const writeCleanupMarker = () => {
  try {
    const markerPath = getCleanupMarkerPath();
    fs.writeFileSync(markerPath, JSON.stringify({
      timestamp: new Date().toISOString(),
      version: app.getVersion(),
      status: 'clean'
    }));
    console.log('[Electron] ✓ Cleanup marker written:', markerPath);
  } catch (error) {
    console.error('[Electron] Failed to write cleanup marker:', error.message);
  }
};

const deleteCleanupMarker = () => {
  try {
    const markerPath = getCleanupMarkerPath();
    if (fs.existsSync(markerPath)) {
      fs.unlinkSync(markerPath);
      console.log('[Electron] ✓ Cleanup marker deleted');
    }
  } catch (error) {
    console.error('[Electron] Failed to delete cleanup marker:', error.message);
  }
};

const verifyPreviousCleanup = () => {
  try {
    const markerPath = getCleanupMarkerPath();
    if (fs.existsSync(markerPath)) {
      console.log('[Electron] ✓ Previous session cleaned up successfully');
      return true;
    } else {
      console.warn('[Electron] ⚠ No cleanup marker found - previous session may not have shut down properly');
      return false;
    }
  } catch (error) {
    console.error('[Electron] Error checking cleanup marker:', error.message);
    return false;
  }
};

/**
 * Clear all application caches on startup to ensure fresh assets
 */
const clearAppCache = async () => {
  try {
    console.log('[Electron] Clearing application caches...');

    // Clear session cache
    const session = require('electron').session.defaultSession;
    if (session) {
      await session.clearCache();
      console.log('[Electron] ✓ Session cache cleared');
    }

    // DO NOT CLEAR LOCALSTORAGE - We need to persist user preferences like VA profile
    // Clearing localStorage breaks user-saved configurations between sessions
    // Users should be able to save VA profile once and have it persist

    // if (session) {
    //   await session.clearStorageData({
    //     storages: ['appcache', 'cookies', 'fileSystems', 'indexdb', 'localstorage', 'shadercache', 'websql', 'serviceWorkers']
    //   });
    //   console.log('[Electron] ✓ Storage data cleared');
    // }

    // Clear any dist caching issues by checking file timestamps
    const distPath = path.join(__dirname, 'frontend', 'dist');
    if (fs.existsSync(distPath)) {
      console.log('[Electron] ✓ Frontend dist directory confirmed present at startup');
    }
  } catch (error) {
    console.error('[Electron] Error clearing caches:', error.message);
  }
};

/**
 * Kill any hanging node processes on backend ports before startup
 * This prevents "port already in use" errors from previous crashed instances
 */
const killHangingProcesses = async () => {
  console.log('[Electron] Checking for hanging backend processes...');
  const { exec } = require('child_process');
  const { promisify } = require('util');
  const execAsync = promisify(exec);

  try {
    // On Windows: find processes using ports 3000-3004
    if (process.platform === 'win32') {
      for (const port of [3000, 3001, 3002, 3003, 3004]) {
        try {
          // Use netstat to find PID using the port
          const { stdout } = await execAsync(`netstat -ano | find "${port}"`, { shell: true });
          if (stdout.includes('LISTENING')) {
            // Extract PID from netstat output
            const match = stdout.match(new RegExp(`\\s+(\\d+)\\s*$`, 'm'));
            if (match) {
              const pid = match[1];
              console.log(`[Electron] Found process ${pid} on port ${port}, killing...`);
              try {
                process.kill(pid, 'SIGTERM');
                // Wait a moment for graceful shutdown
                await new Promise(resolve => setTimeout(resolve, 500));
                // Force kill if still running
                try {
                  process.kill(pid, 'SIGKILL');
                } catch (e) {
                  // Process already dead, that's fine
                }
              } catch (e) {
                // Process already dead or permission denied, continue
              }
            }
          }
        } catch (e) {
          // Port not in use, continue
        }
      }
      console.log('[Electron] ✓ Hanging process cleanup complete');
    }
  } catch (error) {
    console.warn('[Electron] Could not clean hanging processes:', error.message);
    // Non-fatal - continue startup anyway
  }
};

/**
 * Wait for backend to actually be ready (responding to health checks)
 * Uses native http module for better reliability in Electron main process
 */
const waitForBackendReady = async (maxWaitMs = 30000) => {
  console.log('[Electron] Waiting for backend to be ready...');
  const startTime = Date.now();

  const testPort = (port) => {
    return new Promise((resolve) => {
      const req = http.get(`http://localhost:${port}/health`, (res) => {
        req.abort();
        resolve(res.statusCode === 200);
      });

      req.on('error', () => {
        resolve(false);
      });

      req.setTimeout(2000, () => {
        req.abort();
        resolve(false);
      });
    });
  };

  while (Date.now() - startTime < maxWaitMs) {
    // Test all possible backend ports
    for (const port of [3000, 3001, 3002, 3003, 3004]) {
      if (await testPort(port)) {
        console.log(`[Electron] ✓ Backend is ready and responding on port ${port}`);
        return true; // Backend is ready
      }
    }
    // Wait 500ms before retrying
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  console.warn('[Electron] ⚠ Backend did not respond within 30 seconds - proceeding anyway');
  return false;
};

/**
 * Perform full cleanup with visible shutdown dialog
 * Displays progress to user and ensures all services are terminated
 */
const performFullCleanupWithDialog = async () => {
  return new Promise((resolve) => {
    console.log('[Electron] Starting full cleanup sequence...');
    deleteCleanupMarker(); // Mark app as "shutting down"

    const shutdownWindow = new BrowserWindow({
      width: 750,
      height: 600,
      modal: true,
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true
      }
    });

    // Create simple shutdown dialog HTML
    const shutdownHTML = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body {
            margin: 0;
            padding: 20px;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            display: flex;
            flex-direction: column;
            justify-content: center;
            align-items: center;
            height: 100vh;
            text-align: center;
          }
          h1 { margin: 0 0 20px 0; font-size: 20px; }
          .spinner {
            border: 3px solid rgba(255,255,255,0.3);
            border-top: 3px solid white;
            border-radius: 50%;
            width: 40px;
            height: 40px;
            animation: spin 1s linear infinite;
            margin: 20px auto;
          }
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
          .status {
            margin-top: 20px;
            font-size: 12px;
            opacity: 0.9;
          }
        </style>
      </head>
      <body>
        <h1>Shutting Down KahunaAir Dispatch</h1>
        <div class="spinner"></div>
        <div class="status">
          <p>Please wait while services are being cleaned up...</p>
          <p id="status-text">Terminating backend process...</p>
        </div>
      </body>
      </html>
    `;

    shutdownWindow.loadURL(`data:text/html,${encodeURIComponent(shutdownHTML)}`);
    shutdownWindow.show();

    // Perform cleanup in sequence
    (async () => {
      try {
        // Step 0: Disconnect SimConnect
        if (simConnectService) {
          console.log('[Electron] Disconnecting SimConnect...');
          try {
            simConnectService.disconnect();
            console.log('[Electron] ✓ SimConnect disconnected');
          } catch (error) {
            console.warn('[Electron] Error disconnecting SimConnect:', error.message);
          }
        }

        // Step 1: Terminate backend with proper SIGTERM → SIGKILL sequence
        if (backendProcess && !backendProcess.killed) {
          console.log('[Electron] Terminating backend process (PID:', backendProcess.pid, ')...');

          // Send SIGTERM first (graceful shutdown)
          backendProcess.kill('SIGTERM');

          // Wait up to 2 seconds for graceful shutdown
          const sigTermWait = new Promise((resolve) => {
            const exitHandler = () => {
              console.log('[Electron] ✓ Backend exited gracefully after SIGTERM');
              resolve(true);
            };
            backendProcess.once('exit', exitHandler);
            setTimeout(() => {
              backendProcess.removeListener('exit', exitHandler);
              resolve(false); // Did not exit in time
            }, 2000);
          });

          const gracefulExit = await sigTermWait;

          // If still alive, force kill
          if (!gracefulExit && backendProcess && !backendProcess.killed) {
            console.log('[Electron] SIGTERM timeout, forcing SIGKILL...');
            backendProcess.kill('SIGKILL');

            // Wait for SIGKILL to take effect
            await new Promise((resolve) => {
              backendProcess.once('exit', () => {
                console.log('[Electron] ✓ Backend killed with SIGKILL');
                resolve();
              });
              setTimeout(resolve, 1000); // Final timeout
            });
          }

          backendProcess = null;
        }

        // Step 2: Kill dev server
        if (devServerProcess && !devServerProcess.killed) {
          console.log('[Electron] Killing Vite dev server...');
          devServerProcess.kill('SIGTERM');

          // Wait for dev server to exit (with timeout)
          await new Promise((resolve) => {
            devServerProcess.once('exit', () => {
              console.log('[Electron] ✓ Vite dev server exited');
              resolve();
            });
            setTimeout(() => {
              console.log('[Electron] Dev server exit timeout, forcing kill');
              if (!devServerProcess.killed) {
                devServerProcess.kill('SIGKILL');
              }
              resolve();
            }, 1000);
          });
          devServerProcess = null;
        }

        // Step 3: Kill hanging processes
        console.log('[Electron] Cleaning up hanging processes...');
        await killHangingProcesses();
        console.log('[Electron] ✓ Hanging processes cleaned');

        // Step 4: Clear session
        console.log('[Electron] Clearing app session...');
        await clearAppCache();
        console.log('[Electron] ✓ App session cleared');

        // Step 5: Write cleanup marker
        console.log('[Electron] Writing cleanup marker...');
        writeCleanupMarker();

        // Brief pause for visual feedback
        await new Promise(done => setTimeout(done, 1000));

        console.log('[Electron] ✓ Full cleanup complete');
        shutdownWindow.close();
        resolve();
      } catch (error) {
        console.error('[Electron] Error during cleanup:', error);
        shutdownWindow.close();
        resolve();
      }
    })();
  });
};

const WINDOW_STATE_PATH = () => path.join(app.getPath('userData'), 'window-state.json');

const loadWindowState = () => {
  try {
    const p = WINDOW_STATE_PATH();
    if (fs.existsSync(p)) {
      return JSON.parse(fs.readFileSync(p, 'utf8'));
    }
  } catch { /* ignore corrupt file */ }
  return { width: 1280, height: 720, x: undefined, y: undefined };
};

const saveWindowState = (win) => {
  try {
    if (win.isMaximized() || win.isMinimized()) return;
    const b = win.getBounds();
    fs.writeFileSync(WINDOW_STATE_PATH(), JSON.stringify({ width: b.width, height: b.height, x: b.x, y: b.y }), 'utf8');
  } catch { /* ignore */ }
};

const createWindow = (vitePort = 5173) => {
  const winState = loadWindowState();
  // Create the browser window
  mainWindow = new BrowserWindow({
    width: winState.width,
    height: winState.height,
    x: winState.x,
    y: winState.y,
    minWidth: 1000,
    minHeight: 500,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    icon: path.join(__dirname, 'assets/icon.png')
  });

  // Set up IPC handlers for telemetry
  _setupIpcHandlers(mainWindow);

  let url;
  if (isDev && !isProduction) {
    url = `http://localhost:${vitePort}`;
    console.log('[Electron] Dev Mode: Loading from Vite dev server at', url);
  } else {
    // In production, load from localhost:3000 (backend will serve static files)
    // Frontend will do port discovery via JavaScript to find actual backend port
    url = 'http://localhost:3000/';
    console.log('[Electron] Production Mode: Loading from', url);
    console.log('[Electron] Frontend will discover actual backend port (may be 3000, 3001, etc)');
  }

  // Load with simple attempt - frontend will handle port rediscovery if needed
  mainWindow.loadURL(url);
  console.log('[Electron] ✓ mainWindow.loadURL() called for:', url);

  // Handle loading errors
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.error('[Electron] Failed to load URL:', url);
    console.error('[Electron] Error:', errorDescription);
  });

  mainWindow.webContents.on('did-finish-load', () => {
    console.log('[Electron] ✓ Window content finished loading');
  });

  mainWindow.webContents.on('did-start-loading', () => {
    console.log('[Electron] ℹ Window started loading');
  });

  // DevTools disabled by default for production UX
  // Uncomment line below if you need devTools during development:
  // mainWindow.webContents.openDevTools();

  // Save window position/size on move and resize
  mainWindow.on('resize', () => saveWindowState(mainWindow));
  mainWindow.on('move', () => saveWindowState(mainWindow));

  // Handle window close request - save state then cleanup backend process
  mainWindow.on('close', (event) => {
    saveWindowState(mainWindow);
    if (backendProcess && !backendProcess.killed) {
      console.log('[Electron] Terminating backend process...');
      backendProcess.kill('SIGTERM');
    }
  });

  // Handle window closed - cleanup references
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
};

const startBackendServer = () => {
  return new Promise((resolve) => {
    // Create a debug log file for Electron main process - COMPREHENSIVE LOGGING
    const debugLogPath = path.join(os.homedir(), '.kahunair', 'electron-debug.log');
    const logDebug = (msg) => {
      const timestamp = new Date().toISOString();
      const line = `[${timestamp}] ${msg}\n`;
      console.log(msg);
      try {
        const dir = path.dirname(debugLogPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.appendFileSync(debugLogPath, line);
      } catch (e) {
        console.error('Failed to write debug log:', e.message);
      }
    };

    logDebug('═════════════════════════════════════════════════════════');
    logDebug('[BACKEND STARTUP] Starting backend server...');
    logDebug('[BACKEND STARTUP] Time: ' + new Date().toISOString());
    logDebug('[BACKEND STARTUP] Electron version: ' + process.versions.electron);
    logDebug('[BACKEND STARTUP] Node version: ' + process.versions.node);

    // ===== ENVIRONMENT DIAGNOSTICS =====
    logDebug('[BACKEND STARTUP] ===== ENVIRONMENT DIAGNOSTICS =====');
    logDebug('[BACKEND STARTUP] Platform: ' + process.platform);
    logDebug('[BACKEND STARTUP] Architecture: ' + process.arch);
    logDebug('[BACKEND STARTUP] Node executable: ' + process.execPath);
    logDebug('[BACKEND STARTUP] Process PID: ' + process.pid);
    logDebug('[BACKEND STARTUP] Current working directory (process.cwd): ' + process.cwd());
    logDebug('[BACKEND STARTUP] __dirname: ' + __dirname);
    logDebug('[BACKEND STARTUP] __filename: ' + __filename);

    // ===== FILE SYSTEM CHECKS =====
    logDebug('[BACKEND STARTUP] ===== FILE SYSTEM CHECKS =====');
    const indexPath = path.join(__dirname, 'index.js');
    const indexExists = fs.existsSync(indexPath);
    logDebug('[BACKEND STARTUP] index.js path: ' + indexPath);
    logDebug('[BACKEND STARTUP] index.js exists: ' + (indexExists ? 'YES ✓' : 'NO ✗ CRITICAL!'));

    if (indexExists) {
      const stats = fs.statSync(indexPath);
      logDebug('[BACKEND STARTUP] index.js size: ' + stats.size + ' bytes');
      logDebug('[BACKEND STARTUP] index.js modified: ' + stats.mtime.toISOString());
    }

    const nodeModulesPath = path.join(__dirname, 'node_modules');
    const nodeModulesExists = fs.existsSync(nodeModulesPath);
    logDebug('[BACKEND STARTUP] node_modules path: ' + nodeModulesPath);
    logDebug('[BACKEND STARTUP] node_modules exists: ' + (nodeModulesExists ? 'YES ✓' : 'NO ✗ CRITICAL!'));

    if (nodeModulesExists) {
      const contents = fs.readdirSync(nodeModulesPath).slice(0, 10);
      logDebug('[BACKEND STARTUP] node_modules contents (first 10): ' + contents.join(', '));
    }

    const packageJsonPath = path.join(__dirname, 'package.json');
    logDebug('[BACKEND STARTUP] package.json exists: ' + (fs.existsSync(packageJsonPath) ? 'YES ✓' : 'NO ✗'));

    // ===== SPAWN CONFIGURATION AUDIT =====
    logDebug('[BACKEND STARTUP] ===== SPAWN CONFIGURATION =====');
    logDebug('[BACKEND STARTUP] Command: node');
    logDebug('[BACKEND STARTUP] Arguments: ["index.js"]');
    logDebug('[BACKEND STARTUP] Options.cwd: ' + __dirname);
    logDebug('[BACKEND STARTUP] Options.stdio: ["ignore", "pipe", "pipe"]');
    logDebug('[BACKEND STARTUP] Options.shell: ' + (process.platform === 'win32'));
    logDebug('[BACKEND STARTUP] Options.detached: false');
    logDebug('[BACKEND STARTUP] Options.env: (copying process.env)');

    // ===== ENVIRONMENT VARIABLES (PARTIAL DUMP) =====
    logDebug('[BACKEND STARTUP] ===== KEY ENVIRONMENT VARIABLES =====');
    const envKeys = ['PATH', 'NODE_ENV', 'ONAIR_VA_COMPANY_ID', 'ONAIR_VA_API_KEY', 'SI_API_KEY'];
    envKeys.forEach(key => {
      const value = process.env[key];
      if (key.includes('API') || key.includes('KEY')) {
        logDebug('[BACKEND STARTUP] ' + key + ': ' + (value ? '[SET]' : '[NOT SET]'));
      } else {
        logDebug('[BACKEND STARTUP] ' + key + ': ' + (value || '[NOT SET]'));
      }
    });

    // ===== ATTEMPT SPAWN =====
    logDebug('[BACKEND STARTUP] ===== ATTEMPTING SPAWN =====');
    logDebug('[BACKEND STARTUP] Calling child_process.spawn()...');
    const spawnStartTime = Date.now();

    let spanwSuccessful = false;
    try {
      logDebug('[BACKEND STARTUP] [CHECKPOINT 1] About to invoke spawn()');

      backendProcess = spawn('node', ['index.js'], {
        cwd: __dirname,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: process.platform === 'win32',
        detached: false,
        env: { ...process.env }
      });

      logDebug('[BACKEND STARTUP] [CHECKPOINT 2] spawn() returned successfully');
      logDebug('[BACKEND STARTUP] Child process PID: ' + backendProcess.pid);
      logDebug('[BACKEND STARTUP] Child process killed: ' + backendProcess.killed);
      logDebug('[BACKEND STARTUP] Spawn elapsed time: ' + (Date.now() - spawnStartTime) + 'ms');
      spanwSuccessful = true;

      // ===== STDOUT CAPTURE =====
      logDebug('[BACKEND STARTUP] ===== SETTING UP STDOUT CAPTURE =====');
      if (!backendProcess.stdout) {
        logDebug('[BACKEND STARTUP] ✗ CRITICAL: backendProcess.stdout is null!');
      } else {
        logDebug('[BACKEND STARTUP] ✓ backendProcess.stdout is available');

        backendProcess.stdout.on('data', (data) => {
          const output = data.toString().trim();
          if (output) {
            const lines = output.split('\n');
            lines.forEach(line => {
              if (line.trim()) {
                logDebug('[BACKEND STDOUT] ' + line);
              }
            });
          }
        });

        backendProcess.stdout.on('end', () => {
          logDebug('[BACKEND STARTUP] STDOUT stream ended');
        });

        backendProcess.stdout.on('error', (err) => {
          logDebug('[BACKEND STARTUP] STDOUT error: ' + err.message);
        });
      }

      // ===== STDERR CAPTURE =====
      logDebug('[BACKEND STARTUP] ===== SETTING UP STDERR CAPTURE =====');
      if (!backendProcess.stderr) {
        logDebug('[BACKEND STARTUP] ✗ CRITICAL: backendProcess.stderr is null!');
      } else {
        logDebug('[BACKEND STARTUP] ✓ backendProcess.stderr is available');

        backendProcess.stderr.on('data', (data) => {
          const output = data.toString().trim();
          if (output) {
            const lines = output.split('\n');
            lines.forEach(line => {
              if (line.trim()) {
                logDebug('[BACKEND STDERR] ' + line);
              }
            });
          }
        });

        backendProcess.stderr.on('end', () => {
          logDebug('[BACKEND STARTUP] STDERR stream ended');
        });

        backendProcess.stderr.on('error', (err) => {
          logDebug('[BACKEND STARTUP] STDERR error: ' + err.message);
        });
      }

      // ===== ERROR EVENT HANDLING =====
      logDebug('[BACKEND STARTUP] ===== SETTING UP ERROR EVENT HANDLER =====');
      backendProcess.on('error', (err) => {
        logDebug('[BACKEND STARTUP] ✗✗✗ SPAWN ERROR EVENT FIRED ✗✗✗');
        logDebug('[BACKEND STARTUP] Error message: ' + err.message);
        logDebug('[BACKEND STARTUP] Error code: ' + err.code);
        logDebug('[BACKEND STARTUP] Error errno: ' + err.errno);
        logDebug('[BACKEND STARTUP] Error syscall: ' + err.syscall);
        logDebug('[BACKEND STARTUP] Full error: ' + JSON.stringify(err, null, 2));

        if (err.code === 'ENOENT') {
          logDebug('[BACKEND STARTUP] → Interpretation: "node" executable not found in PATH');
          logDebug('[BACKEND STARTUP] → Solution: Verify NODE is installed and accessible from Electron context');
        } else if (err.code === 'EACCES') {
          logDebug('[BACKEND STARTUP] → Interpretation: Permission denied');
          logDebug('[BACKEND STARTUP] → Solution: Check file permissions on index.js and node executable');
        }

        resolve(false);
      });

      // ===== CLOSE EVENT HANDLING =====
      logDebug('[BACKEND STARTUP] ===== SETTING UP CLOSE EVENT HANDLER =====');
      backendProcess.on('close', (code, signal) => {
        logDebug('[BACKEND STARTUP] CLOSE EVENT: code=' + code + ', signal=' + signal);
        if (code === null && signal) {
          logDebug('[BACKEND STARTUP] Process was killed by signal: ' + signal);
        } else if (code && code !== 0) {
          logDebug('[BACKEND STARTUP] Process exited with non-zero code: ' + code);
          logDebug('[BACKEND STARTUP] → This indicates an error during startup or execution');
        } else if (code === 0) {
          logDebug('[BACKEND STARTUP] Process exited normally (code 0)');
        }
      });

      // ===== EXIT EVENT HANDLING =====
      logDebug('[BACKEND STARTUP] ===== SETTING UP EXIT EVENT HANDLER =====');
      backendProcess.on('exit', (code, signal) => {
        logDebug('[BACKEND STARTUP] EXIT EVENT: code=' + code + ', signal=' + signal);
      });

      // ===== DISCONNECT EVENT HANDLING =====
      logDebug('[BACKEND STARTUP] ===== SETTING UP DISCONNECT EVENT HANDLER =====');
      backendProcess.on('disconnect', () => {
        logDebug('[BACKEND STARTUP] DISCONNECT EVENT fired');
      });

    } catch (err) {
      logDebug('[BACKEND STARTUP] ✗✗✗ EXCEPTION DURING SPAWN ✗✗✗');
      logDebug('[BACKEND STARTUP] Exception message: ' + err.message);
      logDebug('[BACKEND STARTUP] Exception code: ' + err.code);
      logDebug('[BACKEND STARTUP] Exception stack: ' + err.stack);
      logDebug('[BACKEND STARTUP] Full exception: ' + JSON.stringify(err, null, 2));
      resolve(false);
      return;
    }

    // ===== HEALTH CHECKS =====
    logDebug('[BACKEND STARTUP] ===== STARTING HEALTH CHECKS =====');
    logDebug('[BACKEND STARTUP] API endpoint: http://localhost:XXXX/health');
    logDebug('[BACKEND STARTUP] Port range: 3000-3004');
    logDebug('[BACKEND STARTUP] Health check interval: 500ms');
    logDebug('[BACKEND STARTUP] Timeout: 10 seconds');

    const testBackendHealth = async (attemptNum) => {
      logDebug('[HEALTH CHECK] ===== ATTEMPT #' + attemptNum + ' =====');

      for (let port = 3000; port <= 3004; port++) {
        const url = `http://localhost:${port}/health`;
        try {
          logDebug('[HEALTH CHECK] Testing port ' + port + ': ' + url);
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 1000);

          const response = await fetch(url, { signal: controller.signal });
          clearTimeout(timeout);

          if (response.ok) {
            logDebug('[HEALTH CHECK] ✓✓✓ HEALTH CHECK PASSED ON PORT ' + port + ' ✓✓✓');
            logDebug('[HEALTH CHECK] Response status: ' + response.status);
            logDebug('[HEALTH CHECK] Response statusText: ' + response.statusText);
            return true;
          } else {
            logDebug('[HEALTH CHECK] Port ' + port + ': Response status ' + response.status);
          }
        } catch (e) {
          logDebug('[HEALTH CHECK] Port ' + port + ': Request failed - ' + e.message);
        }
      }
      logDebug('[HEALTH CHECK] All ports failed this attempt');
      return false;
    };

    const startTime = Date.now();
    let healthCheckAttempt = 0;
    const healthCheckInterval = setInterval(async () => {
      healthCheckAttempt++;
      const isHealthy = await testBackendHealth(healthCheckAttempt);

      if (isHealthy) {
        logDebug('[HEALTH CHECK] ✓ Backend is healthy, clearing interval and resolving');
        clearInterval(healthCheckInterval);
        resolve(true);
      } else {
        const elapsed = Date.now() - startTime;
        logDebug('[HEALTH CHECK] Not healthy yet, elapsed: ' + elapsed + 'ms');

        if (elapsed > 10000) {
          logDebug('[HEALTH CHECK] ✗ TIMEOUT after 10 seconds');
          logDebug('[HEALTH CHECK] Assuming backend is starting, resolving anyway');
          logDebug('[HEALTH CHECK] Note: Backend may still be initializing, frontend should retry');
          clearInterval(healthCheckInterval);
          resolve(true);
        }
      }
    }, 500);

    logDebug('[BACKEND STARTUP] ═════════════════════════════════════════════════════════');
  });
};

const startViteDevServer = () => {
  return new Promise((resolve) => {
    console.log('[Electron] Starting Vite dev server...');

    const viteCwd = path.join(__dirname, 'frontend');

    devServerProcess = spawn('npm', ['run', 'dev'], {
      cwd: viteCwd,
      stdio: 'pipe',
      shell: true,  // Required on Windows for npm commands
      detached: false
    });

    let viteReady = false;
    let vitePort = 5173;  // Default port

    devServerProcess.stdout?.on('data', (data) => {
      const output = data.toString();
      console.log('[Vite]', output.trim());

      // Look for the actual port in output like "Local: http://localhost:5175/"
      const portMatch = output.match(/localhost:(\d+)/);
      if (portMatch) {
        vitePort = parseInt(portMatch[1]);
        console.log('[Electron] Detected Vite port:', vitePort);
      }

      if ((output.includes('Local:') || output.includes('ready')) && !viteReady) {
        viteReady = true;
        resolve(vitePort);  // Return the detected port
      }
    });

    devServerProcess.stderr?.on('data', (data) => {
      console.log('[Vite Stderr]', data.toString().trim());
    });

    devServerProcess.on('error', (err) => {
      console.error('[Electron] Failed to start Vite:', err.message);
      resolve(5173);  // Return default port on error
    });

    // Timeout after 15 seconds
    setTimeout(() => {
      if (!viteReady) {
        console.warn('[Electron] Vite dev server startup timeout, using port', vitePort);
        resolve(vitePort);
      }
    }, 15000);
  });
};

/**
 * Set up IPC handlers for telemetry and SimConnect communication
 */
const _setupIpcHandlers = (window) => {
  // Get current telemetry data
  ipcMain.handle('get-simconnect-telemetry', async () => {
    if (!simConnectService) {
      console.log('[IPC:get-simconnect-telemetry] SimConnect service not available');
      return {
        telemetry: null,
        isConnected: false,
        lastUpdate: null,
        error: 'SimConnect service not available'
      };
    }
    const telemetry = simConnectService.getTelemetry();
    const isConnected = simConnectService.getConnectionStatus();
    const lastUpdate = simConnectService.getLastUpdateTime();

    // Log warning if telemetry is null despite being connected
    if (isConnected && !telemetry) {
      console.warn('[IPC:get-simconnect-telemetry] Connected but telemetry is null - still initializing');
    }

    return {
      telemetry: telemetry,
      isConnected: isConnected,
      lastUpdate: lastUpdate
    };
  });

  // Get SimConnect connection status
  ipcMain.handle('get-simconnect-status', async () => {
    if (!simConnectService) {
      return {
        isConnected: false,
        stats: { error: 'SimConnect service not available' }
      };
    }
    return {
      isConnected: simConnectService.getConnectionStatus(),
      stats: simConnectService.getStats()
    };
  });

  // Write browser console logs to file (async, non-blocking)
  ipcMain.handle('write-browser-logs', async (event, logs) => {
    try {
      if (!Array.isArray(logs) || logs.length === 0) {
        return { success: true, written: 0 };
      }

      const logsDir = path.join(__dirname, 'logs');
      if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir, { recursive: true });
      }

      const date = new Date().toISOString().split('T')[0];
      const logFile = path.join(logsDir, `browser-${date}.log`);

      // Format logs and append to file
      const logLines = logs.map(log => {
        const { timestamp, level, message, url } = log;
        const urlPrefix = url ? `[${url}]` : '[BROWSER]';
        return `[${timestamp}] [${level}] ${urlPrefix} ${message}`;
      });

      // Use async appendFile instead of appendFileSync to avoid blocking
      await fs.promises.appendFile(logFile, logLines.join('\n') + '\n');
      return { success: true, written: logs.length, path: logFile };
    } catch (error) {
      console.error('[IPC] Error writing browser logs:', error.message);
      return { success: false, error: error.message };
    }
  });

  // Handle auto-flight detection request from frontend
  ipcMain.handle('get-auto-flight', async () => {
    console.log('[IPC:get-auto-flight] Frontend requesting auto-flight data');
    try {
      const activeFlightData = await AutoFlightLoader.checkAndLoadActiveFlightOnStartup();
      return {
        success: true,
        data: activeFlightData
      };
    } catch (error) {
      console.error('[IPC:get-auto-flight] Error:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  });

  // Handle close-window request from frontend (Exit button)
  ipcMain.on('close-window', () => {
    console.log('[IPC] Received close-window request from frontend');
    if (window) {
      window.close();
    }
  });

  // Handle minimize-window request from frontend
  ipcMain.on('minimize-window', () => {
    console.log('[IPC] Received minimize-window request from frontend');
    if (window) {
      window.minimize();
    }
  });

  // Handle open-dev-tools request from frontend (available in all modes for debugging)
  ipcMain.on('open-dev-tools', () => {
    console.log('[IPC] Received open-dev-tools request from frontend');
    if (window) {
      window.webContents.openDevTools();
    }
  });

  // Handle window height adjustment (e.g. crew section collapse/expand)
  ipcMain.on('set-window-height', (event, height) => {
    if (window && !window.isMaximized() && !window.isMinimized()) {
      const { width } = window.getBounds();
      window.setSize(width, Math.max(Math.round(height), 500), true);
    }
  });
};

const CredentialsManager = require('./src/credentialsManager');

/**
 * Show setup dialog for missing credentials
 */
const showCredentialSetupDialog = async (missingVars) => {
  const varLabels = {
    'ONAIR_COMPANY_ID': 'OnAir Company ID',
    'ONAIR_COMPANY_API_KEY': 'OnAir Company API Key',
    'ONAIR_VA_ID': 'OnAir VA ID',
    'ONAIR_VA_API_KEY': 'OnAir VA API Key',
    'SI_API_KEY': 'SayIntentions.AI API Key',
    'SIMBRIEF_PILOT_ID': 'SimBrief Pilot ID'
  };

  const missingLabels = missingVars.map(v => `  • ${varLabels[v]}`).join('\n');
  const configPath = CredentialsManager.getConfigPath();

  const result = await dialog.showMessageBox({
    type: 'info',
    title: 'KahunaAir Dispatch - Setup Required',
    message: 'Missing Credentials',
    detail: `The following credentials are required:\n\n${missingLabels}\n\nPlease add a .env file to the application directory with these values, or enter them below.\n\nConfig will be stored at:\n${configPath}`,
    buttons: ['Enter Credentials', 'Cancel']
  });

  if (result.response === 1) {
    return null; // User clicked Cancel
  }

  // Prompt for each missing credential
  const credentials = {};

  for (const varName of missingVars) {
    const label = varLabels[varName];
    let value = '';
    let cancelled = false;

    // Keep prompting until we get a non-empty value
    while (!value && !cancelled) {
      const inputResult = await dialog.showMessageBox({
        type: 'question',
        title: 'KahunaAir Dispatch - Setup',
        message: `Enter ${label}:`,
        detail: 'You can copy this from your OnAir profile or SayIntentions.AI dashboard.',
        buttons: ['OK', 'Cancel'],
        defaultId: 0
      });

      if (inputResult.response === 1) {
        cancelled = true;
        break;
      }

      // For now, show a warning that they need to set it up manually
      await dialog.showMessageBox({
        type: 'warning',
        title: 'Setup Instructions',
        message: 'Credential Input',
        detail: 'Due to technical limitations, please create a .env file with your credentials.\n\nExample .env file:\nONAIR_VA_COMPANY_ID=your-company-id\nONAIR_VA_API_KEY=your-api-key\nSI_API_KEY=your-si-key\n\nSave it as .env in the application directory.',
        buttons: ['OK']
      });

      cancelled = true;
    }

    if (cancelled) {
      return null;
    }
  }

  return credentials;
};

const verifyCredentialsOnStartup = async () => {
  console.log('[Electron] Verifying application credentials...');

  // First check if we have credentials in environment
  const hasEnvCredentials = (process.env.ONAIR_COMPANY_ID || process.env.ONAIR_VA_ID) &&
    process.env.SI_API_KEY;

  if (!hasEnvCredentials) {
    console.log('[Electron] No credentials found in environment, checking stored config...');
    try {
      const stored = CredentialsManager.loadCredentials();
      console.log('[Electron] CredentialsManager returned:', stored ? Object.keys(stored) : 'null');
      if (stored) {
        // Load Company credentials
        if (stored.ONAIR_COMPANY_ID) {
          process.env.ONAIR_COMPANY_ID = stored.ONAIR_COMPANY_ID;
          console.log('[Electron] ✓ Set ONAIR_COMPANY_ID');
        }
        if (stored.ONAIR_COMPANY_API_KEY) {
          process.env.ONAIR_COMPANY_API_KEY = stored.ONAIR_COMPANY_API_KEY;
          console.log('[Electron] ✓ Set ONAIR_COMPANY_API_KEY');
        }
        // Load VA credentials
        if (stored.ONAIR_VA_ID) {
          process.env.ONAIR_VA_ID = stored.ONAIR_VA_ID;
          console.log('[Electron] ✓ Set ONAIR_VA_ID');
        }
        if (stored.ONAIR_VA_API_KEY) {
          process.env.ONAIR_VA_API_KEY = stored.ONAIR_VA_API_KEY;
          console.log('[Electron] ✓ Set ONAIR_VA_API_KEY');
        }
        // Load SI and SimBrief
        if (stored.SI_API_KEY) {
          process.env.SI_API_KEY = stored.SI_API_KEY;
          console.log('[Electron] ✓ Set SI_API_KEY');
        }
        if (stored.SIMBRIEF_PILOT_ID) {
          process.env.SIMBRIEF_PILOT_ID = stored.SIMBRIEF_PILOT_ID;
          console.log('[Electron] Set SIMBRIEF_PILOT_ID');
        }
        // Legacy field names support
        if (stored.ONAIR_VA_COMPANY_ID) {
          process.env.ONAIR_VA_COMPANY_ID = stored.ONAIR_VA_COMPANY_ID;
          console.log('[Electron] ✓ Set ONAIR_VA_COMPANY_ID (legacy)');
        }
        console.log('[Electron] ✓ All stored credentials loaded');
      } else {
        console.log('[Electron] CredentialsManager.loadCredentials() returned null or empty');
      }
    } catch (error) {
      console.log('[Electron] Error loading stored credentials:', error.message);
    }
  }

  // Check what's still missing
  // Need Company credentials (primary) OR VA credentials (fallback), plus SI_API_KEY
  const hasCompanyCredentials = process.env.ONAIR_COMPANY_ID && process.env.ONAIR_COMPANY_API_KEY;
  const hasVaCredentials = process.env.ONAIR_VA_ID && process.env.ONAIR_VA_API_KEY;
  const hasOnAirCredentials = hasCompanyCredentials || hasVaCredentials;
  const hasSiKey = process.env.SI_API_KEY && process.env.SI_API_KEY.trim() !== '';

  console.log('[Electron] Credential Status:');
  console.log('[Electron]   hasCompanyCredentials:', hasCompanyCredentials);
  console.log('[Electron]   hasVaCredentials:', hasVaCredentials);
  console.log('[Electron]   hasOnAirCredentials:', hasOnAirCredentials);
  console.log('[Electron]   hasSiKey:', hasSiKey);

  const missing = [];
  if (!hasOnAirCredentials) {
    missing.push('ONAIR_COMPANY_ID');
    missing.push('ONAIR_COMPANY_API_KEY');
    missing.push('ONAIR_VA_ID');
    missing.push('ONAIR_VA_API_KEY');
  }
  if (!hasSiKey) missing.push('SI_API_KEY');

  if (missing.length > 0) {
    console.log('[Electron] Missing credentials:', missing);

    // Ask user to set up credentials
    const setupResult = await showCredentialSetupDialog(missing);

    if (!setupResult) {
      console.error('[Electron] ❌ User cancelled credential setup');
      dialog.showErrorBox(
        'KahunaAir Dispatch - Setup Cancelled',
        'Application requires credentials to run.\n\nPlease create a .env file with your credentials and restart the application.'
      );
      return false;
    }

    // Note: For now, setup directs user to create .env file
    // In future, we could parse user input and store it
  }

  // Optional: Verify credentials work (truly non-blocking - don't await, just log results later)
  // Don't block startup on API verification - window should load immediately
  console.log('[Electron] ✅ Credentials ready - proceeding with startup immediately');
  console.log('[Electron] Running credential verification in background...');

  // Fire and forget - verify credentials in background with timeout
  const verifyWithTimeout = async () => {
    try {
      // Add a 3-second timeout to the verification
      const timeoutPromise = new Promise((resolve) =>
        setTimeout(() => resolve({ valid: false, error: 'Verification timeout' }), 3000)
      );
      const verifyPromise = CredentialsVerifier.verifyAllCredentials();
      const verification = await Promise.race([verifyPromise, timeoutPromise]);

      if (!verification.valid) {
        console.warn('[Electron] ⚠ OnAir API verification failed:', verification.error);
      } else {
        console.log('[Electron] ✅ Credentials verified with OnAir API');
      }
    } catch (error) {
      console.warn('[Electron] Credential verification error:', error.message);
    }
  };

  // Run verification in background without blocking
  verifyWithTimeout().catch(err => console.error('[Electron] Unexpected error during verification:', err.message));

  return true;
};

const checkActiveFlightOnStartup = async () => {
  console.log('[Electron] Checking for active flight...');
  try {
    const activeFlightData = await AutoFlightLoader.checkAndLoadActiveFlightOnStartup();

    if (activeFlightData) {
      console.log('[Electron] ✅ Active flight detected:', activeFlightData.flightId);
      return activeFlightData;
    } else {
      console.log('[Electron] No active flight found - user can manually select flight');
      return null;
    }
  } catch (error) {
    console.error('[Electron] Error checking active flight:', error.message);
    // Non-fatal - continue without auto-load
    return null;
  }
};

/**
 * Create native application menu (removes browser-like behaviors)
 */
const createApplicationMenu = () => {
  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Exit',
          accelerator: 'CmdOrCtrl+Q',
          click: () => {
            app.quit();
          }
        }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' }
      ]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About KahunaAir Dispatch',
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'About KahunaAir Dispatch',
              message: 'KahunaAir Dispatch',
              detail: 'Version 0.2.0\n\nAPI bridge between OnAir and SayIntentions.AI for MSFS 2024\n\nAuthor: KahunaTheElder\nLicense: MIT'
            });
          }
        }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
};

// App event handlers
app.on('ready', async () => {
  console.log('\n========================================');
  console.log('[Electron] KahunaAir Dispatch Starting');
  console.log('========================================\n');

  // ===== STARTUP VERIFICATION: Check previous cleanup =====
  console.log('[Electron] Verifying previous session cleanup...');
  const cleanupVerified = verifyPreviousCleanup();
  if (!cleanupVerified) {
    console.warn('[Electron] ⚠ Previous session may not have cleaned up properly');
    console.log('[Electron] Running extra cleanup...');
    await killHangingProcesses();
  }

  // ===== CRITICAL: Kill any hanging processes from previous crashes =====
  // (Only call once - we already called it above if needed)
  await killHangingProcesses();

  // ===== CRITICAL: Verify credentials (now truly non-blocking) =====
  verifyCredentialsOnStartup().catch(err => {
    console.error('[Electron] Credential verification error:', err.message);
  });

  // ===== START BACKEND - But don't block on it =====
  // Start backend server immediately - it will initialize in background
  const backendStartPromise = startBackendServer();
  console.log('[Electron] Backend server startup initiated (background)');

  // ===== VITE DEV SERVER - If in dev mode =====
  let vitePort = 5173;
  if (isDev && !isProduction) {
    console.log('[Electron] Starting Vite dev server...');
    vitePort = await startViteDevServer();
    console.log('[Electron] Vite dev server started on port', vitePort);
  }

  // ===== Wait for backend to start (5 seconds - allow time for process startup) =====
  // This gives the backend time to initialize fully, especially on second load
  console.log('[Electron] Waiting for backend to initialize...');
  await new Promise(resolve => setTimeout(resolve, 5000));

  // ===== CREATE WINDOW IMMEDIATELY - Don't wait for backend =====
  // Frontend will discover backend port and check service status
  console.log('[Electron] Creating window (frontend will discover backend)...');
  createWindow(vitePort);
  createApplicationMenu();
  console.log('[Electron] Window created - UI is now visible');

  // ===== RUN ALL OTHER CHECKS IN BACKGROUND =====

  // Wait for backend to start (in background, window already visible)
  backendStartPromise.then(backendOk => {
    if (!backendOk) {
      console.error('[Electron] Warning: Backend startup had issues');
    }
  }).catch(err => {
    console.error('[Electron] Backend startup error:', err.message);
  });

  // Check for active flight (non-blocking, can fail gracefully)
  checkActiveFlightOnStartup().then(activeFlightData => {
    if (activeFlightData && mainWindow) {
      console.log('[Electron] Sending auto-flight data to frontend');
      mainWindow.webContents.send('auto-flight-detected', activeFlightData);
    }
  }).catch(err => {
    console.warn('[Electron] Active flight check error:', err.message);
  });

  // Initialize SimConnect (non-blocking - runs in background)
  if (!simConnectInitialized && simConnectService) {
    simConnectInitialized = true;
    simConnectService.connect().then(success => {
      if (success) {
        console.log('[Electron] SimConnect initialized successfully');
      } else {
        console.warn('[Electron] SimConnect initialization failed - MSFS may not be running');
      }
    });
  } else if (!simConnectService) {
    console.warn('[Electron] SimConnect service not available - running without real-time telemetry');
    simConnectInitialized = true;
  }
});

/**
 * Capture ALL app close methods (quit, window X, Alt+F4, etc.)
 * Shows shutdown dialog and ensures proper cleanup
 */
app.on('before-quit', async (event) => {
  console.log('\n========================================');
  console.log('[Electron] Shutdown initiated');
  console.log('========================================\n');

  // Prevent immediate quit - we need to show dialog and cleanup
  event.preventDefault();

  // Show cleanup dialog and perform full cleanup
  await performFullCleanupWithDialog();

  // All cleanup done - now allow quit
  console.log('[Electron] Cleanup complete, exiting...');
  app.exit(0);
});

app.on('window-all-closed', () => {
  console.log('[Electron] All windows closed');

  // Fallback cleanup in case before-quit didn't run (e.g., force kill)
  // Kill backend if still running
  if (backendProcess && !backendProcess.killed) {
    console.log('[Electron] FALLBACK: Killing backend process (before-quit may not have run)...');
    backendProcess.kill('SIGKILL');
    backendProcess = null;
  }

  // Kill dev server if still running
  if (devServerProcess && !devServerProcess.killed) {
    console.log('[Electron] FALLBACK: Killing dev server...');
    devServerProcess.kill('SIGKILL');
    devServerProcess = null;
  }

  // Ensure we're really quitting on non-macOS
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});

// Handle any uncaught exceptions
process.on('uncaughtException', (err) => {
  console.error('[Electron] Uncaught Exception:', err);
});
