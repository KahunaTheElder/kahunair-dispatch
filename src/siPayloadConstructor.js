/**
 * siPayloadConstructor.js
 * 
 * Builds SI importVAData payload from crew, VA, and dispatcher profiles
 * Combines crew_data, va_data, dispatcher_data with flight context
 * 
 * SI API Endpoint: POST https://apipri.sayintentions.ai/sapi/importVAData
 * Required fields in payload: va_api_key + at least one of (crew_data, va_data, dispatcher_data, copilot_data)
 */

const fs = require('fs');
const path = require('path');

class SIPayloadConstructor {
  constructor(apiKey) {
    // API key should come from settings (Phase 0)
    this.apiKey = apiKey;
    this.errors = [];
  }

  /**
   * Construct full SI importVAData payload
   * Combines:
   *   - va_api_key (from settings)
   *   - crew_data (from crew profiles)
   *   - va_data (from VA profile)
   *   - dispatcher_data (from dispatcher profile)
   *   - copilot_data (optional, from copilot profile if exists)
   * 
   * Returns: {
   *   success: bool,
   *   payload: { complete SI payload object },
   *   message: string,
   *   dataTypes: { count and types of data included },
   *   validation: { schema validation results }
   * }
   */
  async construct(crewData, vaData, dispatcherData, copilotData = null) {
    try {
      this.errors = [];

      // 1. Validate required SI API key
      if (!this.apiKey || this.apiKey.trim() === '') {
        this.errors.push('Missing SI API key (should come from Phase 0 Settings)');
        return this.buildErrorResponse();
      }

      // 2. Build base payload with required field
      const payload = {
        va_api_key: this.apiKey
      };

      let dataCount = 0;
      const dataTypes = [];

      // 3. Add crew_data (required if present)
      if (crewData && typeof crewData === 'string' && crewData.trim().length > 0) {
        payload.crew_data = crewData;
        dataCount++;
        dataTypes.push('crew_data');
      }

      // 4. Add va_data (required if present)
      if (vaData && typeof vaData === 'string' && vaData.trim().length > 0) {
        payload.va_data = vaData;
        dataCount++;
        dataTypes.push('va_data');
      }

      // 5. Add dispatcher_data (required if present)
      if (dispatcherData && typeof dispatcherData === 'string' && dispatcherData.trim().length > 0) {
        payload.dispatcher_data = dispatcherData;
        dataCount++;
        dataTypes.push('dispatcher_data');
      }

      // 6. Add copilot_data if provided (optional)
      if (copilotData && typeof copilotData === 'string' && copilotData.trim().length > 0) {
        payload.copilot_data = copilotData;
        dataCount++;
        dataTypes.push('copilot_data');
      }

      // 7. Validate: must have at least one data field + va_api_key
      if (dataCount === 0) {
        this.errors.push('Payload must include at least one of: crew_data, va_data, dispatcher_data, copilot_data');
        return this.buildErrorResponse();
      }

      // 8. Validate payload structure
      const validation = this.validatePayloadSchema(payload);
      if (!validation.valid) {
        this.errors = validation.errors;
        return this.buildErrorResponse();
      }

      // 9. Build successful response
      return {
        success: true,
        payload,
        message: `SI payload constructed successfully with ${dataCount} data field(s)`,
        dataTypes,
        stats: {
          hasVAApiKey: !!payload.va_api_key,
          fieldCount: dataCount,
          totalFields: Object.keys(payload).length,
          estimatedSize: this.estimatePayloadSize(payload)
        },
        validation: {
          valid: true,
          schema: 'importVAData',
          apiVersion: 'sapi'
        }
      };
    } catch (error) {
      console.error('[SIPayloadConstructor] construct error:', error.message);
      return {
        success: false,
        payload: null,
        error: error.message,
        message: 'Failed to construct SI payload'
      };
    }
  }

  /**
   * Validate payload against SI schema
   * SI API requires:
   *   - va_api_key: string (required)
   *   - crew_data: string (optional, but at least one data field required)
   *   - va_data: string (optional)
   *   - dispatcher_data: string (optional)
   *   - copilot_data: string (optional)
   *   - skyops_data: string (optional, not yet implemented)
   */
  validatePayloadSchema(payload) {
    const errors = [];
    const warnings = [];

    // Check va_api_key
    if (!payload.va_api_key) {
      errors.push('Missing va_api_key');
    } else if (typeof payload.va_api_key !== 'string') {
      errors.push('va_api_key must be a string');
    } else if (payload.va_api_key.trim().length === 0) {
      errors.push('va_api_key cannot be empty');
    }

    // Check that at least one data field exists
    const dataFields = ['crew_data', 'va_data', 'dispatcher_data', 'copilot_data', 'skyops_data'];
    const presentDataFields = dataFields.filter(field => payload[field] && typeof payload[field] === 'string');

    if (presentDataFields.length === 0) {
      errors.push('At least one of [crew_data, va_data, dispatcher_data, copilot_data, skyops_data] must be present');
    }

    // Validate each present data field is a non-empty string
    for (const field of presentDataFields) {
      if (typeof payload[field] !== 'string') {
        errors.push(`${field} must be a string`);
      } else if (payload[field].trim().length === 0) {
        errors.push(`${field} cannot be empty`);
      } else if (payload[field].length > 50000) {
        warnings.push(`${field} is very long (${payload[field].length} chars) - SI may truncate`);
      }
    }

    // Check for unexpected fields
    const validFields = ['va_api_key', ...dataFields];
    for (const field of Object.keys(payload)) {
      if (!validFields.includes(field)) {
        warnings.push(`Unexpected field '${field}' - SI API may ignore it`);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      schema: 'importVAData',
      fieldsPresent: presentDataFields.length,
      totalFields: Object.keys(payload).length
    };
  }

  /**
   * Estimate payload size for SI API
   * SI API has URL encoding limits, good to warn if too large
   */
  estimatePayloadSize(payload) {
    let totalSize = 0;
    for (const [key, value] of Object.entries(payload)) {
      if (typeof value === 'string') {
        // URL encoding can increase size by ~1-3% depending on special chars
        totalSize += value.length * 1.05;
      }
    }
    return {
      estimated: Math.ceil(totalSize),
      unit: 'bytes',
      safe: totalSize < 1000000, // 1 MB safe threshold
      warningThreshold: 100000   // Warn if over 100KB
    };
  }

  /**
   * Build error response with consistent structure
   */
  buildErrorResponse() {
    return {
      success: false,
      payload: null,
      errors: this.errors,
      message: `Payload construction failed: ${this.errors.join('; ')}`
    };
  }

  /**
   * Format payload for SI API submission
   * SI expects JSON payload as string in form parameter
   * This converts the payload object to JSON string ready for form submission
   */
  formatForSISubmission(payload) {
    try {
      return {
        success: true,
        payloadJson: JSON.stringify(payload),
        message: 'Payload formatted for SI API submission'
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Example usage (for documentation)
   * const constructor = new SIPayloadConstructor(siApiKey);
   * const result = await constructor.construct(crewDataString, vaDataString, dispatcherDataString);
   * 
   * Then submit to SI: 
   * POST https://apipri.sayintentions.ai/sapi/importVAData
   * With form data:
   *   api_key: <userSIKey>
   *   payload: <result.payload as JSON string>
   */
}

module.exports = SIPayloadConstructor;
