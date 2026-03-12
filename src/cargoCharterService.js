/**
 * Cargo & Charter Matching Service
 * 
 * Matches active flights from OnAir to their cargo and charter descriptions.
 * Flights contain weight/passenger counts but not descriptions.
 * Descriptions live in the Jobs API and are linked by airport route.
 * 
 * Usage:
 *   const result = await matchCargoCharterForFlight(
 *     { ICAO: "LQSA" },  // departure airport
 *     { ICAO: "LEBB" },  // arrival airport
 *     credentials
 *   );
 */

const https = require('https');

/**
 * Make authenticated API call to OnAir
 * @param {string} endpoint - API endpoint path
 * @param {string} apiKey - OnAir API key
 * @returns {Promise<Object>} Parsed JSON response
 */
function apiCall(endpoint, apiKey) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'server1.onair.company',
      path: `/api/v1${endpoint}`,
      method: 'GET',
      headers: {
        'oa-apikey': apiKey,
        'Content-Type': 'application/json'
      }
    };

    https.get(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (err) {
          reject(new Error(`Failed to parse response: ${err.message}`));
        }
      });
    }).on('error', reject);
  });
}

/**
 * Find a flight matching the given route in company or VA flights
 * @param {string} depIcao - Departure airport ICAO code
 * @param {string} arrIcao - Arrival airport ICAO code
 * @param {string} companyId - Company ID
 * @param {string} companyApiKey - Company API key
 * @param {string} vaId - VA ID
 * @param {string} vaApiKey - VA API key
 * @returns {Promise<Object>} Flight object or null
 */
async function findFlightByRoute(depIcao, arrIcao, companyId, companyApiKey, vaId, vaApiKey) {
  let matches = [];
  let selectedId = null;
  let selectedApiKey = null;

  // Try company flights first
  try {
    const res = await apiCall(`/company/${companyId}/flights?limit=50&sort=desc`, companyApiKey);
    const flights = res.Content || [];
    matches = flights.filter(f => 
      f.DepartureAirport?.ICAO === depIcao && 
      f.ArrivalIntendedAirport?.ICAO === arrIcao
    );
    
    if (matches.length > 0) {
      selectedId = companyId;
      selectedApiKey = companyApiKey;
    }
  } catch (err) {
    console.error('[cargoCharterService] Company flights error:', err.message);
  }

  // Try VA flights if not found in company
  if (matches.length === 0) {
    try {
      const res = await apiCall(`/company/${vaId}/flights?limit=50&sort=desc`, vaApiKey);
      const flights = res.Content || [];
      matches = flights.filter(f => 
        f.DepartureAirport?.ICAO === depIcao && 
        f.ArrivalIntendedAirport?.ICAO === arrIcao
      );
      
      if (matches.length > 0) {
        selectedId = vaId;
        selectedApiKey = vaApiKey;
      }
    } catch (err) {
      console.error('[cargoCharterService] VA flights error:', err.message);
    }
  }

  if (matches.length === 0) {
    return null;
  }

  // Pick one with actual payload, or first match
  const selectedFlight = matches.find(f => f.Passengers > 0 || f.Cargo > 0) || matches[0];

  return {
    flight: selectedFlight,
    id: selectedId,
    apiKey: selectedApiKey
  };
}

/**
 * Match cargo and charter items for a flight by CurrentAircraftId.
 * Cargo/charters loaded on an aircraft have CurrentAircraftId set to that aircraft's ID.
 * @param {Object} flight - Flight object with AircraftId field
 * @param {Array} jobs - Array of job objects from the jobs API
 * @returns {Object} { cargos: [], charters: [] }
 */
function matchCargoCharter(flight, jobs) {
  const aircraftId = flight.AircraftId;
  const allCargos = jobs.flatMap(j => j.Cargos || []);
  const allCharters = jobs.flatMap(j => j.Charters || []);
  return {
    cargos: allCargos.filter(c => c.CurrentAircraftId === aircraftId).map(formatCargo),
    charters: allCharters.filter(c => c.CurrentAircraftId === aircraftId).map(formatCharter)
  };
}

/**
 * Format cargo item for output
 */
