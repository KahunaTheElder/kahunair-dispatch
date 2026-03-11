/**
 * dispatcherProfileManager.js
 * 
 * Manages company dispatcher profile - stores dispatcher operational style,
 * policies, and contact templates for SI API integration.
 * 
 * Storage: Single dispatcher profile in %APPDATA%\KahunaAir\profiles\dispatcher-profile.json
 */

const fs = require('fs');
const path = require('path');
const fsp = fs.promises;

class DispatcherProfileManager {
  constructor() {
    // Use APPDATA path (profiles directory)
    const appDataPath = process.env.APPDATA || process.env.HOME || '.';
    this.profilesDir = path.join(appDataPath, 'KahunaAir', 'profiles');
    this.dispatcherProfilePath = path.join(this.profilesDir, 'dispatcher-profile.json');
  }

  /**
   * Create blank dispatcher profile template
   * Returns initialized profile object with default values
   */
  createBlankProfile() {
    return {
      companyName: '',
      dispatcherStyle: 'professional', // professional|casual|formal|supportive
      fuelPriceTracking: true, // Track fuel prices at airports
      contactName: '', // Lead dispatcher contact name
      contactEmail: '', // Lead dispatcher contact email
      contactPhone: '', // Lead dispatcher contact phone
      operationalPolicies: '',
      weatherAlerts: true, // Send weather change alerts
      NOTAMTracking: true, // Track NOTAMs for planned routes
      customNotes: '',
      siKey: '', // SI Dispatcher API key (if available)
      dispatcher_data: '', // SI-formatted dispatcher data (will be generated)
      createdAt: new Date().toISOString(),
      lastUpdated: new Date().toISOString()
    };
  }

  /**
   * Load dispatcher profile from disk
   * Returns {success: bool, exists: bool, profile: object, message: string}
   */
  async load() {
    try {
      // Ensure directory exists
      await fsp.mkdir(this.profilesDir, { recursive: true });

      // Check if file exists
      try {
        const data = await fsp.readFile(this.dispatcherProfilePath, 'utf8');
        const profile = JSON.parse(data);
        return {
          success: true,
          exists: true,
          profile,
          message: 'Dispatcher profile loaded successfully'
        };
      } catch (err) {
        if (err.code === 'ENOENT') {
          return {
            success: true,
            exists: false,
            profile: null,
            message: 'No dispatcher profile exists yet. Create one via POST /api/dispatcher/profile'
          };
        }
        throw err;
      }
    } catch (error) {
      console.error('[DispatcherProfileManager] Load error:', error.message);
      return {
        success: false,
        exists: false,
        profile: null,
        message: `Failed to load dispatcher profile: ${error.message}`
      };
    }
  }

  /**
   * Save dispatcher profile to disk (create or update)
   * Atomic write: writes to temp file, then renames
   * Returns {success: bool, profile: object, message: string}
   */
  async save(profileData) {
    try {
      // Ensure directory exists
      await fsp.mkdir(this.profilesDir, { recursive: true });

      // Apply defaults and merge with existing if it exists
      let profile = this.createBlankProfile();
      if (profileData) {
        profile = { ...profile, ...profileData };
      }
      profile.lastUpdated = new Date().toISOString();

      // Atomic write: temp file + rename
      const tempPath = `${this.dispatcherProfilePath}.tmp`;
      const jsonContent = JSON.stringify(profile, null, 2);

      await fsp.writeFile(tempPath, jsonContent, 'utf8');
      await fsp.rename(tempPath, this.dispatcherProfilePath);

      console.log('[DispatcherProfileManager] Profile saved:', profile.companyName || 'unnamed');
      return {
        success: true,
        profile,
        message: 'Dispatcher profile saved successfully'
      };
    } catch (error) {
      console.error('[DispatcherProfileManager] Save error:', error.message);
      return {
        success: false,
        profile: null,
        message: `Failed to save dispatcher profile: ${error.message}`
      };
    }
  }

  /**
   * Delete dispatcher profile (for testing/reset)
   * Returns {success: bool, message: string}
   */
  async delete() {
    try {
      // Only delete if file exists
      try {
        await fsp.unlink(this.dispatcherProfilePath);
        console.log('[DispatcherProfileManager] Profile deleted');
        return {
          success: true,
          message: 'Dispatcher profile deleted successfully'
        };
      } catch (err) {
        if (err.code === 'ENOENT') {
          return {
            success: true,
            message: 'No profile to delete'
          };
        }
        throw err;
      }
    } catch (error) {
      console.error('[DispatcherProfileManager] Delete error:', error.message);
      return {
        success: false,
        message: `Failed to delete dispatcher profile: ${error.message}`
      };
    }
  }

  /**
   * Format dispatcher profile as SI-compliant string
   * Takes profile data and optional flight context, returns natural language string
   * Used for SI API dispatcher_data field
   */
  formatDispatcherDataForSI(profile, flightContext = {}) {
    if (!profile) {
      return 'No dispatcher profile configured.';
    }

    const lines = [];

    // Company and dispatcher style
    if (profile.companyName) {
      lines.push(`Company: ${profile.companyName}`);
      lines.push(`Dispatcher Style: ${profile.dispatcherStyle || 'professional'}`);
    }

    // Contact information
    if (profile.contactName || profile.contactEmail || profile.contactPhone) {
      lines.push(`\nDispatcher Contact:`);
      if (profile.contactName) lines.push(`  Name: ${profile.contactName}`);
      if (profile.contactEmail) lines.push(`  Email: ${profile.contactEmail}`);
      if (profile.contactPhone) lines.push(`  Phone: ${profile.contactPhone}`);
    }

    // Operational policies
    if (profile.operationalPolicies) {
      lines.push(`\nOperational Policies:`);
      lines.push(`  ${profile.operationalPolicies}`);
    }

    // Tracking preferences
    const tracking = [];
    if (profile.fuelPriceTracking) tracking.push('Fuel price tracking enabled');
    if (profile.weatherAlerts) tracking.push('Weather alerts enabled');
    if (profile.NOTAMTracking) tracking.push('NOTAM tracking enabled');
    if (tracking.length > 0) {
      lines.push(`\nTracking & Alerts:`);
      lines.push(`  ${tracking.join(', ')}`);
    }

    // Custom dispatcher notes
    if (profile.customNotes) {
      lines.push(`\nDispatcher Notes:`);
      lines.push(`  ${profile.customNotes}`);
    }

    // Add flight-specific context if provided
    if (flightContext && Object.keys(flightContext).length > 0) {
      lines.push(`\nFlight Context:`);
      if (flightContext.flightNumber) lines.push(`  Flight: ${flightContext.flightNumber}`);
      if (flightContext.route) lines.push(`  Route: ${flightContext.route}`);
      if (flightContext.aircraft) lines.push(`  Aircraft: ${flightContext.aircraft}`);
      if (flightContext.crewCount) lines.push(`  Crew: ${flightContext.crewCount}`);
    }

    // Ensure we have at least some content
    if (lines.length === 0) {
      return `Company: ${profile.companyName || 'Unknown'}\nDispatcher Style: ${profile.dispatcherStyle || 'professional'}\nNo additional dispatcher profile configured.`;
    }

    return lines.join('\n');
  }
}

module.exports = DispatcherProfileManager;
