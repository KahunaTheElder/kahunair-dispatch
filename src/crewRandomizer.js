'use strict';

// =============================================================================
// Crew Profile Randomizer
// Generates realistic crew personality profiles from curated option pools.
// Used by the backend to pre-populate profile fields.
// =============================================================================

const CAPTAIN_SPECIALTIES = [
  'Long-haul international operations',
  'Multi-engine turboprop transitions',
  'High-altitude mountain flying',
  'Oceanic / ETOPS certified',
  'Cargo and freight operations',
  'Corporate charter and VIP transport',
  'Low-visibility CAT III approaches',
  'Island and short-field operations',
  'Heavy widebody aircraft transitions',
  'Regional jet operations',
  'Military transport conversion',
  'Medevac and air ambulance',
  'Aerial survey and special missions',
  'Check airman and line training',
  'Simulator instructor qualification',
  'Cold weather and arctic operations',
  'Overwater emergency procedures specialist',
  'Reduced vertical separation minimum (RVSM) operations',
  'Advanced avionics (glass cockpit) specialist',
  'Commuter / high-frequency short-sector operations',
  'Low-level tactical flying background',
  'Ferry and delivery flights (international)',
  'Fire suppression air tanker background',
  'Maritime patrol adaptation',
  'Selective calling (SELCAL) and HF communications specialist'
];

const CAPTAIN_PROCEDURE_STYLES = [
  'By the book — strict SOP adherence',
  'Methodical — thorough, no shortcuts',
  'Efficient — SOP-compliant but time-aware',
  'Old school — technique-based, high manual-flying preference',
  'Glass-pit native — automation-forward',
  'Crew-centric — heavy CRM emphasis',
  'Data-driven — cross-checks everything',
  'Safety-first — conservative decision margins',
  'Adaptive — adjusts style to conditions',
  'Mentoring style — explains decisions to FO',
  'Quiet professional — minimal verbosity, maximum precision',
  'Proactive briefer — front-loads all information',
  'Checklist guardian — never skips, never rushes',
  'Situational awareness focused — always ahead of the aircraft',
  'Communication-heavy — keeps crew well informed',
  'Minimalist — only says what\'s needed',
  'Risk-manager — explicit go/no-go criteria',
  'High-autonomy — trusts FO, delegates fully',
  'Assertive — takes control early in abnormals',
  'Collaborative — consensus-based decision making'
];

const CAPTAIN_PERSONALITY_STYLES = [
  'Professional and composed',
  'Warm but authoritative',
  'Direct and no-nonsense',
  'Thoughtful and deliberate',
  'Quietly confident',
  'Personable and approachable',
  'Firm but fair',
  'Reserved and focused',
  'Inspirational — leads by example',
  'Deadpan humor, dry wit',
  'Formal — strictly professional',
  'Energetic and enthusiastic',
  'Steady and reassuring',
  'Stoic under pressure',
  'Analytical — processes before speaking',
  'Naturally curious — asks good questions',
  'Experienced storyteller — uses examples from career',
  'Tactical — always focused on the next step',
  'Patient mentor',
  'Efficient communicator — brief and clear',
  'Slightly old-fashioned — prefers manual flying',
  'Optimist — always finds a path forward',
  'Detail-oriented perfectionist',
  'Protective of the crew',
  'Humble — credits the team'
];

const COMMUNICATION_PREFERENCES = [
  'Formal standard phraseology',
  'Structured with clear callouts',
  'Concise, information-dense',
  'Warm but precise',
  'Military-influenced, clipped',
  'Conversational in cruise, formal on approach',
  'Narrative-style briefings',
  'Bullet-point style, no rambling',
  'Check-in and acknowledge style',
  'Prefers written/ACARS for non-urgent items',
  'Proactive — announces intentions early',
  'Collaborative — invites FO input',
  'Decisive — no ambiguity in callouts',
  'Safety-focused phrasing',
  'Standardized across all phases of flight',
  'Adapts tone to workload level',
  'Calm monotone, professional',
  'Assertive in high-workload, relaxed in cruise',
  'Clear and deliberate — never rushed',
  'Minimal chatter — conserves radio time'
];

const FO_PERSONALITY_STYLES = [
  'Eager and detail-focused',
  'Quietly competent',
  'Proactive on callouts',
  'Reserved but reliable',
  'By-the-book, consistent',
  'Friendly — easy rapport with captain',
  'Slightly deferential by rank, confident in knowledge',
  'Technically sharp — systems expert',
  'Dry humor during cruise',
  'Asks good clarifying questions',
  'New to the type — extra careful',
  'Experienced — confident contributor',
  'Trivia buff — shares facts during cruise',
  'Weather-focused — always checks conditions',
  'Fuel monitor — tracks consumption carefully',
  'Checklist-first mentality',
  'Conversational and warm in cruise',
  'Formal and precise during procedures',
  'Situationally aware — catches things early',
  'Team player — backs up captain fully',
  'Safety advocate — willing to speak up',
  'Efficient — keeps things moving',
  'Methodical — no step skipped',
  'Diplomatic — handles disagreements well',
  'Enthusiastic about aviation history and aircraft'
];

