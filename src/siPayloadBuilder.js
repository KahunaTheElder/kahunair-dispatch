'use strict';

// =============================================================================
// SI Payload Builder
// Assembles the crew_data, copilot_data, and dispatcher_data strings
// for the SayIntentions.AI importVAData endpoint.
//
// All output is natural language plain text (not JSON).
// SI expects paragraph-format strings.
// =============================================================================

/**
 * Build crew_data string (captain intro + all FAs + VA culture)
 * @param {Object} captainProfile - my-pilot profile
 * @param {Object[]} faProfiles - Array of FA profiles (fully saved)
 * @param {Object} flight - Formatted flight object from server
 * @param {Object} vaProfile - VA profile from kahuna-air.json
 * @param {Object[]} faMembers - Raw FA crew member list (for fallback name listing)
 * @returns {string}
 */
function buildCrewData(captainProfile, faProfiles, flight, vaProfile, faMembers = []) {
  const va = vaProfile || {};
  const vaName = va.name || 'Kahuna Air Industries';
  const aircraft = flight?.aircraft?.displayName || flight?.aircraft?.type || 'Unknown Aircraft';
  const dep = flight?.route?.departure?.ICAO || '----';
  const arr = flight?.route?.arrival?.ICAO || '----';
  const reg = flight?.aircraft?.registration || '';

  const lines = [];
  lines.push(`Virtual Airline: ${vaName}`);
  lines.push(`Culture: ${va.profile?.traditions || 'Professional aviation with island hospitality standards'}`);
  lines.push(`Service Standard: ${va.operationalPolicy?.passengerServiceLevel || 'premium'}`);
  lines.push(`Flight: ${dep} → ${arr} | Aircraft: ${aircraft}${reg ? ' (' + reg + ')' : ''}`);
  lines.push('');

  // Captain intro line
  if (captainProfile) {
    const cpBg = captainProfile.background || {};
    const cpPers = captainProfile.personality || {};
    lines.push(`Captain: ${captainProfile.name || 'Captain'}`);
    lines.push(`Experience: ${cpBg.experienceLevel || 'Experienced'} (${Math.round(cpBg.flightHours || 0).toLocaleString()} hours)`);
    if (cpBg.specialty) lines.push(`Specialty: ${cpBg.specialty}`);
    if (cpPers.style) lines.push(`Personality: ${cpPers.style}`);
    if (cpBg.certifications?.length) lines.push(`Certifications: ${cpBg.certifications.join(', ')}`);
    lines.push('');
  }

  // Flight Attendants
  const profiledFaNames = new Set(faProfiles.map(f => f?.name).filter(Boolean));
  const allFaCount = Math.max(faProfiles.length, faMembers.length);
  if (allFaCount > 0) {
    lines.push('CABIN CREW:');
    for (const fa of faProfiles) {
      if (!fa) continue;
      const faBg = fa.background || {};
      const faCabin = fa.cabinManagementPreferences || {};
      lines.push(`  ${fa.name || 'Flight Attendant'} — ${faBg.experienceLevel || 'Flight Attendant'}`);
      if (faCabin.serviceStyle) lines.push(`    Service Style: ${faCabin.serviceStyle}`);
      if (faBg.specialty) lines.push(`    Specialty: ${faBg.specialty}`);
      if (faBg.certifications?.length) lines.push(`    Certs: ${faBg.certifications.join(', ')}`);
    }
    // List any FAs that don't have a full profile yet (name only)
    for (const member of faMembers) {
      if (!profiledFaNames.has(member.name)) {
        lines.push(`  ${member.name} — (profile pending)`);
      }
    }
    lines.push('');
  }

  lines.push(`Operational Policy: ${va.operationalPolicy?.crewProfessionalism || 'professional'} — ${va.operationalPolicy?.communicationStyle || 'formal, to-the-point'}`);
  lines.push(`Safety Priority: ${va.operationalPolicy?.safetyPriority || 'highest'}`);

  return lines.join('\n');
}

