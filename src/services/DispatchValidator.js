/**
 * DispatchValidator
 * Validates readiness before dispatching to SayIntentions.AI
 * Checks crew profiles, VA profile, and payload completeness
 */

/**
 * Validate crew role is present
 * @param {object} crew - Crew member data
 * @returns {object} - {valid, errors}
 */
function validateCrewRole(crew) {
  const errors = [];

  if (!crew.role) {
    errors.push(`Crew ${crew.name}: Missing role`);
  }

  if (!['Captain', 'First Officer', 'Flight Attendant'].includes(crew.role)) {
    errors.push(`Crew ${crew.name}: Invalid role "${crew.role}"`);
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Validate crew profile has required content
 * @param {object} profile - Crew profile
 * @returns {object} - {valid, errors, warnings}
 */
function validateCrewProfile(profile) {
  const errors = [];
  const warnings = [];

  // Required fields
  if (!profile.peopleId) errors.push('Missing peopleId');
  if (!profile.name) errors.push('Missing crew name');
  if (!profile.role) errors.push('Missing crew role');

  // Personality validation
  if (!profile.personality) {
    warnings.push('Missing personality section - using defaults');
  } else {
    if (!profile.personality.style) warnings.push('Missing personality style');
    if (!profile.personality.communicationPreference) warnings.push('Missing communication preference');
  }

  // Background validation
  if (!profile.background) {
    warnings.push('Missing background section');
  } else {
    if (!profile.background.flightHours && profile.background.flightHours !== 0) {
      warnings.push('Missing flight hours');
    }
    if (!profile.background.experienceLevel) warnings.push('Missing experience level');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

/**
 * Validate VA profile has required content
 * @param {object} vaProfile - VA profile
 * @returns {object} - {valid, errors, warnings}
 */
function validateVAProfile(vaProfile) {
  const errors = [];
  const warnings = [];

  // Defensive check - ensure vaProfile exists
  if (!vaProfile) {
    errors.push('VA profile missing');
    return { valid: false, errors, warnings };
  }

  // Required fields (vaId is optional - may not be in all session structures)
  if (!vaProfile.name) errors.push('Missing VA name');

  // Operational policy validation
  if (!vaProfile.operationalPolicy) {
    warnings.push('Missing operational policy');
  } else {
    if (!vaProfile.operationalPolicy.crewProfessionalism) warnings.push('Missing crew professionalism setting');
    if (!vaProfile.operationalPolicy.communicationStyle) warnings.push('Missing communication style');
  }

  // Dispatcher personality validation
  if (!vaProfile.dispatcherPersonality) {
    warnings.push('Missing dispatcher personality');
  }

  if (!vaProfile.profile) {
    warnings.push('Missing VA profile section');
  } else {
    if (!vaProfile.profile.culture) warnings.push('Missing VA culture definition');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

/**
 * Validate complete dispatch readiness
 * @param {object} sessionData - Session data with VA and crew
 * @param {object} payloadData - Payload to be sent to SI
 * @returns {object} - {ready, errors, warnings, details}
 */
function validateReadiness(sessionData, payloadData = null) {
  const errors = [];
  const warnings = [];
  const details = {
    va: null,
    crew: [],
    payload: null
  };

  try {
    // Validate session exists
    if (!sessionData) {
      errors.push('No active flight session');
      return {
        ready: false,
        errors,
        warnings,
        details
      };
    }

    // Validate VA profile
    const vaValidation = validateVAProfile(sessionData.vaProfile);
    if (!vaValidation.valid) {
      errors.push(...vaValidation.errors);
    }
    warnings.push(...vaValidation.warnings);
    details.va = {
      name: sessionData.vaProfile?.name || 'Unknown VA',
      valid: vaValidation.valid,
      errors: vaValidation.errors
    };

    // Validate crew profiles and roles
    if (!sessionData.crewProfiles || sessionData.crewProfiles.length === 0) {
      errors.push('No crew profiles in session');
    } else {
      for (const crew of sessionData.crewProfiles) {
        const crewRoleValidation = validateCrewRole(crew);
        const crewProfileValidation = validateCrewProfile(crew);

        if (!crewRoleValidation.valid) {
          errors.push(...crewRoleValidation.errors);
        }

        if (!crewProfileValidation.valid) {
          errors.push(...crewProfileValidation.errors);
        }

        warnings.push(...crewProfileValidation.warnings);

        details.crew.push({
          name: crew.name,
          role: crew.role,
          valid: crewRoleValidation.valid && crewProfileValidation.valid,
          errors: [...crewRoleValidation.errors, ...crewProfileValidation.errors]
        });
      }
    }

    // Validate payload if provided
    if (payloadData) {
      const payloadValidation = validatePayload(payloadData);
      if (!payloadValidation.valid) {
        errors.push(...payloadValidation.errors);
      }
      warnings.push(...payloadValidation.warnings);
      details.payload = payloadValidation;
    }

    return {
      ready: errors.length === 0,
      errors,
      warnings,
      details
    };
  } catch (error) {
    errors.push(`Validation error: ${error.message}`);
    return {
      ready: false,
      errors,
      warnings,
      details
    };
  }
}

/**
 * Validate dispatch payload structure
 * @param {object} payload - Payload to send to SI
 * @returns {object} - {valid, errors, warnings}
 */
function validatePayload(payload) {
  const errors = [];
  const warnings = [];

  // Check required fields
  if (!payload.crew_data) {
    errors.push('Missing crew_data in payload');
  } else if (typeof payload.crew_data !== 'string' || payload.crew_data.length === 0) {
    errors.push('crew_data must be non-empty string');
  }

  if (!payload.dispatcher_data) {
    errors.push('Missing dispatcher_data in payload');
  } else if (typeof payload.dispatcher_data !== 'string' || payload.dispatcher_data.length === 0) {
    errors.push('dispatcher_data must be non-empty string');
  }

  if (!payload.copilot_data) {
    warnings.push('copilot_data is optional but recommended');
  } else if (typeof payload.copilot_data !== 'string') {
    errors.push('copilot_data must be string');
  }

  // Check payload sizes
  if (payload.crew_data && payload.crew_data.length > 10000) {
    warnings.push('crew_data is very large (>10KB) - consider simplifying');
  }

  if (payload.dispatcher_data && payload.dispatcher_data.length > 10000) {
    warnings.push('dispatcher_data is very large (>10KB) - consider simplifying');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    sizes: {
      crew_data: payload.crew_data ? payload.crew_data.length : 0,
      dispatcher_data: payload.dispatcher_data ? payload.dispatcher_data.length : 0,
      copilot_data: payload.copilot_data ? payload.copilot_data.length : 0
    }
  };
}

/**
 * Check crew has required profiles (blocking pattern)
 * @param {array} crewArray - Array of crew members
 * @param {function} checkProfileExists - Function to check if profile exists (takes peopleId)
 * @returns {object} - {allExist, missing}
 */
function validateCrewProfilesExist(crewArray, checkProfileExists) {
  const missing = [];

  for (const crew of crewArray) {
    if (!checkProfileExists(crew.peopleId)) {
      missing.push({
        peopleId: crew.peopleId,
        name: crew.name,
        role: crew.role
      });
    }
  }

  return {
    allExist: missing.length === 0,
    missing,
    count: {
      total: crewArray.length,
      existing: crewArray.length - missing.length,
      missing: missing.length
    }
  };
}

/**
 * Get human-readable validation summary
 * @param {object} validation - Result from validateReadiness
 * @returns {string} - Summary text
 */
function getSummary(validation) {
  if (validation.ready) {
    return `✅ Ready for dispatch (${validation.details.crew.length} crew, ${validation.warnings.length} warnings)`;
  }

  const errorCount = validation.errors.length;
  const warningCount = validation.warnings.length;
  return `❌ Not ready: ${errorCount} error(s), ${warningCount} warning(s)`;
}

module.exports = {
  validateReadiness,
  validateCrewProfile,
  validateCrewRole,
  validateVAProfile,
  validatePayload,
  validateCrewProfilesExist,
  getSummary
};