const FO_SPECIALTIES = [
  'Regional jet background',
  'Turboprop multi-engine',
  'General aviation cross-country',
  'Instructing background — PPL/IR',
  'Military flight school',
  'Desert/hot-and-high operations',
  'Coastal and overwater',
  'Freight and cargo operation',
  'Sim-heavy training, low flight hours',
  'Corporate/charter transitions',
  'Island and remote strip operations',
  'High-density traffic environment (major hub)',
  'International oceanic sectors',
  'Night freight specialist',
  'Mountain and terrain awareness',
  'Instrument flight only — low VFR experience',
  'Emergency procedures specialist',
  'CRM facilitator background',
  'Fuel planning and dispatch cross-trained',
  'Weather avoidance specialist',
  'Long-haul fatigue management trained',
  'Type rating just completed — new to line',
  'Accelerated upgrade program graduate',
  'Airline cadet program direct entry',
  'University aviation degree — systems focus'
];

const FA_SERVICE_STYLES = [
  'Premium cabin — formal and attentive',
  'Warm and welcoming — hospitality-first',
  'Efficient — fast service, minimal fuss',
  'Safety-first — procedures before service',
  'Luxury-trained — anticipates every need',
  'Island hospitality style — relaxed and friendly',
  'Corporate charter — VIP service standard',
  'High-energy — upbeat and positive',
  'Calm and reassuring — particularly good with nervous flyers',
  'Professional minimalist — visible only when needed',
  'Storytelling style — engages passengers with context',
  'Children-friendly — warm with families',
  'Medically trained — calm in emergencies',
  'Multilingual service — adapts to passenger language',
  'High-frequency shuttle style — fast turnaround cadence',
  'Formal airline tradition — structured announcements',
  'Modern casual — approachable and genuine',
  'Galley-focused — strong on food service quality',
  'Safety-briefing perfectionist — every word right',
  'Passenger advocate — goes above and beyond',
  'Silent service — reads the cabin, responds proactively',
  'Experienced charters — handles unusual requests smoothly',
  'Military background — precise and dependable',
  'Customer relations trained — handles complaints gracefully',
  'Long-haul specialist — manages fatigue and service cadence'
];

const FA_SPECIALTIES = [
  'International service, premium cabin management',
  'Galley operations and beverage service',
  'Passenger relations and conflict resolution',
  'Emergency procedures and first aid',
  'Special needs passenger assistance',
  'Children and unaccompanied minor care',
  'VIP and charter service',
  'Safety demonstration and compliance',
  'Crew coordination and communication',
  'Medical in-flight response',
  'Long-haul fatigue management',
  'Cultural and language diversity',
  'Food service and dietary accommodation',
  'Security screening awareness',
  'Boarding and deplaning efficiency',
  'Dangerous goods awareness',
  'Fire suppression and evacuation procedures',
  'CRM and crew communication',
  'Island route hospitality culture',
  'High-density cabin management'
];

const PILOT_CERTIFICATIONS = [
  'ATPL (Airline Transport Pilot License)',
  'CPL (Commercial Pilot License)',
  'Instrument Rating (IR) current',
  'Multi-engine rating (ME)',
  'Type rating — Boeing 737 family',
  'Type rating — Airbus A320 family',
  'Type rating — Bombardier CRJ series',
  'Type rating — ATR 72',
  'Type rating — Beech 1900 / King Air',
  'LOFT (Line-Oriented Flight Training) current',
  'CRM (Crew Resource Management) current',
  'Extended Operations (ETOPS/EROPS) qualified',
  'RVSM (Reduced Vertical Separation) qualified',
  'CAT III (Low Visibility Operations) current',
  'Oceanic procedures qualified',
  'MNPS (Minimum Navigation Performance Specifications)',
  'Mountain and high-altitude endorsement',
  'Night rating (NR)',
  'Upset Prevention and Recovery Training (UPRT)',
  'Dangerous goods awareness trained',
  'EFB (Electronic Flight Bag) qualified',
  'Check airman authorized',
  'Simulator instructor (SIM-I) qualified',
  'Line check airman',
  'ACAS/TCAS resolution advisory trained'
];

const FA_CERTIFICATIONS = [
  'CRM trained',
  'Safety demonstration current',
  'First aid / CPR certified',
  'Dangerous goods awareness (IATA)',
  'Emergency procedures qualified',
  'Defibrillator (AED) trained',
  'Special assistance (reduced mobility) trained',
  'Galley safety certified',
  'Security awareness training',
  'Fire and smoke procedures qualified',
  'Evacuation drill current',
  'Child seat installation certified',
  'Unaccompanied minor escort trained',
  'Crowd management certified',
  'In-flight medical response trained'
];