function formatCargo(cargo) {
  // Handle both string and object airport formats
  const from = (typeof cargo.DepartureAirport === 'string') 
    ? cargo.DepartureAirport 
    : cargo.DepartureAirport?.ICAO;
  const to = (typeof cargo.DestinationAirport === 'string')
    ? cargo.DestinationAirport
    : cargo.DestinationAirport?.ICAO;

  return {
    id: cargo.Id,
    description: cargo.Description,
    type: cargo.CargoType?.Name || 'Unknown',
    weight: cargo.Weight,
    from: from || '?',
    to: to || '?',
    missionId: cargo.MissionId
  };
}

/**
 * Format charter item for output
 */
function formatCharter(charter) {
  // Handle both string and object airport formats
  const from = (typeof charter.DepartureAirport === 'string')
    ? charter.DepartureAirport
    : charter.DepartureAirport?.ICAO;
  const to = (typeof charter.DestinationAirport === 'string')
    ? charter.DestinationAirport
    : charter.DestinationAirport?.ICAO;

  return {
    id: charter.Id,
    description: charter.Description,
    type: charter.CharterType?.Name || 'Unknown',
    passengers: charter.PassengersNumber,
    cabinClass: ['Eco', 'Business', 'First'][charter.MinPAXSeatConf] || 'Eco',
    from: from || '?',
    to: to || '?',
    missionId: charter.MissionId
  };
}

/**
 * Main function: Match active flight to cargo/charter descriptions
 * @param {string} depIcao - Departure airport ICAO
 * @param {string} arrIcao - Arrival airport ICAO
 * @param {Object} credentials - { ONAIR_COMPANY_ID, ONAIR_COMPANY_API_KEY, ONAIR_VA_ID, ONAIR_VA_API_KEY }
 * @returns {Promise<Object>} { flight, cargos, charters, source }
 */
async function matchCargoCharterForFlight(depIcao, arrIcao, credentials) {
  // Validate credentials
  if (!credentials.ONAIR_COMPANY_ID || !credentials.ONAIR_COMPANY_API_KEY ||
      !credentials.ONAIR_VA_ID || !credentials.ONAIR_VA_API_KEY) {
    throw new Error('Missing required credentials: ONAIR_COMPANY_ID, ONAIR_COMPANY_API_KEY, ONAIR_VA_ID, ONAIR_VA_API_KEY');
  }

  // Find the flight
  const flightResult = await findFlightByRoute(
    depIcao.toUpperCase(),
    arrIcao.toUpperCase(),
    credentials.ONAIR_COMPANY_ID,
    credentials.ONAIR_COMPANY_API_KEY,
    credentials.ONAIR_VA_ID,
    credentials.ONAIR_VA_API_KEY
  );

  if (!flightResult) {
    throw new Error(`No flight found for route ${depIcao} → ${arrIcao}`);
  }

  const { flight, id: selectedId, apiKey: selectedApiKey } = flightResult;

  // Fetch pending and completed jobs
  const pendingRes = await apiCall(`/company/${selectedId}/jobs/pending`, selectedApiKey);
  const completedRes = await apiCall(`/company/${selectedId}/jobs/completed`, selectedApiKey);
  
  const allJobs = [...(pendingRes.Content || []), ...(completedRes.Content || [])];

  // Match cargo and charters
  const { cargos, charters } = matchCargoCharter(flight, allJobs);

  return {
    flight: {
      id: flight.Id,
      from: depIcao.toUpperCase(),
      to: arrIcao.toUpperCase(),
      passengers: flight.Passengers,
      cargoWeight: flight.Cargo,
      status: flight.RegisterState
    },
    cargos,
    charters,
    source: selectedId === credentials.ONAIR_COMPANY_ID ? 'COMPANY' : 'VA'
  };
}

/**
 * Match cargo and charter items for an active flight
 * Uses Jobs API with BOTH MissionId matching and route-based fallback
 * 
 * @param {Object} flight - Active flight object from OnAir with Id, DepartureAirport, ArrivalIntendedAirport
 * @param {Object} credentials - { ONAIR_COMPANY_ID, ONAIR_COMPANY_API_KEY, ONAIR_VA_ID, ONAIR_VA_API_KEY }
 * @returns {Promise<Object>} { cargos, charters, source }
 */
