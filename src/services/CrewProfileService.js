const fs = require('fs');
const path = require('path');

/**
 * CrewProfileService
 * Manages individual crew member profiles with PeopleId-based matching
 * Handles loading, saving, creating, and role updates
 */

const CREW_PROFILES_DIR = path.join(__dirname, '../data/crew-profiles');
const TEMPLATE_DIR = path.join(__dirname, '../data/templates');

// Ensure crew profiles directory exists
function ensureDirectory() {
  if (!fs.existsSync(CREW_PROFILES_DIR)) {
    fs.mkdirSync(CREW_PROFILES_DIR, { recursive: true });
  }
}

/**
 * Map OnAir numeric role to string
 * @param {number} roleNumber - 0=Captain, 1=First Officer, 2+=Flight Attendant
 * @returns {string} - Role name
 */
function mapRoleFromOnAir(roleNumber) {
  const roleMap = {
    0: 'Captain',
    1: 'First Officer'
  };
  return roleMap[roleNumber] || 'Flight Attendant';
}

/**
 * Get template filename for role
 * @param {string} role - Captain, First Officer, or Flight Attendant
 * @returns {string} - Template filename
 */
function getTemplateFilename(role) {
  const templates = {
    'Captain': 'crew-template-captain.json',
    'First Officer': 'crew-template-fo.json',
    'Flight Attendant': 'crew-template-fa.json'
  };
  return templates[role] || 'crew-template-fa.json';
}

/**
 * Load crew profile by PeopleId (primary lookup)
 * @param {string} peopleId - Unique crew member ID from OnAir
 * @returns {object|null} - Profile or null if not found
 */
function loadByPeopleId(peopleId) {
  try {
    ensureDirectory();

    const filePath = path.join(CREW_PROFILES_DIR, `${peopleId}.json`);

    if (!fs.existsSync(filePath)) {
      return null;
    }

    const content = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    console.error(`[CrewProfileService] Error loading profile for PeopleId ${peopleId}:`, error.message);
    return null;
  }
}

/**
 * Load crew profile by name (fallback lookup)
 * @param {string} firstName - Crew first name
 * @param {string} lastName - Crew last name
 * @returns {object|null} - Profile or null if not found
 */
function loadByName(firstName, lastName) {
  try {
    ensureDirectory();

    const searchName = `${firstName}-${lastName}`.toLowerCase().replace(/\s+/g, '-');
    const filePath = path.join(CREW_PROFILES_DIR, `${searchName}.json`);

    if (!fs.existsSync(filePath)) {
      return null;
    }

    const content = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    // Silently fail for fallback lookup
    return null;
  }
}

/**
 * Save crew profile to disk
 * @param {string} peopleId - Unique crew member ID
 * @param {object} profile - Profile object
 * @returns {boolean} - Success/failure
 */
function save(peopleId, profile) {
  try {
    ensureDirectory();

    const filePath = path.join(CREW_PROFILES_DIR, `${peopleId}.json`);
    fs.writeFileSync(filePath, JSON.stringify(profile, null, 2), 'utf8');

    console.log(`[CrewProfileService] Saved profile for crew ${peopleId}`);
    return true;
  } catch (error) {
    console.error(`[CrewProfileService] Error saving profile for ${peopleId}:`, error.message);
    return false;
  }
}

/**
 * Create crew profile from template
 * @param {string} peopleId - Unique crew member ID
 * @param {object} crewData - OnAir crew data (name, role, etc)
 * @returns {object} - Created profile
 */
function create(peopleId, crewData) {
  try {
    ensureDirectory();

    // Determine role
    const role = crewData.role || mapRoleFromOnAir(crewData.roleNumber || 2);

    // Load appropriate template
    const templateFilename = getTemplateFilename(role);
    const templatePath = path.join(TEMPLATE_DIR, templateFilename);
    const template = JSON.parse(fs.readFileSync(templatePath, 'utf8'));

    // Merge with crew data
    const profile = {
      ...template,
      peopleId: peopleId,
      name: crewData.name || '',
      role: role,
      siApiKey: crewData.siApiKey || null,  // Include SI API key for dispatch
      background: {
        ...template.background,
        flightHours: crewData.flightHours || template.background.flightHours
      }
    };

    // Save immediately
    save(peopleId, profile);

    console.log(`[CrewProfileService] Created default profile for crew ${peopleId} (${profile.name}, ${role})`);
    return profile;
  } catch (error) {
    console.error(`[CrewProfileService] Error creating profile for ${peopleId}:`, error.message);
    // Return minimal profile if creation fails
    return {
      peopleId: peopleId,
      name: crewData.name || 'Unknown',
      role: crewData.role || 'Flight Attendant',
      customNotes: 'Profile auto-generated due to template error'
    };
  }
}

/**
 * Update crew role if it changed in OnAir
 * Matches current OA role and updates profile if different
 * @param {string} peopleId - Crew member ID
 * @param {number} newRoleNumber - New numeric role from OnAir
 * @returns {boolean} - Updated (true) or no change (false)
 */
function updateRoleIfChanged(peopleId, newRoleNumber) {
  try {
    const profile = loadByPeopleId(peopleId);
    if (!profile) {
      return false;
    }

    const newRole = mapRoleFromOnAir(newRoleNumber);

    if (profile.role !== newRole) {
      profile.role = newRole;
      save(peopleId, profile);
      console.log(`[CrewProfileService] Updated role for ${peopleId}: ${profile.role} -> ${newRole}`);
      return true;
    }

    return false;
  } catch (error) {
    console.error(`[CrewProfileService] Error updating role for ${peopleId}:`, error.message);
    return false;
  }
}

/**
 * Validate all crew members have profiles
 * @param {array} crewArray - Array of crew members from flight
 * @returns {object} - {valid: bool, missing: [ids], existing: [ids]}
 */
function validateAllExist(crewArray) {
  const missing = [];
  const existing = [];

  for (const crew of crewArray) {
    const profile = loadByPeopleId(crew.peopleId);

    if (profile) {
      existing.push({
        peopleId: crew.peopleId,
        name: crew.name,
        role: profile.role
      });
    } else {
      missing.push({
        peopleId: crew.peopleId,
        name: crew.name,
        role: crew.role
      });
    }
  }

  return {
    valid: missing.length === 0,
    missing: missing,
    existing: existing
  };
}

/**
 * Get or create profile (main entry point)
 * @param {string} peopleId - Crew member ID
 * @param {object} crewData - OnAir crew data
 * @returns {object} - Profile object
 */
function getOrCreateProfile(peopleId, crewData = {}) {
  let profile = loadByPeopleId(peopleId);

  if (!profile) {
    profile = create(peopleId, crewData);
  }

  return profile;
}

module.exports = {
  loadByPeopleId,
  loadByName,
  save,
  create,
  updateRoleIfChanged,
  validateAllExist,
  getOrCreateProfile,
  mapRoleFromOnAir,
  getTemplateFilename
};