/**
 * Build copilot_data string (FO personality + captain context + flight details)
 * @param {Object} foProfile - FO profile
 * @param {Object} captainProfile - my-pilot profile (captain preferences for FO reference)
 * @param {Object} flight - Formatted flight object
 * @param {Object} [ofpData] - Optional SimBrief OFP data
 * @returns {string}
 */
function buildCopilotData(foProfile, captainProfile, flight, ofpData) {
  const dep = flight?.route?.departure?.ICAO || '----';
  const arr = flight?.route?.arrival?.ICAO || '----';
  const aircraft = flight?.aircraft?.displayName || flight?.aircraft?.type || 'Unknown Aircraft';
  const reg = flight?.aircraft?.registration || '';
  const pax = flight?.payload?.passengerCount || 0;
  const cargo = flight?.payload?.cargoWeight || 0;
  const cargoUoM = flight?.payload?.cargoWeightUoM || 'lbs';

  const lines = [];

  // FO section
  if (foProfile) {
    const foBg = foProfile.background || {};
    const foPers = foProfile.personality || {};
    const foOps = foProfile.operationalPreferences || {};
    lines.push(`First Officer: ${foProfile.name || 'First Officer'}`);
    lines.push(`Experience: ${foBg.experienceLevel || 'First Officer'} (${Math.round(foBg.flightHours || 0).toLocaleString()} hours)`);
    if (foBg.specialty) lines.push(`Background: ${foBg.specialty}`);
    if (foPers.style) lines.push(`Personality: ${foPers.style}`);
    if (foPers.communicationPreference) lines.push(`Communication Style: ${foPers.communicationPreference}`);
    if (foOps.crewInteraction) lines.push(`Crew Interaction: ${foOps.crewInteraction}`);
    if (foBg.certifications?.length) lines.push(`Certifications: ${foBg.certifications.join(', ')}`);
    lines.push('');
  }

  // Flight context
  lines.push('FLIGHT CONTEXT:');
  lines.push(`Filed Route: ${dep} → ${arr}`);
  lines.push(`Aircraft: ${aircraft}${reg ? ' (' + reg + ')' : ''}`);
  if (pax > 0) lines.push(`Passengers: ${pax}`);
  if (cargo > 0) lines.push(`Cargo: ${cargo} ${cargoUoM}`);

  if (ofpData) {
    if (ofpData.tow) lines.push(`Takeoff Weight: ${ofpData.tow}K lbs`);
    if (ofpData.blockFuel) lines.push(`Block Fuel: ${ofpData.blockFuel}K lbs`);
    if (ofpData.route) lines.push(`Route: ${ofpData.route}`);
  }

  lines.push('');

  // Captain preferences (so FO knows how captain works)
  if (captainProfile) {
    const cpOps = captainProfile.operationalPreferences || {};
    const cpPers = captainProfile.personality || {};
    lines.push('CAPTAIN CONTEXT (for FO reference):');
    lines.push(`Captain: ${captainProfile.name || 'Captain'}`);
    if (cpOps.procedureStyle) lines.push(`Procedure Style: ${cpOps.procedureStyle}`);
    if (cpPers.communicationPreference) lines.push(`Communication Preference: ${cpPers.communicationPreference}`);
    if (cpOps.crewInteraction) lines.push(`Crew Interaction Style: ${cpOps.crewInteraction}`);
  }

  return lines.join('\n');
}

/**
 * Build dispatcher_data string using available flight data
 * @param {Object} flight - Formatted flight object
 * @param {Object} vaProfile - VA profile
 * @returns {string}
 */
