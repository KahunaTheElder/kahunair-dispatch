const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * SettingsManager - Secure credential storage with AES encryption
 * 
 * Persists user credentials to %APPDATA%\KahunaAir\settings.json
 * Individual fields are encrypted, metadata stored in plaintext
 * 
 * Features:
 * - AES-256-GCM encryption (authenticated, minimal overhead)
 * - Auto-creates appdata directory if missing
 * - Detailed error messages with recovery instructions
 * - Atomic file writes to prevent corruption
 */

class SettingsManager {
  constructor() {
    // Fixed encryption key (for this standalone app, reasonable approach)
    // In production with multiple users, would use per-user or system key
    this.encryptionKey = crypto.scryptSync(
      process.env.KAHUNAIR_ENC_KEY || 'kahunair-default-key',
      'kahunair-salt-001',
      32 // 32 bytes for AES-256
    );

    this.appDataDir = path.join(process.env.APPDATA || process.env.HOME || '.', 'KahunaAir');
    this.settingsFile = path.join(this.appDataDir, 'settings.json');

    // Fields that should be encrypted
    this.encryptedFields = [
      'siApiKey',
      'oaCompanyId',
      'oaApiKey',
      'oaVaId',
      'oaVaApiKey',
      'oaPilotId',
      'simBriefPilotId'
    ];

    this.ensureAppDataDir();
  }

  /**
   * Ensure appdata directory exists
   * Creates %APPDATA%\KahunaAir if missing
   */
  ensureAppDataDir() {
    try {
      if (!fs.existsSync(this.appDataDir)) {
        fs.mkdirSync(this.appDataDir, { recursive: true, mode: 0o700 });
        console.log(`[SettingsManager] ✓ Created appdata directory: ${this.appDataDir}`);
      }
    } catch (error) {
      const msg = `Failed to create appdata directory at ${this.appDataDir}: ${error.message}`;
      console.error(`[SettingsManager] ✗ ${msg}`);
      // Don't throw - app can still save to current path with warning
    }
  }

  /**
   * Encrypt a single value using AES-256-GCM
   * Returns: { iv, authTag, encryptedValue } - all hex-encoded for JSON storage
   */
  encryptField(plaintext) {
    try {
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipheriv('aes-256-gcm', this.encryptionKey, iv);

      let encrypted = cipher.update(plaintext, 'utf8', 'hex');
      encrypted += cipher.final('hex');

      const authTag = cipher.getAuthTag();

      return {
        iv: iv.toString('hex'),
        authTag: authTag.toString('hex'),
        encryptedValue: encrypted
      };
    } catch (error) {
      throw new Error(`Encryption failed: ${error.message}`);
    }
  }

  /**
   * Decrypt a single value using AES-256-GCM
   * Expects: { iv, authTag, encryptedValue } - all hex-encoded
   */
  decryptField(encrypted) {
    try {
      const iv = Buffer.from(encrypted.iv, 'hex');
      const authTag = Buffer.from(encrypted.authTag, 'hex');

      const decipher = crypto.createDecipheriv('aes-256-gcm', this.encryptionKey, iv);
      decipher.setAuthTag(authTag);

      let decrypted = decipher.update(encrypted.encryptedValue, 'hex', 'utf8');
      decrypted += decipher.final('utf8');

      return decrypted;
    } catch (error) {
      throw new Error(`Decryption failed: ${error.message}. Settings file may be corrupted or encrypted with different key.`);
    }
  }

