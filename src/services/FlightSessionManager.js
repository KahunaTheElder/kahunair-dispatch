/**
 * FlightSessionManager
 * Manages flight session lifecycle and caching
 * Stores flight data, crew profiles, and session state during active flight
 */

class FlightSessionManager {
  constructor() {
    this.session = null;
  }

  /**
   * Initialize flight session with all OnAir data
   * Called once when user clicks "Quick Dispatch"
   * @param {object} flightData - Complete flight data from OnAir
   * @param {object} vaProfile - VA profile
   * @param {array} crewProfiles - Array of crew profile objects
   * @returns {object} - Session object
   */
  initializeSession(flightData, vaProfile, crewProfiles) {
    try {
      const depCode = flightData.departureAirport?.code || (typeof flightData.departureAirport === 'string' ? flightData.departureAirport : 'XXXX');
      const arrCode = flightData.arrivalAirport?.code || (typeof flightData.arrivalAirport === 'string' ? flightData.arrivalAirport : 'XXXX');

      this.session = {
        // Flight info
        flightId: flightData.id,
        flight: {
          departure: depCode,
          arrival: arrCode,
          aircraft: flightData.aircraft || 'Unknown',
          flightNumber: flightData.flightNumber || ''
        },

        // Route structure for dispatch payload building
        route: {
          departure: {
            code: depCode,
            ICAO: depCode,
            name: flightData.departureAirport?.name || depCode,
            city: flightData.departureAirport?.city
          },
          arrival: {
            code: arrCode,
            ICAO: arrCode,
            name: flightData.arrivalAirport?.name || arrCode,
            city: flightData.arrivalAirport?.city
          }
        },

        // VA & Crew
        va: vaProfile,
        crew: crewProfiles,

        // SI Context
        siFlightData: flightData.siFlightData || null,

        // Session metadata
        startTime: Date.now(),
        active: true
      };

      console.log(`[FlightSessionManager] Session initialized: ${depCode} -> ${arrCode}`);
      return this.session;
    } catch (error) {
      console.error(`[FlightSessionManager] Error initializing session:`, error.message);
      throw error;
    }
  }

  /**
   * Get current session data
   * @returns {object|null} - Session object or null if no active session
   */
  getSessionData() {
    if (!this.session || !this.session.active) {
      return null;
    }
    return this.session;
  }

  /**
   * Check if session is active
   * @returns {boolean}
   */
  isActive() {
    return this.session && this.session.active;
  }

  /**
   * Add or update crew profile in session
   * @param {string} peopleId - Crew member ID
   * @param {object} profile - Updated crew profile
   * @returns {boolean} - Success
   */
  addCrewToSession(peopleId, profile) {
    try {
      if (!this.session) {
        throw new Error('No active session');
      }

      // Update or add crew profile
      const index = this.session.crew.findIndex(c => c.peopleId === peopleId);
      if (index >= 0) {
        this.session.crew[index] = profile;
        console.log(`[FlightSessionManager] Updated crew profile for ${profile.name}`);
      } else {
        this.session.crew.push(profile);
        console.log(`[FlightSessionManager] Added crew profile for ${profile.name}`);
      }

      return true;
    } catch (error) {
      console.error(`[FlightSessionManager] Error adding crew to session:`, error.message);
      return false;
    }
  }

  /**
   * Update VA profile in session
   * @param {object} vaProfile - Updated VA profile
   * @returns {boolean} - Success
   */
  updateVAProfile(vaProfile) {
    try {
      if (!this.session) {
        throw new Error('No active session');
      }

      this.session.va = vaProfile;
      console.log(`[FlightSessionManager] Updated VA profile for ${vaProfile.name}`);
      return true;
    } catch (error) {
      console.error(`[FlightSessionManager] Error updating VA profile:`, error.message);
      return false;
    }
  }

  /**
   * Get crew member profile from session
   * @param {string} peopleId - Crew member ID
   * @returns {object|null} - Crew profile or null
   */
  getCrewProfile(peopleId) {
    if (!this.session) {
      return null;
    }

    return this.session.crew.find(c => c.peopleId === peopleId) || null;
  }

  /**
   * Get all crew in session
   * @returns {array} - Array of crew profiles
   */
  getAllCrew() {
    if (!this.session) {
      return [];
    }

    return this.session.crew || [];
  }

  /**
   * Get session summary (for dispatch)
   * @returns {object} - Summary of current session
   */
  getSessionSummary() {
    if (!this.session || !this.session.active) {
      return null;
    }

    return {
      flight: `${this.session.departure} -> ${this.session.arrival}`,
      aircraft: this.session.aircraft,
      va: this.session.va?.name || 'Unknown VA',
      crew: this.session.crew?.length || 0,
      sessionAge: Date.now() - this.session.startTime
    };
  }

  /**
   * Clear flight session
   * Called when user clicks "End Flight"
   * @returns {boolean} - Success
   */
  clearSession() {
    try {
      if (this.session) {
        console.log(`[FlightSessionManager] Clearing session: ${this.session.departure} -> ${this.session.arrival}`);
        this.session.active = false;
        this.session = null;
      }
      return true;
    } catch (error) {
      console.error(`[FlightSessionManager] Error clearing session:`, error.message);
      return false;
    }
  }

  /**
   * Export session data for dispatch payload
   * @returns {object} - Data formatted for SI dispatcher payload
   */
  exportForDispatch() {
    if (!this.session || !this.session.active) {
      throw new Error('No active session for dispatch');
    }

    return {
      va: this.session.vaProfile,
      flight: {
        departure: this.session.departure,
        arrival: this.session.arrival,
        aircraft: this.session.aircraft,
        flightNumber: this.session.flightNumber
      },
      crew: this.session.crewProfiles
    };
  }
}

// Export singleton instance
module.exports = new FlightSessionManager();
