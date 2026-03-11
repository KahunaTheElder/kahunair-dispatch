const axios = require('axios');

/**
 * FlightDetectionService
 * Handles flight detection with pagination, pilot filtering, and caching
 */

class FlightDetectionService {
  constructor(config = {}) {
    this.apiUrl = config.apiUrl || 'https://server1.onair.company/api/v1';
    this.companyId = config.companyId;
    this.apiKey = config.apiKey;
    this.maxRetries = config.maxRetries || 3;
    this.pageLimit = config.pageLimit || 4; // Fetch only 3-4 most recent flights
    this.cache = new Map();
    this.cacheTTL = config.cacheTTL || 30000; // 30 seconds

    // Kahuna company ID for pilot filtering
    this.kahunaCompanyId = '5597c4b6-8f0b-4bbd-a13e-42f8a6e04026';
  }

  /**
   * Update credentials at runtime
   * Called when user saves new credentials through the UI
   */
  updateCredentials(companyId, apiKey) {
    console.log('[FlightDetectionService] Updating credentials');
    this.companyId = companyId;
    this.apiKey = apiKey;
    // Clear cache when credentials change
    this.cache.clear();
    console.log('[FlightDetectionService] Credentials updated and cache cleared');
  }

  /**
   * Check if a flight has Kahuna as a crew member
   */
  isKahunaFlight(flight) {
    return flight.FlightCrews?.some(
      crew => crew.People?.CompanyId === this.kahunaCompanyId
    ) ?? false;
  }

  /**
   * Check if a flight is currently active (in progress)
   */
  isActiveStatus(flight) {
    return !!(flight.StartTime || flight.EngineOnTime || flight.AirborneTime);
  }

  /**
   * Get the current flight phase
   * Returns 'AIRBORNE' if actually flying, otherwise 'GROUND'
   */
  getFlightPhase(flight) {
    return flight.AirborneTime ? 'AIRBORNE' : 'GROUND';
  }

  /**
   * Extract SayIntentions pilot key from flight crew data
   */
  getSayIntentionsKey(flight) {
    const firstCrew = flight.FlightCrews?.[0];
    return firstCrew?.People?.Company?.SayIntentionsPilotKey || null;
  }

  /**
   * Get all Kahuna flights - optimized to fetch only 3-4 most recent
   */
  async getAllKahunaFlights() {
    const startTime = Date.now();
    const cacheKey = `all_kahuna_flights_${this.companyId}`;
    const cached = this.cache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
      console.log(`[FlightDetection] Returning cached flights (${cached.data.length} items)`);
      return cached.data;
    }