function buildDispatcherData(flight, vaProfile) {
  const va = vaProfile || {};
  const dep = flight?.route?.departure;
  const arr = flight?.route?.arrival;
  const aircraft = flight?.aircraft?.displayName || flight?.aircraft?.type || 'Unknown Aircraft';
  const pax = flight?.payload?.passengerCount || 0;
  const cargo = flight?.payload?.cargoWeight || 0;
  const cargoUoM = flight?.payload?.cargoWeightUoM || 'lbs';
  const crewTotal = flight?.crew?.total || 0;

  const depStyle = va.dispatcherPersonality?.style || 'professional and supportive';
  const briefingStyle = va.dispatcherPersonality?.flightBriefing || 'Comprehensive with focus on safety and efficiency';

  const lines = [];
  lines.push('DISPATCH BRIEFING');
  lines.push(`Airline: ${va.name || 'Kahuna Air Industries'}`);
  lines.push('');
  lines.push(`Route: ${dep?.ICAO || '----'} (${dep?.name || '----'}) → ${arr?.ICAO || '----'} (${arr?.name || '----'})`);
  lines.push(`Aircraft: ${aircraft}`);
  lines.push(`Crew: ${crewTotal} crew members`);
  if (pax > 0) lines.push(`Passengers: ${pax}`);
  if (cargo > 0) lines.push(`Cargo: ${cargo} ${cargoUoM}`);
  lines.push('');
  lines.push(`Dispatcher Style: ${depStyle}`);
  lines.push(`Briefing Approach: ${briefingStyle}`);
  lines.push('Weather Guidance: Proactive — provides recommendations and alternatives');
  lines.push('');
  lines.push('Standard Procedures:');
  lines.push('- Pre-flight check complete');
  lines.push('- Flight plan filed and confirmed');
  lines.push('- Weather briefing available');
  lines.push('- Clearance expected on initial contact');
  lines.push('- Maintain standard separation and procedures');

  return lines.join('\n');
}

/**
 * Assemble the full VA payload for the importVAData endpoint.
 *
 * @param {Object} crewProfilesMap - { 'my-pilot': {...}, 'uuid-fo': {...}, 'uuid-fa1': {...} }
 *   Keys are either 'my-pilot' (captain) or OA crew UUID.
 *   Values are full profile objects (or null for skipped crew).
 * @param {Object[]} crewMembers - Crew member list from flight (includes role, isMe, id)
 * @param {Object} flight - Formatted flight object from server
 * @param {Object} vaProfile - VA profile (from kahuna-air.json)
 * @param {Object} [ofpData] - Optional SimBrief OFP weights/route data
 * @returns {{ crew_data: string, copilot_data: string, dispatcher_data: string }}
 */
function assembleVAPayload(crewProfilesMap, crewMembers, flight, vaProfile, ofpData = null) {
  // Resolve captain — always override stored profile name with live OnAir member name
  const captainMember = crewMembers.find(m => m.isMe || m.role === 'Captain');
  const captainProfileRaw = crewProfilesMap['my-pilot'] || null; // captain always saved under 'my-pilot' key
  const captainProfile = (captainProfileRaw && captainMember)
    ? { ...captainProfileRaw, name: captainMember.name }
    : captainProfileRaw;

  // Resolve FO — use OnAir member name
  const foMember = crewMembers.find(m => m.role === 'First Officer');
  const foProfileRaw = foMember ? (crewProfilesMap[foMember.id] || null) : null;
  const foProfile = (foProfileRaw && foMember)
    ? { ...foProfileRaw, name: foMember.name }
    : foProfileRaw;

  // Resolve FA profiles — use OnAir member names
  const faMembers = crewMembers.filter(m => m.role === 'Flight Attendant');
  const faProfiles = faMembers
    .map(m => {
      const profile = crewProfilesMap[m.id];
      if (!profile) return null;
      return { ...profile, name: m.name }; // live OnAir name takes precedence
    })
    .filter(Boolean);

  const crew_data = buildCrewData(captainProfile, faProfiles, flight, vaProfile, faMembers);
  const copilot_data = buildCopilotData(foProfile, captainProfile, flight, ofpData);
  const dispatcher_data = buildDispatcherData(flight, vaProfile);

  return { crew_data, copilot_data, dispatcher_data };
}

module.exports = {
  assembleVAPayload,
  buildCrewData,
  buildCopilotData,
  buildDispatcherData
};
