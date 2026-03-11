const VAProfileService = require('./VAProfileService');
const CrewProfileService = require('./CrewProfileService');
const FlightSessionManager = require('./FlightSessionManager');
const DispatchValidator = require('./DispatchValidator');

/**
 * DispatchOrchestrator
 * Orchestrates the complete dispatch workflow:
 * 1. Load flight from OnAir
 * 2. Load/create VA profile
 * 3. Load/create crew profiles
 * 4. Initialize session
 * 5. Validate readiness
 * 6. Return comprehensive dispatch context
 */

class DispatchOrchestrator {
  constructor(flightService, siDispatchService) {
    this.flightService = flightService;
    this.siDispatchService = siDispatchService;
  }

  /**
   * Load and prepare flight for dispatch
   * Main entry point for Phase 2 dispatch workflow
   *
   * @param {string} flightId - Flight ID from OnAir
   * @param {string} vaId - VA company ID
   * @returns {object} - Complete dispatch context with profiles and session
   */
  async loadFlightForDispatch(flightId, vaId) {
    try {
      console.log(`[DispatchOrchestrator] Loading flight ${flightId} for VA ${vaId}`);

      // Step 1: Get flight from OnAir
      const flight = await this.flightService.getActiveFlight(flightId);
      if (!flight) {
        throw new Error(`Flight ${flightId} not found or not active`);
      }

      console.log(`[DispatchOrchestrator] Flight loaded: ${flight.DepartureAirport} → ${flight.ArrivalIntendedAirport}`);
      console.log(`[DispatchOrchestrator] Flight Company: ${flight.Company?.Name || 'N/A'}`);

      // Step 2: Load/create VA profile
      const vaData = {
        name: flight.Company?.Name || 'KahunaAir',
        callsign: flight.Company?.AirlineCode || 'KHA',
        airlineCode: flight.Company?.AirlineCode || 'KHA',
        description: `${flight.Company?.Name || 'KahunaAir'} VA`
      };
      console.log(`[DispatchOrchestrator] Creating VA profile with data:`, vaData);
      const vaProfile = VAProfileService.getOrCreateProfile(vaId, vaData);
      console.log(`[DispatchOrchestrator] VA Profile created: ${vaProfile.name}`);
      console.log(`[DispatchOrchestrator] VA Profile loaded: ${vaProfile.name}`);

      // Step 3: Load/create crew profiles
      const crewProfiles = [];
      if (flight.FlightCrews && flight.FlightCrews.length > 0) {
        for (const crew of flight.FlightCrews) {
          console.log(`[DispatchOrchestrator] Processing crew: ${crew.People?.Pseudo}`);
          const crewData = {
            name: crew.People?.Pseudo || 'Unknown Crew',
            role: this.mapCrewRole(crew.Role),
            roleNumber: crew.Role,
            flightHours: crew.People?.FlightHoursTotalBeforeHiring ||
              crew.People?.FlightHoursInCompany || 0,
            siApiKey: crew.People?.SayIntentionsPilotKey || null  // Store SI API key for later dispatch
          };
          console.log(`[DispatchOrchestrator] Crew data prepared for ${crewData.name}`);

          const crewProfile = CrewProfileService.getOrCreateProfile(crew.PeopleId, crewData);
          console.log(`[DispatchOrchestrator] Crew profile created for ${crewProfile.name}`);
          crewProfiles.push(crewProfile);
        }
        console.log(`[DispatchOrchestrator] Loaded ${crewProfiles.length} crew profiles`);
      }

      // Step 4: Initialize session
      // Handle airports as either strings or objects from OnAir
      const depAirport = flight.DepartureAirport;
      const arrAirport = flight.ArrivalIntendedAirport;

      const sessionData = {
        id: flightId,
        // Simple airport data based on ICAO codes from OnAir
        departureAirport: {
          code: typeof depAirport === 'string' ? depAirport : (depAirport?.ICAO || 'DEP'),
          ICAO: typeof depAirport === 'string' ? depAirport : (depAirport?.ICAO || 'DEP'),
          name: typeof depAirport === 'string' ? depAirport : (depAirport?.Name || 'Departure')
        },
        arrivalAirport: {
          code: typeof arrAirport === 'string' ? arrAirport : (arrAirport?.ICAO || 'ARR'),
          ICAO: typeof arrAirport === 'string' ? arrAirport : (arrAirport?.ICAO || 'ARR'),
          name: typeof arrAirport === 'string' ? arrAirport : (arrAirport?.Name || 'Arrival')
        },
        aircraft: flight.Aircraft?.AircraftType?.Name || 'Unknown Aircraft',
        flightNumber: flight.FlightNumber,
        siFlightData: flight // Store complete flight data for SI context
      };

      FlightSessionManager.initializeSession(sessionData, vaProfile, crewProfiles);
      console.log(`[DispatchOrchestrator] Session initialized`);

      // Step 5: Validate readiness
      const sessionContext = FlightSessionManager.getSessionData();
      const validation = DispatchValidator.validateReadiness(sessionContext);

      console.log(`[DispatchOrchestrator] Validation: ${validation.ready ? '✅ READY' : '❌ NOT READY'}`);

      // Step 6: Build dispatch context
      console.log('[DispatchOrchestrator] Building dispatch context...');

      const dispatchContext = {
        flight: {
          id: flightId,
          flightNumber: flight.FlightNumber,
          aircraft: flight.Aircraft?.AircraftType?.Name,
          siKey: this.flightService.getSayIntentionsKey(flight)
        },

        // Properly structured route object - handle airports as strings or objects
        route: {
          departure: {
            ICAO: typeof depAirport === 'string' ? depAirport : (depAirport?.ICAO || 'DEP'),
            code: typeof depAirport === 'string' ? depAirport : (depAirport?.ICAO || 'DEP'),
            name: typeof depAirport === 'string' ? depAirport : (depAirport?.Name || 'Departure')
          },
          arrival: {
            ICAO: typeof arrAirport === 'string' ? arrAirport : (arrAirport?.ICAO || 'ARR'),
            code: typeof arrAirport === 'string' ? arrAirport : (arrAirport?.ICAO || 'ARR'),
            name: typeof arrAirport === 'string' ? arrAirport : (arrAirport?.Name || 'Arrival')
          },
          flightPlan: flight.FlightPlan  // Full route data from OnAir
        },

        va: {
          id: vaId,
          name: vaProfile.name,
          callsign: vaProfile.callsign,
          profile: vaProfile
        },

        crew: crewProfiles.map((c, idx) => {
          console.log(`[DispatchOrchestrator] Mapping crew ${idx}: ${c.name || 'Unknown'}`);
          return {
            id: c.peopleId,
            peopleId: c.peopleId,
            name: c.name,
            role: c.role,
            hours: (c.background?.flightHours) || 0,
            flights: (c.statistics?.NumberOfFlights || c.stats?.landings) || 0,
            profile: c
          };
        }),

        validation: {
          ready: validation?.ready || false,
          errors: validation?.errors || [],
          warnings: validation?.warnings || [],
          details: validation?.details || {}
        },

        session: {
          active: FlightSessionManager?.isActive?.() || false,
          summary: FlightSessionManager?.getSessionSummary?.() || {}
        },

        timestamp: new Date().toISOString()
      };

      console.log(`[DispatchOrchestrator] Dispatch context ready for transmission`);

      return {
        success: true,
        context: dispatchContext,
        validation: validation
      };
    } catch (error) {
      console.error(`[DispatchOrchestrator] Error loading flight:`, error.message);
      console.error(`[DispatchOrchestrator] Stack trace:`, error.stack);
      throw error;
    }
  }

