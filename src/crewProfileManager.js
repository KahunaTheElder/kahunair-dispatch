const fs = require('fs');
const path = require('path');
const os = require('os');

class CrewProfileManager {
  constructor() {
    // Use same appdata path as SettingsManager for consistency
    this.appDataPath = path.join(process.env.APPDATA || process.env.HOME || '.', 'KahunaAir');
    this.crewsDirectory = path.join(this.appDataPath, 'crews');
    this.ensureDirectory();
  }

  ensureDirectory() {
    try {
      if (!fs.existsSync(this.appDataPath)) {
        fs.mkdirSync(this.appDataPath, { recursive: true });
      }
      if (!fs.existsSync(this.crewsDirectory)) {
        fs.mkdirSync(this.crewsDirectory, { recursive: true });
      }
    } catch (error) {
      console.error('[CrewProfileManager] Failed to create directory:', error.message);
      throw error;
    }
  }

  getProfilePath(crewId) {
    return path.join(this.crewsDirectory, `${crewId}.json`);
  }

  createBlankProfile(crewId, currentName = '', role = null, companyId = null) {
    return {
      id: crewId,
      currentName: currentName,
      role: role, // 0=Captain, 1=Flag Officer, 2=Flight Attendant
      companyId: companyId,
      personality: 'standard', // formal | casual | humorous | standard
      customNotes: '',
      siKey: '', // SayIntentions.AI crew key
      lastUpdated: new Date().toISOString(),
      createdAt: new Date().toISOString()
    };
  }

  /**
   * Format crew profile into SI-compliant crew_data string
   * Returns natural language description suitable for importVAData endpoint
   * 
   * @param {Object} profile - Crew profile object
   * @param {Object} flightContext - Optional flight context (aircraft, route, etc)
   * @returns {string} Formatted crew_data string for SI API
   */
  formatCrewDataForSI(profile, flightContext = {}) {
    const roleNames = { 0: 'Captain', 1: 'First Officer', 2: 'Flight Attendant' };
    const personlityDescriptions = {
      formal: 'professional and formal demeanor',
      casual: 'friendly and casual approach',
      humorous: 'humorous and personable style',
      standard: 'standard professional manner'
    };

    let crewData = `Crew Member: ${profile.currentName}\n`;
    crewData += `Role: ${roleNames[profile.role] || 'Crew'}\n`;
    crewData += `Personality: ${personlityDescriptions[profile.personality] || 'standard'}\n`;

    if (profile.customNotes) {
      crewData += `Notes: ${profile.customNotes}\n`;
    }

    if (flightContext.aircraft) {
      crewData += `Aircraft: ${flightContext.aircraft}\n`;
    }

    if (flightContext.route) {
      crewData += `Route: ${flightContext.route}\n`;
    }

    if (flightContext.passengers) {
      crewData += `Passengers: ${flightContext.passengers} onboard\n`;
    }

    crewData += `Service Standards: Focus on ${profile.personality} crew interactions.\n`;
    crewData += `Safety: Maintain professional safety procedures at all times.`;

    return crewData;
  }

  load(crewId) {
    try {
      const profilePath = this.getProfilePath(crewId);
      console.log('[CrewProfileManager.load] Profile path:', profilePath);

      if (!fs.existsSync(profilePath)) {
        console.log(`[CrewProfileManager.load] ✗ Profile file does NOT exist at ${profilePath}`);
        return {
          success: false,
          isNew: true,
          profile: null,
          message: `Crew member ${crewId} not found. Create with POST to save profile.`,
          recovery: `POST /api/crew/${crewId}/profile with crew data to create profile`
        };
      }

      console.log(`[CrewProfileManager.load] ✓ Profile file exists at ${profilePath}, reading...`);
      const data = fs.readFileSync(profilePath, 'utf8');
      console.log(`[CrewProfileManager.load] File size: ${data.length} bytes`);

      const profile = JSON.parse(data);
      console.log(`[CrewProfileManager.load] ✓ Parsed profile, fields:`, Object.keys(profile).slice(0, 10)); console.log(`[CrewProfileManager.load] Profile has typeRatings?`, Array.isArray(profile.typeRatings), 'Items:', profile.typeRatings?.length);
      console.log(`[CrewProfileManager.load] Profile has totalHours?`, typeof profile.totalHours, 'Value:', profile.totalHours);
      return {
        success: true,
        isNew: false,
        profile: profile,
        message: `Loaded crew profile for ${crewId}`,
        lastUpdated: profile.lastUpdated
      };
    } catch (error) {
      console.error(`[CrewProfileManager.load] ✗ Load error for crew ${crewId}:`, error.message);
      return {
        success: false,
        error: error.message,
        code: 500,
        recovery: 'Check logs. Delete corrupt crew profile file manually and recreate.'
      };
    }
  }

