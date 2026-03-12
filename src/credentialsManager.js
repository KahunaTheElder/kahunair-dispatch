const fs = require('fs');
const path = require('path');
const os = require('os');

// Use app data directory on Windows, home directory elsewhere
const getConfigDir = () => {
  if (process.platform === 'win32') {
    // On Windows, use %APPDATA%\kahunair-dispatch
    return path.join(process.env.APPDATA || os.homedir(), 'kahunair-dispatch');
  }
  // On other platforms, use ~/.kahunair-dispatch
  return path.join(os.homedir(), '.kahunair-dispatch');
};

const configDir = getConfigDir();
const configFile = path.join(configDir, 'credentials.json');

// Ensure config directory exists
if (!fs.existsSync(configDir)) {
  fs.mkdirSync(configDir, { recursive: true });
}

console.log('[CredentialsManager] Config directory:', configDir);
console.log('[CredentialsManager] Credentials file:', configFile);

// Save credentials to file
const saveCredentials = (creds) => {
  try {
    const json = JSON.stringify(creds, null, 2);
    // Use UTF8 without BOM
    fs.writeFileSync(configFile, json, { encoding: 'utf8', flag: 'w' });
    console.log('[CredentialsManager] Credentials saved to', configFile);
  } catch (error) {
    console.error('[CredentialsManager] Error saving credentials:', error.message);
    throw error;
  }
};

// Load credentials from file
const loadCredentials = () => {
  try {
    // Try current location first
    if (fs.existsSync(configFile)) {
      let data = fs.readFileSync(configFile, 'utf-8');
      // Remove BOM if present
      if (data.charCodeAt(0) === 0xFEFF) {
        data = data.slice(1);
      }
      const creds = JSON.parse(data);
      console.log('[CredentialsManager] Loaded credentials from:', configFile);
      // Ensure credentialsConfigured flag is set
      creds.credentialsConfigured = true;
      return creds;
    }

    // Migration: try old home directory location
    const oldConfigFile = path.join(os.homedir(), '.kahunair-dispatch', 'credentials.json');
    if (fs.existsSync(oldConfigFile)) {
      let data = fs.readFileSync(oldConfigFile, 'utf-8');
      // Remove BOM if present
      if (data.charCodeAt(0) === 0xFEFF) {
        data = data.slice(1);
      }
      const creds = JSON.parse(data);
      console.log('[CredentialsManager] Migrated credentials from old location:', oldConfigFile);
      // Ensure credentialsConfigured flag is set
      creds.credentialsConfigured = true;
      // Save to new location
      saveCredentials(creds);
      return creds;
    }
  } catch (error) {
    console.error('[CredentialsManager] Error reading credentials:', error.message);
  }
  console.log('[CredentialsManager] No credentials found');
  return {
    onairCompanyId: '',
    onairVAId: '',
    credentialsConfigured: false
  };
};

let credentials = loadCredentials();

module.exports = {
  // Get config file path (for display purposes)
  getConfigPath: () => configFile,

  // Load credentials in environment variable format
  loadCredentials: () => {
    try {
      if (fs.existsSync(configFile)) {
        let data = fs.readFileSync(configFile, 'utf-8');
        // Strip UTF-8 BOM if present (PowerShell writes files with BOM by default)
        if (data.charCodeAt(0) === 0xFEFF) data = data.slice(1);
        const creds = JSON.parse(data);
        console.log('[CredentialsManager] Returning credentials:', Object.keys(creds));
        return {
          // Company credentials (with fallback to old field names)
          ONAIR_COMPANY_ID: creds.ONAIR_COMPANY_ID || creds.ONAIR_VA_COMPANY_ID || '',
          ONAIR_COMPANY_API_KEY: creds.ONAIR_COMPANY_API_KEY || creds.ONAIR_VA_API_KEY || '',
          // VA credentials
          ONAIR_VA_ID: creds.ONAIR_VA_ID || '',
          ONAIR_VA_API_KEY: creds.ONAIR_VA_API_KEY || '',
          // SI and SimBrief
          SI_API_KEY: creds.SI_API_KEY || '',
          SI_VA_API_KEY: creds.SI_VA_API_KEY || '',
          SIMBRIEF_PILOT_ID: creds.SIMBRIEF_PILOT_ID || '',
          // Legacy fields
          ONAIR_VA_COMPANY_ID: creds.ONAIR_VA_COMPANY_ID || creds.ONAIR_COMPANY_ID || ''
        };
      }
    } catch (error) {
      console.error('[CredentialsManager] Error loading credentials:', error.message);
    }
    return null;
  },

  // Save credentials in environment variable format
  saveCredentials: (creds) => {
    try {
      fs.writeFileSync(configFile, JSON.stringify(creds, null, 2), 'utf-8');
      console.log('[CredentialsManager] Credentials saved to', configFile);
    } catch (error) {
      console.error('[CredentialsManager] Error saving credentials:', error.message);
      throw error;
    }
  },

  // Legacy methods for backward compatibility
  getCredentials: () => ({
    companyId: credentials.onairCompanyId,
    vaId: credentials.onairVAId,
    configured: credentials.credentialsConfigured
  }),

  setCredentials: (onairCompanyId, onairApiKey, siApiKey) => {
    // Handle both old format (companyId, vaId) and new format (onairCompanyId, onairApiKey, siApiKey)
    if (typeof onairCompanyId === 'string' && typeof onairApiKey === 'string') {
      // New format with all three parameters
      credentials.ONAIR_VA_COMPANY_ID = onairCompanyId;
      credentials.ONAIR_VA_API_KEY = onairApiKey;
      credentials.SI_API_KEY = siApiKey || process.env.SI_API_KEY || '';
    } else if (typeof onairCompanyId === 'string' && typeof onairApiKey === 'object' && onairApiKey !== null) {
      // Object format: {onairCompanyId, onairApiKey, siApiKey}
      credentials.ONAIR_VA_COMPANY_ID = onairCompanyId;
      credentials.ONAIR_VA_API_KEY = onairApiKey.onairApiKey;
      credentials.SI_API_KEY = onairApiKey.siApiKey || process.env.SI_API_KEY || '';
    }
    credentials.credentialsConfigured = true;
    saveCredentials(credentials);
  },

  clearCredentials: () => {
    credentials.ONAIR_VA_COMPANY_ID = '';
    credentials.ONAIR_VA_API_KEY = '';
    credentials.SI_API_KEY = '';
    credentials.credentialsConfigured = false;
    saveCredentials(credentials);
  },

  hasCredentials: () => credentials.credentialsConfigured
};
