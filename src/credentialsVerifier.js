/**
 * Credential Verification Service for KahunaAir Dispatch
 * 
 * Verifies that required API credentials exist and are valid
 * Runs at application startup to ensure app can function
 */

const axios = require('axios');

class CredentialsVerifier {
    /**
     * Check if all required credentials exist and are valid
     * @returns {Promise<{valid: boolean, missing: string[], error: string|null, details: object}>}
     */
    static async verifyAllCredentials() {
        const result = {
            valid: false,
            missing: [],
            error: null,
            details: {}
        };

        // 1. Check environment variables exist
        const requiredVars = {
            'ONAIR_VA_COMPANY_ID': process.env.ONAIR_VA_COMPANY_ID,
            'ONAIR_VA_API_KEY': process.env.ONAIR_VA_API_KEY,
            'SI_API_KEY': process.env.SI_API_KEY
        };

        for (const [key, value] of Object.entries(requiredVars)) {
            if (!value || value.trim() === '') {
                result.missing.push(key);
            }
        }

        // If any credentials missing, return early
        if (result.missing.length > 0) {
            result.error = `Missing credentials: ${result.missing.join(', ')}`;
            return result;
        }

        // 2. Verify credentials work by testing OnAir API
        try {
            const response = await axios.get(
                `https://server1.onair.company/api/v1/va/${process.env.ONAIR_VA_COMPANY_ID}`,
                {
                    headers: {
                        'oa-apikey': process.env.ONAIR_VA_API_KEY
                    },
                    timeout: 5000
                }
            );

            if (response.status === 200) {
                result.valid = true;
                result.details.onairConnection = 'SUCCESS';
                result.details.vaName = response.data?.Content?.Name || 'Unknown VA';
            } else {
                result.error = `OnAir API returned status ${response.status}`;
                result.details.onairConnection = 'FAILED';
            }
        } catch (error) {
            // Distinguish between auth error and network error
            if (error.response?.status === 401 || error.response?.status === 403) {
                result.error = 'OnAir API credentials invalid (authentication failed)';
                result.details.onairConnection = 'AUTHENTICATION_FAILED';
            } else if (error.code === 'ECONNREFUSED') {
                result.error = 'Cannot connect to OnAir API (network error or offline)';
                result.details.onairConnection = 'NETWORK_ERROR';
            } else {
                result.error = `OnAir API test failed: ${error.message}`;
                result.details.onairConnection = 'ERROR';
            }
        }

        return result;
    }

    /**
     * Check if Flight API credentials exist (VA Pilot account)
     * @returns {Promise<{valid: boolean, missing: string[], error: string|null}>}
     */
    static async verifyFlightCredentials() {
        const result = {
            valid: false,
            missing: [],
            error: null
        };

        // Check OnAir Flight API credentials
        if (!process.env.ONAIR_VA_COMPANY_ID) {
            result.missing.push('ONAIR_VA_COMPANY_ID');
        }
        if (!process.env.ONAIR_VA_API_KEY) {
            result.missing.push('ONAIR_VA_API_KEY');
        }

        if (result.missing.length > 0) {
            result.error = `Missing Flight API credentials: ${result.missing.join(', ')}`;
            return result;
        }

        // Test flight API endpoint
        try {
            const response = await axios.get(
                `https://server1.onair.company/api/v1/company/${process.env.ONAIR_VA_COMPANY_ID}`,
                {
                    headers: {
                        'oa-apikey': process.env.ONAIR_VA_API_KEY
                    },
                    timeout: 5000
                }
            );

            result.valid = response.status === 200;
        } catch (error) {
            result.error = `Flight API test failed: ${error.message}`;
        }

        return result;
    }

    /**
     * Check if SI API credentials exist
     * @returns {Promise<{valid: boolean, missing: string[], error: string|null}>}
     */
    static async verifySICredentials() {
        const result = {
            valid: false,
            missing: [],
            error: null
        };

        if (!process.env.SI_API_KEY) {
            result.missing.push('SI_API_KEY');
            result.error = 'Missing SI_API_KEY credential';
            return result;
        }

        // SI credential validity is harder to test without making real calls
        // Just verify it exists and is not empty
        result.valid = true;
        return result;
    }

    /**
     * Get a human-readable description of credential status
     * @param {object} verifyResult - Result from verifyAllCredentials()
     * @returns {string}
     */
    static getErrorMessage(verifyResult) {
        if (verifyResult.valid) {
            return 'All credentials verified successfully';
        }

        if (verifyResult.missing.length > 0) {
            return `Missing credentials:\n- ${verifyResult.missing.join('\n- ')}\n\nPlease add these to your .env file`;
        }

        return verifyResult.error || 'Credentials verification failed for unknown reason';
    }

    /**
     * Log credential status for debugging
     * @param {object} verifyResult
     */
    static logStatus(verifyResult) {
        console.log('[CredentialsVerifier] Status:', verifyResult.valid ? '✅ VALID' : '❌ INVALID');
        if (verifyResult.missing.length > 0) {
            console.log('[CredentialsVerifier] Missing:', verifyResult.missing);
        }
        if (verifyResult.error) {
            console.log('[CredentialsVerifier] Error:', verifyResult.error);
        }
        if (Object.keys(verifyResult.details).length > 0) {
            console.log('[CredentialsVerifier] Details:', verifyResult.details);
        }
    }
}

module.exports = CredentialsVerifier;