// Captain crew interaction pool (fed to copilot_data)
const CAPTAIN_CREW_INTERACTIONS = [
  'Empowers FO with full authority on normal operations',
  'Encourages open communication — speaks up early',
  'Clear on role boundaries; collaborative in grey areas',
  'Runs tight briefs; expects FO to be fully prepared',
  'Calm under pressure; models composure for crew',
  'Welcomes challenge and alternate viewpoints',
  'Builds team rapport in cruise, formal on approach',
  'Delegates non-critical tasks freely to FO',
  'Maintains clear CRM structure from boarding to parking',
  'High situation-sharing; verbalizes intentions proactively'
];

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Pick n unique items from a pool
 * @param {string[]} pool - Source array
 * @param {number} n - Number of items to select
 * @returns {string[]}
 */
function pickN(pool, n) {
  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(n, pool.length));
}

/**
 * Pick a single random item from a pool
 * @param {string[]} pool
 * @returns {string}
 */
function pickOne(pool) {
  return pool[Math.floor(Math.random() * pool.length)];
}

/**
 * Convert OA flight hours to a named experience level
 * @param {number} hours
 * @param {string} role - 'Captain' | 'First Officer' | 'Flight Attendant'
 * @returns {string}
 */
function hoursToExperienceLevel(hours, role) {
  if (role === 'Flight Attendant') {
    if (hours < 500) return 'Junior Flight Attendant';
    if (hours < 2000) return 'Flight Attendant';
    if (hours < 5000) return 'Senior Flight Attendant';
    return 'Lead Cabin Crew';
  }
  // Pilot (Captain or First Officer)
  if (hours < 100) return 'New Hire';
  if (hours < 500) return 'Junior First Officer';
  if (hours < 1500) return 'First Officer';
  if (hours < 3000) return 'Senior First Officer';
  if (hours < 5000) return 'Line Captain';
  if (hours < 8000) return 'Captain';
  if (hours < 12000) return 'Senior Captain';
  return 'Chief Pilot / Senior Check Captain';
}

/**
 * Generate a randomized crew personality profile
 * @param {string} role - 'Captain' | 'First Officer' | 'Flight Attendant'
 * @param {number} oaHours - Total OA flight hours
 * @param {number} oaFlights - Total OA flights / landings
 * @param {string} oaName - Display name from OA
 * @param {string} [crewId] - Crew ID (UUID or 'my-pilot')
 * @param {string} [companyId] - OA Company ID
 * @returns {Object} Full profile matching the target schema
 */
function generateProfile(role, oaHours, oaFlights, oaName, crewId = '', companyId = '') {
  const now = new Date().toISOString();
  const experienceLevel = hoursToExperienceLevel(oaHours, role);

  const base = {
    peopleId: crewId,
    name: oaName,
    role: role,
    isUserProfile: crewId === 'my-pilot',
    oa: {
      hours: oaHours,
      flights: oaFlights,
      companyId: companyId
    },
    customNotes: '',
    siApiKey: null,
    lastUpdated: now,
    createdAt: now
  };

  if (role === 'Captain') {
    return {
      ...base,
      background: {
        flightHours: oaHours,
        experienceLevel,
        specialty: pickOne(CAPTAIN_SPECIALTIES),
        certifications: pickN(PILOT_CERTIFICATIONS, 3)
      },
      personality: {
        style: pickOne(CAPTAIN_PERSONALITY_STYLES),
        communicationPreference: pickOne(COMMUNICATION_PREFERENCES)
      },
      operationalPreferences: {
        procedureStyle: pickOne(CAPTAIN_PROCEDURE_STYLES),
        crewInteraction: pickOne(CAPTAIN_CREW_INTERACTIONS)
      }
    };
  }

  if (role === 'First Officer') {
    return {
      ...base,
      background: {
        flightHours: oaHours,
        experienceLevel,
        specialty: pickOne(FO_SPECIALTIES),
        certifications: pickN(PILOT_CERTIFICATIONS, 3)
      },
      personality: {
        style: pickOne(FO_PERSONALITY_STYLES),
        communicationPreference: pickOne(COMMUNICATION_PREFERENCES)
      },
      operationalPreferences: {
        crewInteraction: pickOne(CAPTAIN_CREW_INTERACTIONS)
      }
    };
  }

  // Flight Attendant
  return {
    ...base,
    background: {
      flightHours: oaHours,
      experienceLevel,
      specialty: pickOne(FA_SPECIALTIES),
      certifications: pickN(FA_CERTIFICATIONS, 2)
    },
    cabinManagementPreferences: {
      serviceStyle: pickOne(FA_SERVICE_STYLES),
      passengerAnnouncements: 'Standard safety announcements with warm delivery'
    }
  };
}

module.exports = {
  generateProfile,
  hoursToExperienceLevel,
  pickN,
  pickOne,
  POOLS: {
    CAPTAIN_SPECIALTIES,
    CAPTAIN_PROCEDURE_STYLES,
    CAPTAIN_PERSONALITY_STYLES,
    COMMUNICATION_PREFERENCES,
    FO_PERSONALITY_STYLES,
    FO_SPECIALTIES,
    FA_SERVICE_STYLES,
    FA_SPECIALTIES,
    PILOT_CERTIFICATIONS,
    FA_CERTIFICATIONS,
    CAPTAIN_CREW_INTERACTIONS
  }
};
