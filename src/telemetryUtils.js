/**
 * Telemetry Utilities for Flight Data
 * Handles flight level conversion, position-based lookups, and telemetry formatting
 */

/**
 * Convert flight level number to FL notation
 * @param {number} flightLevel - Flight level as number (e.g., 30000 or 300)
 * @returns {string} - Formatted flight level (e.g., "FL300")
 */
function convertToFlightLevel(flightLevel) {
  if (!flightLevel || flightLevel <= 0) {
    return 'NOT ASSIGNED';
  }
  
  // If over 1000, it's already in feet, divide by 100
  if (flightLevel > 1000) {
    return `FL${Math.round(flightLevel / 100)}`;
  }
  
  // If under 100, it's likely already FL format
  if (flightLevel < 100) {
    return `FL${flightLevel}`;
  }
  
  // Otherwise divide by 100
  return `FL${Math.round(flightLevel / 100)}`;
}

/**
 * Calculate great-circle distance between two lat/lon points
 * @param {number} lat1 - Latitude 1
 * @param {number} lon1 - Longitude 1
 * @param {number} lat2 - Latitude 2
 * @param {number} lon2 - Longitude 2
 * @returns {number} - Distance in nautical miles
 */
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 3440.07; // Earth radius in nautical miles
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Find nearest airport from current position
 * @param {number} currentLat - Current latitude
 * @param {number} currentLon - Current longitude
 * @param {array} departureAirport - Departure airport object with ICAO, Name, Latitude, Longitude
 * @param {array} arrivalAirport - Arrival airport object with ICAO, Name, Latitude, Longitude
 * @returns {object} - Nearest airport info { icao, name, distance_nm, approximate_location }
 */
function findNearestAirport(currentLat, currentLon, departureAirport, arrivalAirport) {
  const airports = [];
  
  if (departureAirport && departureAirport.Latitude && departureAirport.Longitude) {
    const dist = calculateDistance(currentLat, currentLon, departureAirport.Latitude, departureAirport.Longitude);
    airports.push({
      type: 'departure',
      icao: departureAirport.ICAO,
      name: departureAirport.Name,
      distance_nm: Math.round(dist),
      latitude: departureAirport.Latitude,
      longitude: departureAirport.Longitude
    });
  }
  
  if (arrivalAirport && arrivalAirport.Latitude && arrivalAirport.Longitude) {
    const dist = calculateDistance(currentLat, currentLon, arrivalAirport.Latitude, arrivalAirport.Longitude);
    airports.push({
      type: 'arrival',
      icao: arrivalAirport.ICAO,
      name: arrivalAirport.Name,
      distance_nm: Math.round(dist),
      latitude: arrivalAirport.Latitude,
      longitude: arrivalAirport.Longitude
    });
  }
  
  if (airports.length === 0) {
    return {
      icao: 'NOT ASSIGNED',
      name: 'NOT ASSIGNED',
      distance_nm: 0,
      type: 'unknown'
    };
  }
  
  return airports.sort((a, b) => a.distance_nm - b.distance_nm)[0];
}

/**
 * Estimate nearest location/city from coordinates
 * @param {number} latitude - Current latitude
 * @param {number} longitude - Current longitude
 * @param {array} departureAirport - Departure airport object
 * @param {array} arrivalAirport - Arrival airport object
 * @returns {string} - Estimated location (e.g., "Enroute to KPHX" or "At EETU")
 */
function estimateLocation(latitude, longitude, departureAirport, arrivalAirport) {
  if (!latitude || !longitude) {
    return 'UNKNOWN';
  }
  
  // Check if at departure airport (within 10 nm)
  if (departureAirport && departureAirport.Latitude && departureAirport.Longitude) {
    const depDist = calculateDistance(latitude, longitude, departureAirport.Latitude, departureAirport.Longitude);
    if (depDist < 10) {
      return `At ${departureAirport.ICAO} (${departureAirport.Name})`;
    }
  }
  
  // Check if at arrival airport (within 10 nm)
  if (arrivalAirport && arrivalAirport.Latitude && arrivalAirport.Longitude) {
    const arrDist = calculateDistance(latitude, longitude, arrivalAirport.Latitude, arrivalAirport.Longitude);
    if (arrDist < 10) {
      return `At ${arrivalAirport.ICAO} (${arrivalAirport.Name})`;
    }
  }
  
  // Otherwise enroute
  if (arrivalAirport) {
    return `Enroute to ${arrivalAirport.ICAO}`;
  }
  
  return `Position ${latitude.toFixed(2)}°, ${longitude.toFixed(2)}°`;
}

/**
 * Map FlightState numeric values to readable labels
 * @param {number} flightState - Flight state code from OnAir API
 * @returns {string} - Human readable flight state
 */
function interpretFlightState(flightState) {
  const stateMap = {
    0: 'Parked',
    1: 'Pushback',
    2: 'Taxiing',
    3: 'Takeoff Roll',
    4: 'Airborne',
    5: 'Climbing',
    6: 'Cruising',
    7: 'Descending',
    8: 'Landing',
    9: 'Landed'
  };
  
  return stateMap[flightState] || `Unknown (${flightState})`;
}

module.exports = {
  convertToFlightLevel,
  calculateDistance,
  findNearestAirport,
  estimateLocation,
  interpretFlightState
};