  /**
   * Update crew profile in session
   * @param {string} peopleId - Crew member ID
   * @param {object} updates - Profile updates
   * @returns {object} - Updated profile
   */
  updateCrewProfile(peopleId, updates) {
    try {
      const profile = CrewProfileService.loadByPeopleId(peopleId);
      if (!profile) {
        throw new Error(`Crew profile ${peopleId} not found`);
      }

      const updated = { ...profile, ...updates };
      CrewProfileService.save(peopleId, updated);
      FlightSessionManager.addCrewToSession(peopleId, updated);

      console.log(`[DispatchOrchestrator] Updated crew profile: ${updated.name}`);

      return {
        success: true,
        profile: updated
      };
    } catch (error) {
      console.error(`[DispatchOrchestrator] Error updating crew profile:`, error.message);
      throw error;
    }
  }

  /**
   * Update VA profile in session
   * @param {string} vaId - VA company ID
   * @param {object} updates - Profile updates
   * @returns {object} - Updated profile
   */
  updateVAProfile(vaId, updates) {
    try {
      const profile = VAProfileService.loadProfile(vaId);
      if (!profile) {
        throw new Error(`VA profile ${vaId} not found`);
      }

      const updated = { ...profile, ...updates };
      VAProfileService.saveProfile(vaId, updated);
      FlightSessionManager.updateVAProfile(updated);

      console.log(`[DispatchOrchestrator] Updated VA profile: ${updated.name}`);

      return {
        success: true,
        profile: updated
      };
    } catch (error) {
      console.error(`[DispatchOrchestrator] Error updating VA profile:`, error.message);
      throw error;
    }
  }

