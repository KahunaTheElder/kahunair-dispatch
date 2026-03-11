const fs = require('fs');
const path = require('path');

/**
 * VAProfileService
 * Manages virtual airline profile persistence and auto-creation
 * Handles loading, saving, and creating VA profiles from templates
 */

const VA_PROFILES_DIR = path.join(__dirname, '../data/va-profiles');
const TEMPLATE_PATH = path.join(__dirname, '../data/templates/va-template.json');

// Ensure VA profiles directory exists
function ensureDirectory() {
  if (!fs.existsSync(VA_PROFILES_DIR)) {
    fs.mkdirSync(VA_PROFILES_DIR, { recursive: true });
  }
}

/**
 * Load existing VA profile from disk
 * @param {string} vaId - VA company ID
 * @returns {object|null} - Profile object or null if not found
 */
function loadProfile(vaId) {
  try {
    ensureDirectory();

    // For KahunaAir, use hardcoded filename
    const filename = vaId === 'b5756657-1ef9-40c5-8d1f-bfd3a0e33f19'
      ? 'kahuna-air.json'
      : `va-${vaId}.json`;

    const filePath = path.join(VA_PROFILES_DIR, filename);

    if (!fs.existsSync(filePath)) {
      return null;
    }

    const content = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    console.error(`[VAProfileService] Error loading profile for ${vaId}:`, error.message);
    return null;
  }
}

/**
 * Save VA profile to disk
 * @param {string} vaId - VA company ID
 * @param {object} profile - Profile object to save
 * @returns {boolean} - Success/failure
 */
function saveProfile(vaId, profile) {
  try {
    ensureDirectory();

    const filename = vaId === 'b5756657-1ef9-40c5-8d1f-bfd3a0e33f19'
      ? 'kahuna-air.json'
      : `va-${vaId}.json`;

    const filePath = path.join(VA_PROFILES_DIR, filename);
    fs.writeFileSync(filePath, JSON.stringify(profile, null, 2), 'utf8');

    console.log(`[VAProfileService] Saved profile for ${vaId} to ${filename}`);
    return true;
  } catch (error) {
    console.error(`[VAProfileService] Error saving profile for ${vaId}:`, error.message);
    return false;
  }
}

/**
 * Create default VA profile from template
 * @param {string} vaId - VA company ID
 * @param {object} vaData - OnAir VA data (name, callsign, etc)
 * @returns {object} - Created profile
 */
function createDefaultProfile(vaId, vaData) {
  try {
    // Load template
    const template = JSON.parse(fs.readFileSync(TEMPLATE_PATH, 'utf8'));

    // Merge with OnAir data
    const profile = {
      ...template,
      vaId: vaId,
      name: vaData.name || template.name,
      callsign: vaData.callsign || template.callsign,
      airlineCode: vaData.airlineCode || template.airlineCode,
      profile: {
        ...template.profile,
        description: vaData.description || template.profile.description,
        difficultyLevel: vaData.difficultyLevel || template.profile.difficultyLevel
      }
    };

    // Save immediately
    saveProfile(vaId, profile);

    console.log(`[VAProfileService] Created default profile for ${vaId}`);
    return profile;
  } catch (error) {
    console.error(`[VAProfileService] Error creating default profile:`, error.message);
    // Return template if creation fails
    return JSON.parse(fs.readFileSync(TEMPLATE_PATH, 'utf8'));
  }
}

/**
 * Check if profile exists
 * @param {string} vaId - VA company ID
 * @returns {boolean} - Profile exists
 */
function profileExists(vaId) {
  const profile = loadProfile(vaId);
  return profile !== null;
}

/**
 * Get or create profile (main entry point)
 * @param {string} vaId - VA company ID
 * @param {object} vaData - OnAir VA data (for creation)
 * @returns {object} - Profile object
 */
function getOrCreateProfile(vaId, vaData = {}) {
  let profile = loadProfile(vaId);

  if (!profile) {
    profile = createDefaultProfile(vaId, vaData);
  }

  return profile;
}

module.exports = {
  loadProfile,
  saveProfile,
  createDefaultProfile,
  profileExists,
  getOrCreateProfile
};
