/**
 * Auto Flight Loader Service
 * 
 * On app startup, detects if user has an active flight in OnAir
 * If active flight exists, loads it automatically
 * If no active flight, returns null (user can manually select)
 */

const AccountDetectionService = require('./accountDetection');

class AutoFlightLoader {
    /**
     * Check for active flight and return flight data if found
     * @returns {Promise<{flightId, accountType, flightNumber, aircraft} | null>}
     */
    static async checkAndLoadActiveFlightOnStartup() {
        try {
            console.log('[AutoFlightLoader] Starting active flight detection...');

            // 1. Detect which account is active and get the active flight data
            const accountDetection = new AccountDetectionService();
            const activeAccount = await accountDetection.detectActiveAccount();

            console.log('[AutoFlightLoader] detectActiveAccount returned:', activeAccount);
            console.log('[AutoFlightLoader] activeAccount type:', typeof activeAccount);
            console.log('[AutoFlightLoader] activeAccount keys:', activeAccount ? Object.keys(activeAccount) : 'null');

            if (!activeAccount) {
                console.log('[AutoFlightLoader] No active flight detected - user is not flying');
                return null;
            }

            if (!activeAccount.flightActive) {
                console.log('[AutoFlightLoader] Account object returned but no flight is active');
                return null;
            }

            console.log('[AutoFlightLoader] ACTIVE FLIGHT DETECTED!');
            console.log('[AutoFlightLoader]   Account:', activeAccount.accountType);
            console.log('[AutoFlightLoader]   Flight:', activeAccount.flightNumber);
            console.log('[AutoFlightLoader]   Aircraft:', activeAccount.aircraft);
            console.log('[AutoFlightLoader]   Route:', activeAccount.departureAirport, '→', activeAccount.arrivalAirport);

            // Return the active flight data (detected by AccountDetectionService)
            return {
                flightId: activeAccount.flightId,
                accountType: activeAccount.accountType,
                companyId: activeAccount.companyId,
                apiKey: activeAccount.apiKey,
                flightNumber: activeAccount.flightNumber,
                aircraft: activeAccount.aircraft,
                departureAirport: activeAccount.departureAirport,
                arrivalAirport: activeAccount.arrivalAirport,
                flightData: activeAccount.fullFlightData
            };
        } catch (error) {
            console.error('[AutoFlightLoader] Error detecting active flight:', error.message);
            console.error('[AutoFlightLoader] Stack:', error.stack);
            return null;
        }
    }
}

module.exports = AutoFlightLoader;