async function matchCargoCharterForActiveFlight(flight, credentials) {
  if (!flight || !flight.Id) {
    return { cargos: [], charters: [], source: 'ERROR' };
  }

  try {
    // Extract airport ICAOs
    const depIcao = flight.DepartureAirport?.ICAO || flight.DepartureAirport;
    const arrIcao = flight.ArrivalIntendedAirport?.ICAO || flight.ArrivalIntendedAirport;

    if (!depIcao || !arrIcao) {
      console.log(`[cargoCharterService] ⚠️ Flight missing airport data for ID: ${flight.Id}`);
      return { cargos: [], charters: [], source: 'NONE' };
    }

    console.log(`[cargoCharterService] ▶ Matching cargo/charter for flight ${flight.Id} (${depIcao}→${arrIcao})`);

    // Determine which credentials to use (company preferred, fallback to VA)
    let selectedId = credentials.ONAIR_COMPANY_ID;
    let selectedApiKey = credentials.ONAIR_COMPANY_API_KEY;
    let source = 'COMPANY';

    // Try company first, fallback to VA if needed
    let jobs = [];
    try {
      const pendingRes = await apiCall(`/company/${selectedId}/jobs/pending`, selectedApiKey);
      const completedRes = await apiCall(`/company/${selectedId}/jobs/completed`, selectedApiKey);
      jobs = [...(pendingRes.Content || []), ...(completedRes.Content || [])];
      console.log(`[cargoCharterService] ✓ Loaded ${jobs.length} jobs from COMPANY`);
    } catch (err) {
      // Fall back to VA
      if (credentials.ONAIR_VA_ID && credentials.ONAIR_VA_API_KEY) {
        console.log(`[cargoCharterService] COMPANY jobs failed, trying VA...`);
        selectedId = credentials.ONAIR_VA_ID;
        selectedApiKey = credentials.ONAIR_VA_API_KEY;
        source = 'VA';
        
        const pendingRes = await apiCall(`/company/${selectedId}/jobs/pending`, selectedApiKey);
        const completedRes = await apiCall(`/company/${selectedId}/jobs/completed`, selectedApiKey);
        jobs = [...(pendingRes.Content || []), ...(completedRes.Content || [])];
        console.log(`[cargoCharterService] ✓ Loaded ${jobs.length} jobs from VA`);
      } else {
        throw err;
      }
    }

    // Extract all cargos and charters from jobs
    const allCargos = [];
    const allCharters = [];

    jobs.forEach(job => {
      if (job.Cargos && Array.isArray(job.Cargos)) {
        allCargos.push(...job.Cargos);
      }
      if (job.Charters && Array.isArray(job.Charters)) {
        allCharters.push(...job.Charters);
      }
    });

    console.log(`[cargoCharterService] Total items in jobs: ${allCargos.length} cargos + ${allCharters.length} charters`);

    // Match by CurrentAircraftId - cargo/charters currently loaded on our aircraft
    const matchedCargos = allCargos.filter(c => c.CurrentAircraftId === flight.AircraftId);
    const matchedCharters = allCharters.filter(ch => ch.CurrentAircraftId === flight.AircraftId);

    console.log(`[cargoCharterService] Aircraft matches: ${matchedCargos.length} cargos, ${matchedCharters.length} charters`);

    const formattedCargos = matchedCargos.map(c => formatCargo(c));
    const formattedCharters = matchedCharters.map(ch => formatCharter(ch));

    console.log(`[cargoCharterService] ✓ RESULT: ${formattedCargos.length} cargos, ${formattedCharters.length} charters from ${source}`);

    return {
      cargos: formattedCargos,
      charters: formattedCharters,
      source
    };
  } catch (error) {
    console.error(`[cargoCharterService] ✗ ERROR: ${error.message}`);
    return {
      cargos: [],
      charters: [],
      source: 'ERROR'
    };
  }
}

module.exports = {
  matchCargoCharterForFlight,
  matchCargoCharterForActiveFlight,
  findFlightByRoute,
  matchCargoCharter,
  apiCall
};
