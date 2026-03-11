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
 * Match cargo and charter items for a flight by MissionId, with fallback to route matching
 * @param {Object} flight - Flight object
 * @param {Array} jobs - Array of job objects
 * @param {string} depIcao - Departure ICAO
 * @param {string} arrIcao - Arrival ICAO
 * @returns {Object} { cargos: [], charters: [] }
 */
function matchCargoCharter(flight, jobs, depIcao, arrIcao) {
  let matchedCargos = [];
  let matchedCharters = [];
  const flightId = flight.Id;

  // Primary: Try MissionId matching
  jobs.forEach(job => {
    if (job.Cargos && Array.isArray(job.Cargos)) {
      job.Cargos.forEach(cargo => {
        if (cargo.MissionId === flightId) {
          matchedCargos.push(formatCargo(cargo));
        }
      });
    }

    if (job.Charters && Array.isArray(job.Charters)) {
      job.Charters.forEach(charter => {
        if (charter.MissionId === flightId) {
          matchedCharters.push(formatCharter(charter));
        }
      });
    }
  });

  // Fallback: Route matching if MissionId yielded nothing
  if (matchedCargos.length === 0 && matchedCharters.length === 0) {
    jobs.forEach(job => {
      if (job.Cargos && Array.isArray(job.Cargos)) {
        job.Cargos.forEach(cargo => {
          // Handle both object and string airport formats
          const cargoFrom = (typeof cargo.DepartureAirport === 'string') 
            ? cargo.DepartureAirport 
            : cargo.DepartureAirport?.ICAO;
          const cargoTo = (typeof cargo.DestinationAirport === 'string')
            ? cargo.DestinationAirport
            : cargo.DestinationAirport?.ICAO;
          
          if (cargoFrom?.toUpperCase() === depIcao && cargoTo?.toUpperCase() === arrIcao) {
            matchedCargos.push(formatCargo(cargo));
          }
        });
      }

      if (job.Charters && Array.isArray(job.Charters)) {
        job.Charters.forEach(charter => {
          // Handle both object and string airport formats
          const charterFrom = (typeof charter.DepartureAirport === 'string')
            ? charter.DepartureAirport
            : charter.DepartureAirport?.ICAO;
          const charterTo = (typeof charter.DestinationAirport === 'string')
            ? charter.DestinationAirport
            : charter.DestinationAirport?.ICAO;
          
          if (charterFrom?.toUpperCase() === depIcao && charterTo?.toUpperCase() === arrIcao) {
            matchedCharters.push(formatCharter(charter));
          }
        });
      }
    });
  }

  return { cargos: matchedCargos, charters: matchedCharters };
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
    missionId: cargo.MissionId?.substring(0, 8)
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
    from: from || '?',
    to: to || '?',
    missionId: charter.MissionId?.substring(0, 8)
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
  const { cargos, charters } = matchCargoCharter(
    flight,
    allJobs,
    depIcao.toUpperCase(),
    arrIcao.toUpperCase()
  );

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
    
    // DEBUG: Check if ANY items match target route
    const targetRouteCargos = allCargos.filter(c => c.DestinationAirport?.ICAO === arrIcao);
    const targetRouteCharters = allCharters.filter(ch => ch.DestinationAirport?.ICAO === arrIcao);
    console.log(`[cargoCharterService] Items with destination ${arrIcao}: ${targetRouteCargos.length} cargos + ${targetRouteCharters.length} charters`);
    
    if (targetRouteCargos.length === 0 && targetRouteCharters.length === 0) {
      // Check what destinations ARE available
      const uniqueDestinations = new Set();
      allCargos.forEach(c => {
        if (c.DestinationAirport?.ICAO) uniqueDestinations.add(c.DestinationAirport.ICAO);
      });
      allCharters.forEach(ch => {
        if (ch.DestinationAirport?.ICAO) uniqueDestinations.add(ch.DestinationAirport.ICAO);
      });
      console.log(`[cargoCharterService] Available destinations: ${Array.from(uniqueDestinations).join(', ')}`);
    }

    // PRIMARY: Try to match by MissionId
    let matchedCargos = allCargos.filter(c => c.MissionId === flight.Id);
    let matchedCharters = allCharters.filter(ch => ch.MissionId === flight.Id);

    console.log(`[cargoCharterService] MissionId matches: ${matchedCargos.length} cargos, ${matchedCharters.length} charters`);

    // FALLBACK: If no MissionId matches, try multiple strategies
    if (matchedCargos.length === 0 && matchedCharters.length === 0) {
      console.log(`[cargoCharterService] No MissionId matches, trying fallback strategies...`);
      
      // Strategy 1: Match by full route (departure AND destination)
      let strategyMatches = allCargos.filter(c => {
        const cDep = c.DepartureAirport?.ICAO || c.DepartureAirport;
        const cArr = c.DestinationAirport?.ICAO || c.DestinationAirport;
        return cDep === depIcao && cArr === arrIcao;
      });
      console.log(`[cargoCharterService] Strategy 1 (full route match): ${strategyMatches.length} cargos`);
      matchedCargos.push(...strategyMatches);
      
      strategyMatches = allCharters.filter(ch => {
        const chDep = ch.DepartureAirport?.ICAO || ch.DepartureAirport;
        const chArr = ch.DestinationAirport?.ICAO || ch.DestinationAirport;
        return chDep === depIcao && chArr === arrIcao;
      });
      console.log(`[cargoCharterService] Strategy 1 (full route match): ${strategyMatches.length} charters`);
      matchedCharters.push(...strategyMatches);
      
      // Strategy 2: Match by destination only (items going TO this airport, any source)
      if (matchedCargos.length === 0) {
        strategyMatches = allCargos.filter(c => (c.DestinationAirport?.ICAO || c.DestinationAirport) === arrIcao);
        console.log(`[cargoCharterService] Strategy 2 (dest only): ${strategyMatches.length} cargos ending at ${arrIcao}`);
        matchedCargos.push(...strategyMatches);
      }
      
      if (matchedCharters.length === 0) {
        strategyMatches = allCharters.filter(ch => (ch.DestinationAirport?.ICAO || ch.DestinationAirport) === arrIcao);
        console.log(`[cargoCharterService] Strategy 2 (dest only): ${strategyMatches.length} charters ending at ${arrIcao}`);
        matchedCharters.push(...strategyMatches);
      }
      
      // Strategy 3: Match by departure only (items FROM this airport, any destination)
      if (matchedCargos.length === 0) {
        strategyMatches = allCargos.filter(c => (c.DepartureAirport?.ICAO || c.DepartureAirport) === depIcao);
        console.log(`[cargoCharterService] Strategy 3 (departure only): ${strategyMatches.length} cargos from ${depIcao}`);
        matchedCargos.push(...strategyMatches);
      }
      
      if (matchedCharters.length === 0) {
        strategyMatches = allCharters.filter(ch => (ch.DepartureAirport?.ICAO || ch.DepartureAirport) === depIcao);
        console.log(`[cargoCharterService] Strategy 3 (departure only): ${strategyMatches.length} charters from ${depIcao}`);
        matchedCharters.push(...strategyMatches);
      }
    }

    // Format and return results
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
