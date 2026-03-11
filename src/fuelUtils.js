/**
 * Fuel Conversion Utilities
 * 
 * Converts between gallons and pounds based on fuel type
 * Fuel densities:
 * - Jet A: 6.7 lbs/gallon (standard commercial aviation)
 * - Jet A-1: 6.7 lbs/gallon (European variant)
 * - Avgas 100LL: 6.0 lbs/gallon (general aviation, reciprocating engines)
 */

const FUEL_DENSITIES = {
    // OnAir fuel type codes
    0: 6.7,     // Unknown - assume Jet A
    1: 6.7,     // Jet A
    2: 6.7,     // Jet A-1
    3: 6.0,     // Avgas 100LL
    4: 6.7,     // Diesel (rare, similar to Jet A)
    // Fallback
    default: 6.7
};

/**
 * Get fuel type name from OnAir fuel type code
 */
function getFuelTypeName(fuelTypeCode) {
    const names = {
        0: 'Unknown',
        1: 'Jet A',
        2: 'Jet A-1',
        3: 'Avgas 100LL',
        4: 'Diesel'
    };
    return names[fuelTypeCode] || 'Unknown';
}

/**
 * Get fuel density in lbs/gallon
 */
function getFuelDensity(fuelTypeCode) {
    return FUEL_DENSITIES[fuelTypeCode] || FUEL_DENSITIES.default;
}

/**
 * Convert gallons to pounds
 */
function gallonsToLbs(gallons, fuelTypeCode = 1) {
    if (gallons === null || gallons === undefined) return null;
    const density = getFuelDensity(fuelTypeCode);
    return gallons * density;
}

/**
 * Convert pounds to gallons
 */
function lbsToGallons(lbs, fuelTypeCode = 1) {
    if (lbs === null || lbs === undefined) return null;
    const density = getFuelDensity(fuelTypeCode);
    return lbs / density;
}

/**
 * Format fuel display with both gallons and pounds
 */
function formatFuelDisplay(gallons, fuelTypeCode = 1) {
    if (gallons === null || gallons === undefined) return null;

    const lbs = gallonsToLbs(gallons, fuelTypeCode);
    return {
        gallons: Math.round(gallons * 10) / 10,  // 1 decimal place
        lbs: Math.round(lbs),                      // whole number
        fuelType: getFuelTypeName(fuelTypeCode),
        display: `${Math.round(lbs)} lbs (${Math.round(gallons)} gal)` // Primary: lbs, Secondary: gal
    };
}

module.exports = {
    getFuelTypeName,
    getFuelDensity,
    gallonsToLbs,
    lbsToGallons,
    formatFuelDisplay
};