  /**
   * Save settings to disk
   * Encrypts sensitive fields, keeps metadata plaintext
   * 
   * @param {Object} settings - Raw settings object with plaintext credentials
   * @returns {Object} { success: boolean, message: string, error?: string, recovery?: string }
   */
  save(settings) {
    try {
      if (!settings || typeof settings !== 'object') {
        return {
          success: false,
          message: 'Invalid settings object',
          error: 'Settings must be a non-empty object',
          recovery: 'Ensure POST body is valid JSON with required credential fields'
        };
      }

      // Validate required fields
      const missingFields = this.encryptedFields.filter(f => !settings[f]);
      if (missingFields.length > 0) {
        return {
          success: false,
          message: 'Missing required credentials',
          error: `Missing fields: ${missingFields.join(', ')}`,
          recovery: `Provide all required credentials: ${this.encryptedFields.join(', ')}`
        };
      }

      // Build encrypted settings object
      const encrypted = {
        version: '1.0',
        lastUpdated: new Date().toISOString(),
        credentials: {}
      };

      // Encrypt each sensitive field
      for (const field of this.encryptedFields) {
        if (settings[field]) {
          encrypted.credentials[field] = this.encryptField(String(settings[field]));
        }
      }

      // Atomic write: write to temp file first, then rename
      const tempFile = this.settingsFile + '.tmp';
      const jsonContent = JSON.stringify(encrypted, null, 2);

      fs.writeFileSync(tempFile, jsonContent, { mode: 0o600 }); // Read/write for user only
      fs.renameSync(tempFile, this.settingsFile);

      console.log(`[SettingsManager] ✓ Settings saved to: ${this.settingsFile}`);

      return {
        success: true,
        message: 'Settings saved successfully',
        path: this.settingsFile
      };
    } catch (error) {
      const isPermissionError = error.code === 'EACCES';
      const isPathError = error.code === 'ENOENT';

      return {
        success: false,
        message: 'Failed to save settings',
        error: error.message,
        recovery: isPermissionError
          ? `No write permission for ${this.appDataDir}. Check folder permissions (need read/write).`
          : isPathError
            ? `Invalid path: ${this.settingsFile}. Ensure directory exists.`
            : `Unable to write to ${this.settingsFile}. Check disk space and permissions.`
      };
    }
  }

  /**
   * Load settings from disk
   * Decrypts sensitive fields
   * 
   * @returns {Object} { success: boolean, data?: Object, message: string, error?: string, recovery?: string }
   */
  load() {
    try {
      if (!fs.existsSync(this.settingsFile)) {
        return {
          success: false,
          message: 'No settings file found',
          error: `Settings file not found at ${this.settingsFile}`,
          recovery: 'POST to /api/settings with all 7 credentials to initialize settings'
        };
      }

      // Read file
      const jsonContent = fs.readFileSync(this.settingsFile, 'utf8');
      const encrypted = JSON.parse(jsonContent);

      if (!encrypted.credentials) {
        return {
          success: false,
          message: 'Settings file corrupted',
          error: 'Missing credentials object in settings file',
          recovery: 'Delete settings file and POST to /api/settings to reinitialize'
        };
      }

      // Decrypt each field
      const decrypted = {
        siApiKey: this.decryptField(encrypted.credentials.siApiKey),
        oaCompanyId: this.decryptField(encrypted.credentials.oaCompanyId),
        oaApiKey: this.decryptField(encrypted.credentials.oaApiKey),
        oaVaId: this.decryptField(encrypted.credentials.oaVaId),
        oaVaApiKey: this.decryptField(encrypted.credentials.oaVaApiKey),
        oaPilotId: this.decryptField(encrypted.credentials.oaPilotId),
        simBriefPilotId: this.decryptField(encrypted.credentials.simBriefPilotId)
      };

      console.log(`[SettingsManager] ✓ Settings loaded from: ${this.settingsFile}`);

      return {
        success: true,
        data: decrypted,
        message: 'Settings loaded successfully',
        lastUpdated: encrypted.lastUpdated
      };
    } catch (error) {
      const isJsonError = error instanceof SyntaxError;
      const isDecryptError = error.message.includes('Decryption failed');

      return {
        success: false,
        message: 'Failed to load settings',
        error: error.message,
        recovery: isJsonError
          ? `Settings file is corrupted (invalid JSON). Delete ${this.settingsFile} and reinitialize via POST /api/settings`
          : isDecryptError
            ? `Cannot decrypt settings. Encryption key may be wrong, or file corrupted. Delete ${this.settingsFile} and POST new credentials.`
            : `Unknown error reading settings. Check file permissions and try again.`
      };
    }
  }

  /**
   * Delete settings file (for testing or reset)
   */
  delete() {
    try {
      if (fs.existsSync(this.settingsFile)) {
        fs.unlinkSync(this.settingsFile);
        console.log(`[SettingsManager] ✓ Settings deleted: ${this.settingsFile}`);
        return {
          success: true,
          message: 'Settings deleted'
        };
      }
      return {
        success: true,
        message: 'No settings file to delete'
      };
    } catch (error) {
      return {
        success: false,
        message: 'Failed to delete settings',
        error: error.message,
        recovery: `Check file permissions for ${this.settingsFile}`
      };
    }
  }
}

module.exports = new SettingsManager();
