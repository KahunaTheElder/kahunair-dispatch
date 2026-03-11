const fs = require('fs');
const path = require('path');
const os = require('os');

// Determine logs directory - use AppData in production, project root in development
const getLogsDir = () => {
  const isDev = process.env.NODE_ENV !== 'production' && !process.env.PORTABLE_EXECUTABLE_DIR;

  if (isDev) {
    // Development: use project logs directory
    return path.join(__dirname, '../logs');
  } else {
    // Production/Portable: use AppData
    const appDataDir = path.join(os.homedir(), 'AppData', 'Roaming', 'kahunair-dispatch');
    return path.join(appDataDir, 'logs');
  }
};

const logsDir = getLogsDir();

// Create logs directory if it doesn't exist
try {
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }
} catch (err) {
  console.error('[Logger] Failed to create logs directory:', err.message);
  // Fail silently - logging will be unavailable but app can continue
}

// Log file path - includes today's date
const getLogFilePath = () => {
  const date = new Date().toISOString().split('T')[0];
  return path.join(logsDir, `dispatch-${date}.log`);
};

// Format log message with timestamp
const formatLog = (level, message, data = null) => {
  const timestamp = new Date().toISOString();
  let logEntry = `[${timestamp}] [${level}] ${message}`;
  if (data) {
    logEntry += `\n${JSON.stringify(data, null, 2)}`;
  }
  return logEntry;
};

// Write to log file (async, non-blocking)
const writeToFile = async (logEntry) => {
  try {
    const logFile = getLogFilePath();
    // Ensure directory exists before writing
    const dir = path.dirname(logFile);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    // Use async appendFile to avoid blocking the event loop
    await fs.promises.appendFile(logFile, logEntry + '\n');
  } catch (err) {
    console.error('[Logger] Failed to write log file:', err.message);
  }
};

// Logger object with methods for different log levels
const logger = {
  info: (message, data = null) => {
    const logEntry = formatLog('INFO', message, data);
    console.log(logEntry);
    writeToFile(logEntry).catch(err => console.error('Failed to write log:', err));
  },

  warn: (message, data = null) => {
    const logEntry = formatLog('WARN', message, data);
    console.warn(logEntry);
    writeToFile(logEntry).catch(err => console.error('Failed to write log:', err));
  },

  error: (message, data = null) => {
    const logEntry = formatLog('ERROR', message, data);
    console.error(logEntry);
    writeToFile(logEntry).catch(err => console.error('Failed to write log:', err));
  },

  debug: (message, data = null) => {
    const logEntry = formatLog('DEBUG', message, data);
    // Debug logs go to file but not console (to avoid spam)
    writeToFile(logEntry).catch(err => console.error('Failed to write log:', err));
  },

  // Get path to today's log file
  getLogPath: () => getLogFilePath(),

  // Get all recent logs
  getRecentLogs: (lines = 100) => {
    try {
      const logFile = getLogFilePath();
      if (!fs.existsSync(logFile)) {
        return 'No logs yet';
      }
      const content = fs.readFileSync(logFile, 'utf-8');
      const logLines = content.split('\n').filter(l => l.trim());
      return logLines.slice(-lines).join('\n');
    } catch (err) {
      return `Error reading logs: ${err.message}`;
    }
  }
};

// Optionally intercept console methods to capture non-logger console calls
// Uncomment to enable capturing all console.log/warn/error to logs
/*
const originalLog = console.log;
const originalWarn = console.warn;
const originalError = console.error;

console.log = function(...args) {
  originalLog.apply(console, args);
  const message = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : String(arg)).join(' ');
  writeToFile(formatLog('INFO', `[CONSOLE] ${message}`));
};

console.warn = function(...args) {
  originalWarn.apply(console, args);
  const message = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : String(arg)).join(' ');
  writeToFile(formatLog('WARN', `[CONSOLE] ${message}`));
};

console.error = function(...args) {
  originalError.apply(console, args);
  const message = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : String(arg)).join(' ');
  writeToFile(formatLog('ERROR', `[CONSOLE] ${message}`));
};
*/

module.exports = logger;