    try {
      console.log('[FlightDetection] Cache miss or expired, fetching fresh flights...');
      // Fetch only first page with 4 items (most recent flights)
      const flights = await this.fetchFlightsPage(1);
      const fetchDuration = Date.now() - startTime;
      console.log(`[FlightDetection] fetchFlightsPage completed in ${fetchDuration}ms, got ${flights?.length || 0} flights`);

      if (!flights || flights.length === 0) {
        return [];
      }

      // Filter for Kahuna flights
      const kahunaFlights = flights.filter(f => this.isKahunaFlight(f));
      const totalDuration = Date.now() - startTime;
      console.log(`[FlightDetection] getAllKahunaFlights completed in ${totalDuration}ms, ${kahunaFlights.length} are Kahuna flights`);

      // Cache results
      this.cache.set(cacheKey, {
        data: kahunaFlights,
        timestamp: Date.now()
      });

      return kahunaFlights;
    } catch (error) {
      const errorDuration = Date.now() - startTime;
      // On error, return stale cache if available (graceful degradation)
      // This prevents timeouts and keeps the app responsive
      if (cached) {
        console.warn(`[FlightDetection] Flight fetch failed after ${errorDuration}ms, returning stale cached data (${cached.data.length} items): ${error.message}`);
        return cached.data;
      }
      // If no cache available, return empty list instead of crashing
      console.error(`[FlightDetection] Error fetching Kahuna flights after ${errorDuration}ms and no cache available: ${error.message}`);
      return [];
    }
  }

  /**
   * Get active Kahuna flights only
   */
  async getActiveKahunaFlights() {
    const flights = await this.getAllKahunaFlights();
    return flights.filter(f => this.isActiveStatus(f));
  }

  /**
   * Get the CURRENT active flight from OnAir's /current endpoint
   * This is the flight currently being flown, not just any active flight
   * Much more reliable than searching through recent flights
   */
  async getCurrentActiveFlight() {
    const startTime = Date.now();
    try {
      console.log('[FlightDetection] Fetching CURRENT active flight from OnAir...');
      const response = await axios.get(
        `${this.apiUrl}/company/${this.companyId}/current`,
        {
          headers: {
            'oa-apikey': this.apiKey
          },
          timeout: 5000
        }
      );

      const flight = response.data?.Content?.[0];
      const duration = Date.now() - startTime;

      if (!flight) {
        console.log(`[FlightDetection] No current flight found after ${duration}ms`);
        return null;
      }

      console.log(`[FlightDetection] Got current flight ID: ${flight.Id} (${duration}ms)`);
      console.log(`[FlightDetection] Current flight: ${flight.DepartureAirport?.ICAO || flight.DepartureAirport} → ${flight.ArrivalIntendedAirport?.ICAO || flight.ArrivalIntendedAirport}`);

      return flight;
    } catch (error) {
      const duration = Date.now() - startTime;
      console.error(`[FlightDetection] Error fetching current flight after ${duration}ms: ${error.message}`);
      return null;
    }
  }

  /**
   * Fetch a single page of flights
   * Fast fail strategy: timeout quickly, don't retry aggressively
   */
  async fetchFlightsPage(page = 1) {
    let retries = 0;
    const MAX_RETRIES = 1; // Quick fail - we have cache fallback
    const pageStartTime = Date.now();

    while (retries < MAX_RETRIES) {
      try {
        const requestStart = Date.now();
        console.log(`[FlightDetection] Starting OnAir API request at ${requestStart}`);

        const response = await axios.get(
          `${this.apiUrl}/company/${this.companyId}/flights`,
          {
            headers: {
              'oa-apikey': this.apiKey
            },
            params: {
              page,
              limit: this.pageLimit
            },
            timeout: 5000 // 5 second timeout (reduced from 10s)
          }
        );

        const requestDuration = Date.now() - requestStart;
        console.log(`[FlightDetection] OnAir API request succeeded in ${requestDuration}ms`);

        // API returns flights in 'Content' array
        return response.data?.Content || [];
      } catch (error) {
        const errorDuration = Date.now() - pageStartTime;
        console.error(`[FlightDetection] OnAir API request failed after ${errorDuration}ms: ${error.message}`);
        retries++;
        if (retries >= MAX_RETRIES) {
          // Fail fast, don't retry
          throw new Error(`OnAir API request failed: ${error.message}`);
        }
      }
    }
  }

  /**
   * Get a specific flight by ID
   */
  async getActiveFlight(flightId) {
    try {
      const flights = await this.getAllKahunaFlights();
      // Search through all flights for the matching ID
      const flight = flights.find(f => f.Id === flightId);
      return flight || null;
    } catch (error) {
      console.error(`Error getting flight ${flightId}:`, error.message);
      throw error;
    }
  }

  /**
   * Get the most recent active Kahuna flight
   */
  async getMostRecentActiveFlight() {
    const flights = await this.getActiveKahunaFlights();
    return flights.length > 0 ? flights[0] : null;
  }

  /**
   * Get flight summary for dispatch
   */
  async getDispatchSummary() {
    try {
      const allFlights = await this.getAllKahunaFlights();
      const activeFlights = allFlights.filter(f => this.isActiveStatus(f));

      // Fetch jobs once for all flights (better performance than fetching per flight)
      const pendingJobs = await this.getCompanyJobs(false);
      console.log(`[DispatchSummary] Fetched ${pendingJobs.length} pending jobs`);

      // Build dispatch summary with cargo/passenger types
      const flights = [];
      for (const f of activeFlights) {
        // Extract ICAO codes from airport objects (they may be full objects or strings)
        const flightDeparture = typeof f.DepartureAirport === 'string'
          ? f.DepartureAirport
          : f.DepartureAirport?.ICAO;
        const flightArrival = typeof f.ArrivalIntendedAirport === 'string'
          ? f.ArrivalIntendedAirport
          : f.ArrivalIntendedAirport?.ICAO;

        // Find matching job for this flight
        let cargoTypes = [];
        let passengerTypes = [];
        let matchedJobId = null;

        if (pendingJobs.length > 0 && flightDeparture && flightArrival) {
          console.log(`[DispatchSummary] Looking for job match for flight ${flightDeparture}→${flightArrival}`);

          // Try to find a matching job by route (departure + arrival airports)
          let matchedJob = pendingJobs.find(job => {
            const jobDeparture = job.MainAirport?.ICAO;
            const jobArrival = job.BaseAirport?.ICAO;
            console.log(`[DispatchSummary]   Comparing: Job ${jobDeparture}→${jobArrival}`);
            return jobDeparture === flightDeparture && jobArrival === flightArrival;
          });

          // If no exact match, try reverse-direction match (for return leg flights)
          if (!matchedJob) {
            console.log(`[DispatchSummary] No exact match found, checking reverse direction...`);
            matchedJob = pendingJobs.find(job => {
              const jobDeparture = job.MainAirport?.ICAO;
              const jobArrival = job.BaseAirport?.ICAO;
              const isReverseMatch = jobDeparture === flightArrival && jobArrival === flightDeparture;
              if (isReverseMatch) {
                console.log(`[DispatchSummary]   Reverse match found: Job ${jobDeparture}→${jobArrival}`);
              }
              return isReverseMatch;
            });
          }

          if (matchedJob) {
            matchedJobId = matchedJob.Id;
            const types = this.extractCargoAndPassengerTypes(matchedJob);
            cargoTypes = types.cargoTypes;
            passengerTypes = types.passengerTypes;
            console.log(`[DispatchSummary] ✓ MATCH FOUND: Flight ${flightDeparture}→${flightArrival}`);
            console.log(`[DispatchSummary]   Cargo Types: ${JSON.stringify(cargoTypes)}`);
            console.log(`[DispatchSummary]   Passenger Types: ${JSON.stringify(passengerTypes)}`);
          } else {
            console.log(`[DispatchSummary] ✗ NO MATCH: Flight ${flightDeparture}→${flightArrival}`);
          }
        } else {
          if (pendingJobs.length === 0) {
            console.log(`[DispatchSummary] ℹ No pending jobs available for matching`);
          } else {
            console.log(`[DispatchSummary] ℹ Unable to extract airport codes for flight`);
          }
        }

        flights.push({
          id: f.Id,
          aircraft: {
            id: f.AircraftId,
            type: f.Aircraft?.AircraftType?.Name || 'Unknown'
          },
          route: {
            departure: flightDeparture,
            arrival: flightArrival
          },
          crew: {
            count: f.FlightCrews?.length || 0,
            kahuna: f.FlightCrews?.filter(c => c.People?.CompanyId === this.kahunaCompanyId).length || 0
          },
          payload: {
            passengers: f.PassengerCount || 0,
            cargo: f.CargoWeight || 0,
            cargoUoM: f.CargoWeightUoM || 'lbs',
            cargoTypes: cargoTypes,
            passengerTypes: passengerTypes
          },
          status: this.getFlightPhase(f),
          siKey: this.getSayIntentionsKey(f),
          matchedJobId: matchedJobId
        });
      }

      return {
        timestamp: new Date().toISOString(),
        totalKahunaFlights: allFlights.length,
        activeFlights: activeFlights.length,
        flights: flights
      };
    } catch (error) {
      console.error('Error getting dispatch summary:', error.message);
      throw error;
    }
  }

  /**
   * Fetch company jobs to identify cargo types and passenger categories
   * Returns both pending and completed jobs for matching
   */
  async getCompanyJobs(completed = false) {
    const startTime = Date.now();
    const statusPath = completed ? 'completed' : 'pending';
    const cacheKey = `company_jobs_${this.companyId}_${statusPath}`;
    const cached = this.cache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
      console.log(`[FlightDetection] Returning cached jobs (${cached.data.length} items)`);
      return cached.data;
    }

    try {
      console.log(`[FlightDetection] Fetching ${statusPath} jobs from OnAir API...`);

      const response = await axios.get(
        `${this.apiUrl}/company/${this.companyId}/jobs/${statusPath}`,
        {
          headers: {
            'oa-apikey': this.apiKey
          },
          timeout: 5000
        }
      );

      const jobs = response.data?.Content || [];
      const fetchDuration = Date.now() - startTime;
      console.log(`[FlightDetection] Fetched ${jobs.length} ${statusPath} jobs in ${fetchDuration}ms`);

      // Cache results
      this.cache.set(cacheKey, {
        data: jobs,
        timestamp: Date.now()
      });

      return jobs;
    } catch (error) {
      const errorDuration = Date.now() - startTime;
      console.error(`[FlightDetection] Error fetching company jobs after ${errorDuration}ms: ${error.message}`);
      return [];
    }
  }

  /**
   * Extract cargo types and passenger types from a job
   * Returns arrays of type names from CargoType.Name and CharterType.Name
   */
  extractCargoAndPassengerTypes(job) {
    const cargoTypes = new Set();
    const passengerTypes = new Set();

    try {
      // Extract cargo types from Cargos array
      if (Array.isArray(job.Cargos)) {
        job.Cargos.forEach(cargo => {
          if (cargo.CargoType?.Name) {
            // Clean up cargo type name: trim and remove trailing colons
            const cleanName = cargo.CargoType.Name.trim().replace(/:+$/, '');
            if (cleanName) cargoTypes.add(cleanName);
          }
        });
      }

      // Extract passenger types from Charters array
      if (Array.isArray(job.Charters)) {
        job.Charters.forEach(charter => {
          if (charter.CharterType?.Name) {
            // Clean up charter type name: trim and remove trailing colons
            const cleanName = charter.CharterType.Name.trim().replace(/:+$/, '');
            if (cleanName) passengerTypes.add(cleanName);
          }
        });
      }
    } catch (error) {
      console.error('[FlightDetection] Error extracting cargo/passenger types:', error.message);
    }

    return {
      cargoTypes: Array.from(cargoTypes),
      passengerTypes: Array.from(passengerTypes)
    };
  }

  /**
   * Get detailed info about all jobs with cargo for debugging
   */
  async getJobsWithCargoSummary() {
    try {
      const jobs = await this.getCompanyJobs(false);
      const jobsWithCargo = [];

      for (const job of jobs) {
        const cargoCount = job.Cargos ? job.Cargos.length : 0;
        const passengerCount = job.Charters ? job.Charters.length : 0;

        if (cargoCount > 0 || passengerCount > 0) {
          const types = this.extractCargoAndPassengerTypes(job);
          jobsWithCargo.push({
            id: job.Id,
            route: `${job.MainAirport?.ICAO || 'UNKNOWN'} → ${job.BaseAirport?.ICAO || 'UNKNOWN'}`,
            cargoCount: cargoCount,
            cargoTypes: types.cargoTypes,
            passengerCount: passengerCount,
            passengerTypes: types.passengerTypes
          });
        }
      }

      console.log(`[FlightDetection] Jobs with cargo/passengers summary:`);
      jobsWithCargo.forEach(job => {
        console.log(`[FlightDetection]   ${job.route}: ${job.cargoCount} cargo (${job.cargoTypes.join(', ')}), ${job.passengerCount} passengers (${job.passengerTypes.join(', ')})`);
      });

      return jobsWithCargo;
    } catch (error) {
      console.error('[FlightDetection] Error getting cargo summary:', error.message);
      return [];
    }
  }

  /**
   * Match a flight to its corresponding job
   * Strategy: Match by departure and arrival airports (routes are usually unique)
   * Falls back to matching job's main destination if direct match not found
   */
  async matchFlightToJob(flight) {
    try {
      const pendingJobs = await this.getCompanyJobs(false);

      const flightDeparture = flight.DepartureAirport;
      const flightArrival = flight.ArrivalIntendedAirport;

      // First pass: Look for exact route match (departure + arrival)
      for (const job of pendingJobs) {
        // Check if this job matches this flight's route
        // Jobs have MainAirportId (departure) and BaseAirportId (destination)
        const jobDeparture = job.MainAirport?.ICAO;
        const jobArrival = job.BaseAirport?.ICAO;

        if (jobDeparture === flightDeparture && jobArrival === flightArrival) {
          console.log(`[FlightDetection] ✓ Matched flight ${flightDeparture}→${flightArrival} to job ID ${job.Id}`);
          return job;
        }
      }

      // No match found
      console.log(`[FlightDetection] ℹ No matching job found for flight ${flightDeparture}→${flightArrival}`);
      return null;
    } catch (error) {
      console.error('[FlightDetection] Error matching flight to job:', error.message);
      return null;
    }
  }

  /**
   * Clear cache
   */
  clearCache() {
    this.cache.clear();
  }
}

module.exports = FlightDetectionService;
