/**
 * siDeploymentService.js
 * 
 * Handles deployment of crew, VA, and dispatcher data to SayIntentions.AI
 * Submits constructed payload to SI importVAData endpoint
 * 
 * SI API Endpoint: POST https://apipri.sayintentions.ai/sapi/importVAData
 * Request Format: Form data with api_key and payload (JSON string)
 * Response: JSON with status, crew/VA confirmations, warnings
 */

const https = require('https');
const querystring = require('querystring');
const logger = require('./logger');

class SIDeploymentService {
  constructor(userSIApiKey) {
    // userSIApiKey: Personal SI API key (different from VA API key inside payload)
    this.userSIApiKey = userSIApiKey;
    this.siEndpoint = 'apipri.sayintentions.ai';
    this.siPath = '/sapi/importVAData';
    this.timeout = 30000; // 30 second timeout for SI API
    this.maxRetries = 3;
    this.retryDelay = 2000; // 2 seconds between retries
  }

  /**
   * Deploy payload to SI API
   * 
   * @param {Object} payload - SI payload object with va_api_key, crew_data, va_data, etc.
   * @returns {Promise<Object>} - Deployment result with status, SI response, logs
   */
  async deploy(payload) {
    try {
      // 1. Validate inputs
      if (!payload || typeof payload !== 'object') {
        return this.buildErrorResponse('INVALID_PAYLOAD', 'Payload must be a non-null object');
      }

      if (!this.userSIApiKey || this.userSIApiKey.trim() === '') {
        return this.buildErrorResponse('NO_USER_API_KEY', 'User SI API key not configured');
      }

      // 2. Validate payload structure
      const validation = this.validatePayload(payload);
      if (!validation.valid) {
        return this.buildErrorResponse('VALIDATION_FAILED', validation.errors.join('; '));
      }

      // 3. Build form data for SI API
      const formData = this.buildFormData(payload);

      // 4. Deploy with retries
      let lastError = null;
      for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
        try {
          logger.info(`[SIDeploymentService] Deployment attempt ${attempt}/${this.maxRetries}`);
          const siResponse = await this.sendToSI(formData);

          // Success - return immediately
          return this.buildSuccessResponse(siResponse, payload, attempt);
        } catch (error) {
          lastError = error;
          logger.warn(`[SIDeploymentService] Attempt ${attempt} failed: ${error.message}`);

          if (attempt < this.maxRetries) {
            // Wait before retry
            await this.delay(this.retryDelay * attempt);
          }
        }
      }

      // All retries exhausted
      return this.buildErrorResponse('DEPLOYMENT_FAILED',
        `Failed after ${this.maxRetries} attempts: ${lastError.message}`);

    } catch (error) {
      logger.error(`[SIDeploymentService] Unexpected error: ${error.message}`);
      return this.buildErrorResponse('INTERNAL_ERROR', error.message);
    }
  }

  /**
   * Send payload to SI API via HTTPS
   * @private
   */
  sendToSI(formData) {
    return new Promise((resolve, reject) => {
      const options = {
        hostname: this.siEndpoint,
        port: 443,
        path: this.siPath,
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(formData)
        },
        timeout: this.timeout
      };

      const startTime = Date.now();
      const req = https.request(options, (res) => {
        let data = '';

        res.on('data', chunk => {
          data += chunk;
        });

        res.on('end', () => {
          const duration = Date.now() - startTime;
          logger.info(`[SIDeploymentService] SI API response: ${res.statusCode} (${duration}ms)`);

          if (res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error(`SI API returned ${res.statusCode}: ${data}`));
            return;
          }

          try {
            const parsed = JSON.parse(data);
            resolve({ statusCode: res.statusCode, data: parsed });
          } catch {
            // SI API might return non-JSON response
            resolve({ statusCode: res.statusCode, data: { raw: data } });
          }
        });
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('SI API request timeout'));
      });

      req.on('error', (error) => {
        reject(new Error(`SI API connection error: ${error.message}`));
      });

      // Send form data
      req.write(formData);
      req.end();
    });
  }

  /**
   * Build form data for SI API submission
   * Format: api_key=xxx&payload={json}
   * @private
   */
  buildFormData(payload) {
    const formData = {
      api_key: this.userSIApiKey,
      payload: JSON.stringify(payload)
    };

    return querystring.stringify(formData);
  }

  /**
   * Validate payload structure before sending
   * @private
   */
  validatePayload(payload) {
    const errors = [];

    // Check required field
    if (!payload.va_api_key) {
      errors.push('Missing va_api_key in payload');
    } else if (typeof payload.va_api_key !== 'string') {
      errors.push('va_api_key must be a string');
    }

    // Check at least one data field
    const dataFields = ['crew_data', 'va_data', 'dispatcher_data', 'copilot_data', 'skyops_data'];
    const presentData = dataFields.filter(f => payload[f] && typeof payload[f] === 'string');

    if (presentData.length === 0) {
      errors.push('At least one data field required (crew_data, va_data, dispatcher_data, copilot_data, or skyops_data)');
    }

    return {
      valid: errors.length === 0,
      errors,
      presentDataFields: presentData
    };
  }

  /**
   * Build success response
   * @private
   */
  buildSuccessResponse(siResponse, payload, attemptNumber) {
    const payloadSize = JSON.stringify(payload).length;

    return {
      success: true,
      deployed: true,
      message: `Payload deployed to SI API successfully (Attempt ${attemptNumber})`,
      timestamp: new Date().toISOString(),
      payloadStats: {
        size: payloadSize,
        unit: 'bytes',
        dataFields: Object.keys(payload).filter(k => k !== 'va_api_key')
      },
      siResponse: {
        statusCode: siResponse.statusCode,
        body: siResponse.data
      },
      recoveryInfo: {
        nextStep: 'Monitor SI dashboard for crew/VA data updates',
        verifyBy: 'Check https://app.sayintentions.ai for crew customization changes',
        checkDataIn: '5-10 minutes after deployment'
      }
    };
  }

  /**
   * Build error response
   * @private
   */
  buildErrorResponse(code, message) {
    const errorCodes = {
      'INVALID_PAYLOAD': 'Payload format invalid',
      'NO_USER_API_KEY': 'User SI API key missing',
      'VALIDATION_FAILED': 'Payload validation failed',
      'DEPLOYMENT_FAILED': 'All deployment attempts failed',
      'INTERNAL_ERROR': 'Internal server error',
      'TIMEOUT': 'SI API did not respond in time',
      'NETWORK_ERROR': 'Network connection failed'
    };

    return {
      success: false,
      deployed: false,
      error: code,
      errorMessage: errorCodes[code] || code,
      message,
      timestamp: new Date().toISOString(),
      recovery: this.getRecoveryInfo(code),
      retry: code !== 'VALIDATION_FAILED' && code !== 'NO_USER_API_KEY'
    };
  }

  /**
   * Get recovery information based on error type
   * @private
   */
  getRecoveryInfo(code) {
    const recovery = {
      'INVALID_PAYLOAD': 'Verify payload structure matches SI schema',
      'NO_USER_API_KEY': 'Configure user SI API key in settings',
      'VALIDATION_FAILED': 'Check payload contains required fields and valid data types',
      'DEPLOYMENT_FAILED': 'Check network connectivity, SI API status, or check logs for details',
      'INTERNAL_ERROR': 'Check server logs for details',
      'TIMEOUT': 'SI API is slow - try again in a few moments',
      'NETWORK_ERROR': 'Check internet connection and SI API availability'
    };

    return recovery[code] || 'Check logs for more details';
  }

  /**
   * Delay helper for retries
   * @private
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get deployment status/history
   * Can be used to check if deployment succeeded without re-sending
   */
  getDeploymentInfo() {
    return {
      siEndpoint: `https://${this.siEndpoint}${this.siPath}`,
      userApiKeyConfigured: !!this.userSIApiKey,
      timeout: this.timeout,
      maxRetries: this.maxRetries,
      retryDelay: this.retryDelay
    };
  }
}

module.exports = SIDeploymentService;
