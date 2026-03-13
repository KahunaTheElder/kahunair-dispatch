const fs = require('fs');
const path = require('path');

class VAProfileManager {
  constructor() {
    // Use same appdata path as SettingsManager for consistency
    this.appDataPath = path.join(process.env.APPDATA || process.env.HOME || '.', 'KahunaAir');
    this.profilesDirectory = path.join(this.appDataPath, 'profiles');
    this.vaProfileFile = path.join(this.profilesDirectory, 'va-profile.json');
    this.ensureDirectory();
  }

  ensureDirectory() {
    try {
      if (!fs.existsSync(this.appDataPath)) {
        fs.mkdirSync(this.appDataPath, { recursive: true });
      }
      if (!fs.existsSync(this.profilesDirectory)) {
        fs.mkdirSync(this.profilesDirectory, { recursive: true });
      }
    } catch (error) {
      console.error('[VAProfileManager] Failed to create directory:', error.message);
      throw error;
    }
  }

  createBlankProfile() {
    return {
      name: '',
      callsign: '',
      about: '',
      culture: '',           // e.g. "Island hospitality meets professional aviation standards"
      communicationStyle: 'formal, professional, to-the-point',
      serviceLevel: 'premium',   // standard | premium | ultra-premium
      dispatcherStyle: 'professional and supportive',
      customNotes: '',
      lastUpdated: new Date().toISOString(),
      createdAt: new Date().toISOString()
    };
  }

  load() {
    try {
      if (!fs.existsSync(this.vaProfileFile)) {
        return {
          success: false,
          exists: false,
          profile: null,
          message: 'VA profile not found. Create with POST to save profile.',
          recovery: 'POST /api/va/profile with VA data to create profile'
        };
      }

      const data = fs.readFileSync(this.vaProfileFile, 'utf8');
      const profile = JSON.parse(data);

      return {
        success: true,
        exists: true,
        profile: profile,
        message: 'Loaded VA profile',
        lastUpdated: profile.lastUpdated
      };
    } catch (error) {
      console.error('[VAProfileManager] Load error:', error.message);
      return {
        success: false,
        error: error.message,
        code: 500,
        recovery: 'Check logs. Delete corrupt VA profile file manually and recreate.'
      };
    }
  }

  save(profileData) {
    try {
      // Load existing profile or create blank
      const existingResult = this.load();
      let profile = existingResult.profile || this.createBlankProfile();

      // Update with provided data (allow empty strings to clear fields)
      const fields = ['name', 'callsign', 'about', 'culture', 'communicationStyle', 'serviceLevel', 'dispatcherStyle', 'customNotes'];
      for (const field of fields) {
        if (profileData[field] !== undefined) profile[field] = profileData[field];
      }

      // Always update timestamp
      profile.lastUpdated = new Date().toISOString();

      // Write atomically (temp file first, then rename)
      const tempPath = this.vaProfileFile + '.tmp';

      fs.writeFileSync(tempPath, JSON.stringify(profile, null, 2), 'utf8');
      fs.renameSync(tempPath, this.vaProfileFile);

      return {
        success: true,
        profile: profile,
        message: 'Saved VA profile',
        isNew: !existingResult.exists
      };
    } catch (error) {
      console.error('[VAProfileManager] Save error:', error.message);
      return {
        success: false,
        error: error.message,
        code: 500,
        recovery: 'Check disk space and file permissions. Ensure AppData directory is writable.'
      };
    }
  }

  delete() {
    try {
      if (!fs.existsSync(this.vaProfileFile)) {
        return {
          success: false,
          error: 'VA profile not found',
          code: 404
        };
      }

      fs.unlinkSync(this.vaProfileFile);

      return {
        success: true,
        message: 'Deleted VA profile'
      };
    } catch (error) {
      console.error('[VAProfileManager] Delete error:', error.message);
      return {
        success: false,
        error: error.message,
        code: 500,
        recovery: 'Check file permissions. May need to manually delete profile file.'
      };
    }
  }

  /**
   * Format VA profile into SI-compliant va_data string
   * Returns natural language description suitable for importVAData endpoint
   * 
   * @param {Object} profile - VA profile object
   * @returns {string} Formatted va_data string for SI API
   */
  formatVADataForSI(profile) {
    let vaData = `Virtual Airline: ${profile.name}\n`;
    vaData += `Callsign: ${profile.callsign}\n`;
    vaData += `Personality: ${profile.personality}\n`;

    if (profile.about) {
      vaData += `About: ${profile.about}\n`;
    }

    if (profile.dispatcherStyle) {
      vaData += `Dispatcher Style: ${profile.dispatcherStyle}\n`;
    }

    if (profile.customNotes) {
      vaData += `Notes: ${profile.customNotes}\n`;
    }

    vaData += `Service Standards: Maintain ${profile.personality} service excellence.\n`;
    vaData += `Brand Identity: Represent this virtual airline with professionalism and integrity.`;

    return vaData;
  }
}

module.exports = VAProfileManager;