  /**
   * Get current session data
   * @returns {object} - Session context with all professions
   */
  getSessionData() {
    const session = FlightSessionManager.getSessionData();
    if (!session) {
      return null;
    }

    return {
      flight: {
        departure: session.departure,
        arrival: session.arrival,
        aircraft: session.aircraft,
        flightNumber: session.flightNumber
      },
      va: session.vaProfile,
      crew: session.crewProfiles,
      summary: FlightSessionManager.getSessionSummary()
    };
  }

  /**
   * Validate current session and crew profiles
   * Check if all crew profiles exist and are complete
   * @returns {object} - Validation result
   */
  validateCurrentSession() {
    const session = FlightSessionManager.getSessionData();
    if (!session) {
      return {
        valid: false,
        ready: false,
        error: 'No active session'
      };
    }

    const validation = DispatchValidator.validateReadiness(session);
    return {
      valid: validation.ready,
      ready: validation.ready,
      errors: validation.errors,
      warnings: validation.warnings,
      summary: DispatchValidator.getSummary(validation),
      details: validation.details
    };
  }

  /**
   * Clear current session
   * Called by "End Flight" button or manual session termination
   * @returns {object} - Success confirmation
   */
  endFlight() {
    try {
      const summary = FlightSessionManager.getSessionSummary();
      FlightSessionManager.clearSession();

      console.log(`[DispatchOrchestrator] Flight session ended: ${summary?.flight}`);

      return {
        success: true,
        message: 'Flight session cleared',
        endedFlight: summary
      };
    } catch (error) {
      console.error(`[DispatchOrchestrator] Error ending flight:`, error.message);
      throw error;
    }
  }

  /**
   * Build dispatch payload for SayIntentions.AI
   * Constructs rich context for crew customization
   * @param {object} customization - User customization settings
   * @returns {object} - Payload ready for SI import
   */
  buildDispatchPayload(customization = {}) {
    try {
      const session = this.getSessionData();
      if (!session) {
        throw new Error('No active session for dispatch');
      }

      const validation = this.validateCurrentSession();
      if (!validation.ready) {
        throw new Error(`Cannot dispatch: ${validation.errors.join(', ')}`);
      }

      // Build crew data context
      const crewContext = session.crew.map(c => {
        const custom = customization[c.peopleId] || {};
        const personality = custom.personality || (c.personality?.style || c.personality);
        return `${c.name} (${c.role}): ${personality}`;
      }).join(' | ');

      const crewData = `Crew Team: ${crewContext}. Operational guidelines: ${session.va.operationalPolicy?.communicationStyle || 'Professional'}`;

      // Build dispatcher data context
      const dispatcherData = `Dispatch for ${session.route.departure.ICAO} (${session.route.departure.name}) → ${session.route.arrival.ICAO} (${session.route.arrival.name}) on ${session.flight.aircraft}. `
        + `VA: ${session.va.name} (${session.va.callsign}). `
        + `Briefing: ${session.va.operationalPolicy?.dispatcherPersonality || 'Professional and supportive'}`;

      // Build copilot data (can be extended)
      const copilotData = `Flight operational context: Route from ${session.route.departure.ICAO} to ${session.route.arrival.ICAO}. `
        + `Aircraft: ${session.flight.aircraft}. Crew count: ${session.crew.length}. `;

      const payload = {
        crew_data: crewData,
        dispatcher_data: dispatcherData,
        copilot_data: copilotData
      };

      // Validate payload
      const payloadValidation = DispatchValidator.validatePayload(payload);
      if (!payloadValidation.valid) {
        throw new Error(`Invalid payload: ${payloadValidation.errors.join(', ')}`);
      }

      console.log(`[DispatchOrchestrator] Dispatch payload built (${payloadValidation.sizes.crew_data}B crew, ${payloadValidation.sizes.dispatcher_data}B dispatcher)`);

      return {
        success: true,
        payload: payload,
        validation: payloadValidation
      };
    } catch (error) {
      console.error(`[DispatchOrchestrator] Error building payload:`, error.message);
      throw error;
    }
  }

  /**
   * Map OnAir numeric role to string
   * @param {number} roleNumber - 0=Captain, 1=FO, 2+=FA
   * @returns {string} - Role name
   */
  mapCrewRole(roleNumber) {
    const roleMap = {
      0: 'Captain',
      1: 'First Officer'
    };
    return roleMap[roleNumber] || 'Flight Attendant';
  }
}

module.exports = DispatchOrchestrator;