  save(crewId, profileData) {
    try {
      if (!crewId || typeof crewId !== 'string') {
        return {
          success: false,
          error: 'Invalid crew ID',
          code: 400,
          recovery: 'Provide a valid crew ID (string)'
        };
      }

      // Load existing profile or create new one
      const existingResult = this.load(crewId);
      let profile = existingResult.profile;

      // If no existing profile, create new one with minimal defaults
      if (!profile) {
        profile = {
          id: crewId,
          createdAt: new Date().toISOString()
        };
      }

      // ===== CRITICAL FIX: Store ALL fields from the SI-compliant form =====
      // The CrewProfileEditorV2 modal sends full SI-compliant crew_data structure
      // We must preserve ALL fields (name, totalHours, typeRatings, pilotPersonality, etc.)
      // as-is because they are already in the correct SI format.
      //
      // NEVER discard fields, NO mapping, NO schema mismatch - just merge everything
      Object.keys(profileData).forEach(key => {
        // Only skip the internal 'id' field - let the system control that
        if (key !== 'id') {
          profile[key] = profileData[key];
        }
      });

      // Always update timestamp
      profile.lastUpdated = new Date().toISOString();

      // Write atomically (temp file first, then rename)
      const profilePath = this.getProfilePath(crewId);
      const tempPath = profilePath + '.tmp';

      console.log(`[CrewProfileManager.save] Profile object keys before write:`, Object.keys(profile).slice(0, 15));
      console.log(`[CrewProfileManager.save] Profile has typeRatings?`, Array.isArray(profile.typeRatings), 'Items:', profile.typeRatings?.length);

      const jsonString = JSON.stringify(profile, null, 2);
      console.log(`[CrewProfileManager.save] JSON to write: ${jsonString.length} bytes`);

      fs.writeFileSync(tempPath, jsonString, 'utf8');
      fs.renameSync(tempPath, profilePath);

      console.log(`[CrewProfileManager] Successfully saved crew profile for ${crewId} at ${profilePath}`);

      return {
        success: true,
        profile: profile,
        message: `Saved crew profile for ${crewId}`,
        isNew: !existingResult.profile
      };
    } catch (error) {
      console.error(`[CrewProfileManager] Save error for crew ${crewId}:`, error.message);
      return {
        success: false,
        error: error.message,
        code: 500,
        recovery: 'Check disk space and file permissions. Ensure AppData directory is writable.'
      };
    }
  }

  delete(crewId) {
    try {
      const profilePath = this.getProfilePath(crewId);

      if (!fs.existsSync(profilePath)) {
        return {
          success: false,
          error: `Profile for crew ${crewId} not found`,
          code: 404
        };
      }

      fs.unlinkSync(profilePath);

      return {
        success: true,
        message: `Deleted crew profile for ${crewId}`
      };
    } catch (error) {
      console.error(`[CrewProfileManager] Delete error for crew ${crewId}:`, error.message);
      return {
        success: false,
        error: error.message,
        code: 500,
        recovery: 'Check file permissions. May need to manually delete profile file.'
      };
    }
  }

  listAll() {
    try {
      const files = fs.readdirSync(this.crewsDirectory);
      const crews = [];

      for (const file of files) {
        if (file.endsWith('.json')) {
          const crewId = file.replace('.json', '');
          const result = this.load(crewId);
          if (result.success && result.profile) {
            crews.push(result.profile);
          }
        }
      }

      return {
        success: true,
        crews: crews,
        count: crews.length
      };
    } catch (error) {
      console.error('[CrewProfileManager] List error:', error.message);
      return {
        success: false,
        error: error.message,
        code: 500
      };
    }
  }

  updateCurrentName(crewId, currentName) {
    try {
      const result = this.load(crewId);

      if (!result.success && result.isNew) {
        // Create new profile with just the name updated
        return this.save(crewId, { currentName });
      }

      if (!result.profile) {
        return {
          success: false,
          error: `Could not load profile for crew ${crewId}`,
          code: 500
        };
      }

      return this.save(crewId, { ...result.profile, currentName });
    } catch (error) {
      console.error(`[CrewProfileManager] Update name error for crew ${crewId}:`, error.message);
      return {
        success: false,
        error: error.message,
        code: 500
      };
    }
  }
}

module.exports = CrewProfileManager;
