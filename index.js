const path = require('path');
const fs = require('fs');
const os = require('os');

// COMPREHENSIVE STARTUP LOGGING - Log to file as well as console
const startupLogPath = path.join(os.homedir(), '.kahunair', 'backend-startup.log');
const logBackend = (msg) => {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${msg}`;
  console.log(line);
  try {
    const dir = path.dirname(startupLogPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(startupLogPath, line + '\n');
  } catch (e) {
    console.error('[LOGGING ERROR]', e.message);
  }
};

logBackend('═══════════════════════════════════════════════════════');
logBackend('[BACKEND STARTUP] Backend process starting');
logBackend('[BACKEND STARTUP] Time: ' + new Date().toISOString());
logBackend('[BACKEND STARTUP] Node version: ' + process.version);
logBackend('[BACKEND STARTUP] Process ID: ' + process.pid);
logBackend('[BACKEND STARTUP] Platform: ' + process.platform);
logBackend('[BACKEND STARTUP] Architecture: ' + process.arch);

// ===== ENVIRONMENT DIAGNOSTICS =====
logBackend('[BACKEND STARTUP] ===== ENVIRONMENT =====');
logBackend('[BACKEND STARTUP] process.cwd(): ' + process.cwd());
logBackend('[BACKEND STARTUP] __dirname: ' + __dirname);
logBackend('[BACKEND STARTUP] __filename: ' + __filename);
logBackend('[BACKEND STARTUP] Home directory: ' + os.homedir());

// ===== MODULE PATH DIAGNOSTICS =====
logBackend('[BACKEND STARTUP] ===== MODULE PATHS =====');
logBackend('[BACKEND STARTUP] require.main.filename: ' + (require.main ? require.main.filename : '[N/A]'));
logBackend('[BACKEND STARTUP] NODE_PATH env: ' + (process.env.NODE_PATH || '[NOT SET]'));
logBackend('[BACKEND STARTUP] NODE_MODULES lookup (first 3): ' + require.resolve.paths('dotenv').slice(0, 3).join('; '));

// Handle .env loading for both dev and packaged app
const findEnvFile = () => {
  // Check multiple locations in order of preference
  const possiblePaths = [
    // Most likely: current working directory (where app is run from)
    path.join(process.cwd(), '.env'),
    // Dev mode: project root
    path.join(__dirname, '.env'),
    path.join(__dirname, '.env.production'),
    // Packaged app one level up
    path.join(__dirname, '..', '.env'),
    // Home directory
    path.join(os.homedir(), '.kahunair', '.env')
  ];

  logBackend('[BACKEND STARTUP] ===== .ENV FILE SEARCH =====');
  logBackend('[BACKEND STARTUP] Looking for .env in:');

  for (const envPath of possiblePaths) {
    try {
      const exists = fs.existsSync(envPath);
      const status = exists ? '✓ FOUND' : '✗ not found';
      logBackend(`[BACKEND STARTUP]   ${status}: ${envPath}`);

      if (exists) {
        const stats = fs.statSync(envPath);
        logBackend('[BACKEND STARTUP] File size: ' + stats.size + ' bytes');
        logBackend('[BACKEND STARTUP] Modified: ' + stats.mtime.toISOString());
        logBackend('[BACKEND STARTUP] Using .env from: ' + envPath);
        return envPath;
      }
    } catch (e) {
      logBackend('[BACKEND STARTUP] Error checking path ' + envPath + ': ' + e.message);
    }
  }

  logBackend('[BACKEND STARTUP] ✗ No .env file found in any location!');
  return null;
};

// Load .env file
logBackend('[BACKEND STARTUP] ===== DOTENV LOADING =====');
try {
  const envPath = findEnvFile();

  if (envPath) {
    logBackend('[BACKEND STARTUP] Attempting to load dotenv from: ' + envPath);
    const result = require('dotenv').config({ path: envPath });
    
    if (result.error) {
      logBackend('[BACKEND STARTUP] ✗ Error loading .env: ' + result.error.message);
    } else {
      logBackend('[BACKEND STARTUP] ✓ .env loaded successfully');
      logBackend('[BACKEND STARTUP] Parsed keys: ' + Object.keys(result.parsed || {}).length);
      logBackend('[BACKEND STARTUP] Credentials present:');
      logBackend(`[BACKEND STARTUP]   - ONAIR_VA_COMPANY_ID: ${process.env.ONAIR_VA_COMPANY_ID ? '✓ YES' : '✗ NO'}`);
      logBackend(`[BACKEND STARTUP]   - ONAIR_VA_API_KEY: ${process.env.ONAIR_VA_API_KEY ? '✓ YES' : '✗ NO'}`);
      logBackend(`[BACKEND STARTUP]   - ONAIR_COMPANY_ID: ${process.env.ONAIR_COMPANY_ID ? '✓ YES' : '✗ NO'}`);
      logBackend(`[BACKEND STARTUP]   - ONAIR_COMPANY_API_KEY: ${process.env.ONAIR_COMPANY_API_KEY ? '✓ YES' : '✗ NO'}`);
      logBackend(`[BACKEND STARTUP]   - ONAIR_VA_ID: ${process.env.ONAIR_VA_ID ? '✓ YES' : '✗ NO'}`);
      logBackend(`[BACKEND STARTUP]   - ONAIR_PRIVATE_COMPANY_ID: ${process.env.ONAIR_PRIVATE_COMPANY_ID ? '✓ YES' : '✗ NO'}`);
      logBackend(`[BACKEND STARTUP]   - ONAIR_PRIVATE_API_KEY: ${process.env.ONAIR_PRIVATE_API_KEY ? '✓ YES' : '✗ NO'}`);
      logBackend(`[BACKEND STARTUP]   - SI_API_KEY: ${process.env.SI_API_KEY ? '✓ YES' : '✗ NO'}`);
      logBackend(`[BACKEND STARTUP]   - NODE_ENV: ${process.env.NODE_ENV || '[NOT SET]'}`);
      logBackend(`[BACKEND STARTUP]   - PORT: ${process.env.PORT || '[NOT SET - will use default]'}`);
    }
  } else {
    // Try default dotenv behavior as fallback
    logBackend('[BACKEND STARTUP] Attempting default .env load (no path specified)...');
    const result = require('dotenv').config();
    if (result.error) {
      logBackend('[BACKEND STARTUP] Default load also failed: ' + result.error.message);
    } else {
      logBackend('[BACKEND STARTUP] ✓ Default .env load succeeded');
    }
  }
} catch (err) {
  logBackend('[BACKEND STARTUP] ✗✗✗ EXCEPTION DURING DOTENV LOAD ✗✗✗');
  logBackend('[BACKEND STARTUP] Error: ' + err.message);
  logBackend('[BACKEND STARTUP] Stack: ' + err.stack);
}

// ===== CREDENTIALS FILE CHECK =====
logBackend('[BACKEND STARTUP] ===== CREDENTIALS FILE CHECK =====');
const credsDir = path.join(os.homedir(), 'AppData', 'Roaming', 'kahunair-dispatch');
const credsPath = path.join(credsDir, 'credentials.json');
logBackend('[BACKEND STARTUP] Credentials directory: ' + credsDir);
logBackend('[BACKEND STARTUP] Credentials file: ' + credsPath);
logBackend('[BACKEND STARTUP] Credentials dir exists: ' + (fs.existsSync(credsDir) ? 'YES' : 'NO'));
logBackend('[BACKEND STARTUP] Credentials file exists: ' + (fs.existsSync(credsPath) ? 'YES' : 'NO'));

if (fs.existsSync(credsPath)) {
  try {
    const stats = fs.statSync(credsPath);
    logBackend('[BACKEND STARTUP] Credentials file size: ' + stats.size + ' bytes');
    logBackend('[BACKEND STARTUP] Credentials file modified: ' + stats.mtime.toISOString());
    
    const content = fs.readFileSync(credsPath, 'utf8');
    const first20chars = content.substring(0, 20);
    logBackend('[BACKEND STARTUP] First 20 chars (should start with {): ' + first20chars.replace(/\n/g, '\\n'));
    
    try {
      const credsContent = JSON.parse(content);
      logBackend('[BACKEND STARTUP] ✓ Credentials JSON parsed successfully');
      logBackend('[BACKEND STARTUP] Credentials keys: ' + Object.keys(credsContent).join(', '));
    } catch (parseErr) {
      logBackend('[BACKEND STARTUP] ✗ Failed to parse credentials JSON: ' + parseErr.message);
    }
  } catch (e) {
    logBackend('[BACKEND STARTUP] Error reading credentials: ' + e.message);
  }
}

logBackend('[BACKEND STARTUP] ===== ATTEMPTING SERVER INITIALIZATION =====');

const DispatchServer = require('./src/server');

logBackend('[BACKEND STARTUP] DispatchServer module loaded');
logBackend('[BACKEND STARTUP] Creating server instance...');

const serverConfig = {
  port: process.env.PORT || 3000,
  env: process.env.NODE_ENV || 'development',
  // Company credentials (primary) - try new field names first, fall back to old
  onairCompanyId: process.env.ONAIR_COMPANY_ID || process.env.ONAIR_PRIVATE_COMPANY_ID,
  onairApiKey: process.env.ONAIR_COMPANY_API_KEY || process.env.ONAIR_PRIVATE_API_KEY,
  // VA credentials (fallback) - should have both ID and API Key
  onairVaId: process.env.ONAIR_VA_ID,
  onairVaApiKey: process.env.ONAIR_VA_API_KEY
};

logBackend('[BACKEND STARTUP] Server config:');
logBackend('[BACKEND STARTUP]   - port: ' + serverConfig.port);
logBackend('[BACKEND STARTUP]   - env: ' + serverConfig.env);
logBackend('[BACKEND STARTUP]   - onairCompanyId: ' + (serverConfig.onairCompanyId ? '✓' : '✗'));
logBackend('[BACKEND STARTUP]   - onairApiKey: ' + (serverConfig.onairApiKey ? '✓' : '✗'));
logBackend('[BACKEND STARTUP]   - onairVaId: ' + (serverConfig.onairVaId ? '✓' : '✗'));
logBackend('[BACKEND STARTUP]   - onairVaApiKey: ' + (serverConfig.onairVaApiKey ? '✓' : '✗'));

try {
  const server = new DispatchServer(serverConfig);

  logBackend('[BACKEND STARTUP] ✓ Server instance created');
  logBackend('[BACKEND STARTUP] Calling server.start()...');

  server.start();
  
  logBackend('[BACKEND STARTUP] ✓ server.start() called');
} catch (err) {
  logBackend('[BACKEND STARTUP] ✗✗✗ EXCEPTION DURING SERVER INITIALIZATION ✗✗✗');
  logBackend('[BACKEND STARTUP] Error: ' + err.message);
  logBackend('[BACKEND STARTUP] Stack: ' + err.stack);
  logBackend('[BACKEND STARTUP] This is a fatal error - process will exit');
  process.exit(1);
}

logBackend('[BACKEND STARTUP] ═══════════════════════════════════════════════════════');
