const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const compression = require('compression');
const logger = require('./logger');
const FlightDetectionService = require('./flightDetectionService');
const SIDispatchService = require('./siDispatchService');
const DispatchOrchestrator = require('./services/DispatchOrchestrator');
const DispatchValidator = require('./services/DispatchValidator');
const simConnectService = require('./simConnectService');
const credentialsManager = require('../src/credentialsManager');
const telemetryUtils = require('./telemetryUtils');
const fuelUtils = require('./fuelUtils');
const { matchCargoCharterForActiveFlight } = require('./cargoCharterService');

/**
 * KahunaAir Dispatch Server
 * Bridges OnAir API with SayIntentions.AI
 */

class DispatchServer {
  constructor(config = {}) {
    this.app = express();
    this.port = config.port || 3000;
    this.env = config.env || 'development';

    // Store credentials for cargo/charter matching
    this.credentials = {
      ONAIR_COMPANY_ID: config.onairCompanyId,
      ONAIR_COMPANY_API_KEY: config.onairApiKey,
      ONAIR_VA_ID: config.onairVaId,
      ONAIR_VA_API_KEY: config.onairVaApiKey
    };

    // Initialize flight detection service
    this.flightService = new FlightDetectionService({
      companyId: config.onairCompanyId,
      apiKey: config.onairApiKey,
      pageLimit: 4,
      cacheTTL: 30000 // 30 seconds
    });

    // Initialize SI dispatch service
    this.siDispatch = new SIDispatchService(config.siGlobalKey || process.env.SI_API_KEY);

    // Initialize dispatch orchestrator
    this.dispatcher = new DispatchOrchestrator(this.flightService, this.siDispatch);

    // Storage for dispatch preferences (in-memory; can be upgraded to database)
    this.dispatchPreferences = {};

    // Cargo polling state - tracks per-flight cargo fetch status
    // cargoStatus: 'IDLE' | 'AWAITING_OA_START' | 'LOADING' | 'READY'
    this.cargoState = {
      flightId: null,
      cargoCharter: null,
      cargoStatus: 'IDLE',
      lastCargoFetch: null
    };

    this.setupMiddleware();
    this.setupRoutes();
  }

  setupMiddleware() {
    const path = require('path');
    const fs = require('fs');

    // Allow CORS for all localhost ports (to support port fallback)
    this.app.use(cors({
      origin: /^http:\/\/localhost:\d+$/,
      credentials: true
    }));

    // Compression
    this.app.use(compression());

    // Body parsing
    this.app.use(bodyParser.json());
    this.app.use(bodyParser.urlencoded({ extended: true }));

    // Serve static frontend files in production
    // Frontend is a sibling of src: app/src/ and app/frontend/dist/
    const frontendPath = path.join(__dirname, '..', 'frontend', 'dist');
    const altFrontendPath = path.join(__dirname, '..', '..', 'frontend', 'dist'); // For packaged app

    console.log('[Server] Frontend path check:');
    console.log('[Server]   __dirname:', __dirname);
    console.log('[Server]   Primary path:', frontendPath, '- exists:', fs.existsSync(frontendPath));
    console.log('[Server]   Fallback path:', altFrontendPath, '- exists:', fs.existsSync(altFrontendPath));

    // Log static file requests (CSS, JS, etc.)
    this.app.use((req, res, next) => {
      if (req.path.includes('/assets/') || req.path.endsWith('.css') || req.path.endsWith('.js')) {
        console.log(`[Static] ${req.method} ${req.path}`);
      }
      next();
    });

    // Try primary path first, then fallback
    let servedPath = null;
    if (fs.existsSync(frontendPath)) {
      console.log('[Server] ✓ Serving static frontend from primary path:', frontendPath);
      this.app.use(express.static(frontendPath));
      servedPath = frontendPath;
    } else if (fs.existsSync(altFrontendPath)) {
      console.log('[Server] ✓ Serving static frontend from fallback path:', altFrontendPath);
      this.app.use(express.static(altFrontendPath));
      servedPath = altFrontendPath;
    } else {
      console.warn('[Server] ❌ Frontend directory not found!');
      console.warn('[Server]    Primary:', frontendPath);
      console.warn('[Server]    Fallback:', altFrontendPath);
    }

    // Logging middleware - DISABLED (caused 50MB+ logs)
    // Do NOT enable - causes severe I/O overhead and connection drops
    // this.app.use((req, res, next) => {
    //   const start = Date.now();
    //   res.on('finish', () => {
    //     const duration = Date.now() - start;
    //     const logMsg = `${req.method} ${req.path} - ${res.statusCode} (${duration}ms)`;
    //     logger.debug(logMsg);
    //   });
    //   next();
    // });

    // Health check
    this.app.get('/health', (req, res) => {
      res.json({ status: 'ok', timestamp: new Date().toISOString() });
    });

    // Diagnostic endpoint for debugging connection issues
    this.app.get('/api/diagnostic', (req, res) => {
      const os = require('os');
      res.json({
        status: 'backend-online',
        port: this.port,
        timestamp: new Date().toISOString(),
        platform: process.platform,
        env: this.env,
        memory: {
          rss: Math.round(process.memoryUsage().rss / 1024 / 1024) + ' MB',
          heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + ' MB',
          heapTotal: Math.round(process.memoryUsage().heapTotal / 1024 / 1024) + ' MB'
        },
        system: {
          freemem: Math.round(os.freemem() / 1024 / 1024) + ' MB',
          totalmem: Math.round(os.totalmem() / 1024 / 1024) + ' MB',
          loadavg: os.loadavg()
        }
      });
    });

    // ===== SIMCONNECT TELEMETRY ENDPOINT =====
    this.app.get('/api/telemetry', (req, res) => {
      const simConnectService = require('./simConnectService');
      const telemetry = simConnectService.getTelemetry();

      if (!telemetry) {
        return res.status(503).json({
          success: false,
          error: 'SimConnect not connected or no telemetry data available',
          isConnected: simConnectService.getConnectionStatus(),
          recovery: 'Launch MSFS 2024 to establish connection'
        });
      }

      res.json({
        success: true,
        data: telemetry,
        isConnected: simConnectService.getConnectionStatus(),
        timestamp: new Date().toISOString()
      });
    });

    // Enhanced telemetry status endpoint with connection details
    this.app.get('/api/telemetry/status', (req, res) => {
      const simConnectService = require('./simConnectService');
      const telemetry = simConnectService.getTelemetry();

      if (!telemetry) {
        return res.status(503).json({
          success: false,
          connected: false,
          status: 'DISCONNECTED',
          message: 'SimConnect not connected - MSFS 2024 not running',
          lastUpdate: simConnectService.getLastUpdateTime(),
          telemetry: null
        });
      }

      // Extract key telemetry for UI display
      const displayTelemetry = {
        heading: Math.round(telemetry.position?.heading || 0),
        altitude: Math.round(telemetry.altitude?.indicated || 0),
        airspeed: Math.round(telemetry.speed?.airspeed || 0),
        groundSpeed: Math.round(telemetry.speed?.groundSpeed || 0),
        verticalSpeed: Math.round(telemetry.speed?.verticalSpeed || 0),
        totalWeight: Math.round(telemetry.weight?.current || 0),
        emptyWeight: Math.round(telemetry.weight?.empty || 0),
        payloadWeight: Math.round(telemetry.weight?.payload || 0),
        fuelWeight: Math.round(telemetry.fuel?.total || 0),
        passengers: telemetry.passengers?.count || 0,
        cargo: Math.round(telemetry.cargo?.weight || 0),
        timestamp: telemetry.timestamp
      };

      res.json({
        success: true,
        connected: simConnectService.getConnectionStatus(),
        status: 'CONNECTED',
        message: 'SimConnect connected to MSFS 2024',
        telemetry: displayTelemetry,
        lastUpdate: simConnectService.getLastUpdateTime(),
        updateRate: '1Hz (1 update per second)',
        rawData: telemetry
      });
    });
  }

  setupRoutes() {
    // ===== CREDENTIAL MANAGEMENT ENDPOINTS =====

    // Check if credentials are configured
    this.app.get('/api/credentials-status', (req, res) => {
      try {
        const configured = credentialsManager.hasCredentials();
        res.json({
          success: true,
          configured
        });
      } catch (error) {
        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    });

    // Validate and store credentials
    this.app.post('/api/set-credentials', async (req, res) => {
      try {
        const { onairCompanyId, onairApiKey, siApiKey } = req.body;

        // Validate inputs
        if (!onairCompanyId || !onairApiKey || !siApiKey) {
          return res.status(400).json({
            success: false,
            error: 'onairCompanyId, onairApiKey, and siApiKey are required'
          });
        }

        // Store credentials
        credentialsManager.setCredentials(onairCompanyId, onairApiKey, siApiKey);

        res.json({
          success: true,
          message: 'Credentials stored successfully'
        });
      } catch (error) {
        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    });

    // Validate credentials with OnAir API
    this.app.post('/api/validate-credentials', async (req, res) => {
      try {
        const { onairCompanyId, onairApiKey, siApiKey } = req.body;

        // Validate inputs
        if (!onairCompanyId || !onairApiKey || !siApiKey) {
          return res.status(400).json({
            success: false,
            error: 'onairCompanyId, onairApiKey, and siApiKey are all required'
          });
        }

        // Basic format validation
        if (typeof onairCompanyId !== 'string' || typeof onairApiKey !== 'string' || typeof siApiKey !== 'string') {
          return res.status(400).json({
            success: false,
            error: 'All credentials must be strings'
          });
        }

        if (onairCompanyId.trim().length === 0 || onairApiKey.trim().length === 0 || siApiKey.trim().length === 0) {
          return res.status(400).json({
            success: false,
            error: 'No credential field can be empty'
          });
        }

        // Test OnAir credentials
        try {
          const { OnAirClient } = require('./apiClients');
          const testClient = new OnAirClient({
            companyId: onairCompanyId,
            apiKey: onairApiKey
          });

          await testClient.getVAProfile(onairCompanyId);
          console.log('[DispatchServer] OnAir credentials validated');
        } catch (testError) {
          return res.status(400).json({
            success: false,
            error: `OnAir credentials invalid: ${testError.message}`
          });
        }

        // Store credentials if validation passes
        credentialsManager.setCredentials(onairCompanyId, onairApiKey, siApiKey);

        // Update the flight service with new credentials
        this.flightService.updateCredentials(onairCompanyId, onairApiKey);
        console.log('[DispatchServer] Flight service updated with new credentials');

        res.json({
          success: true,
          message: 'Credentials validated and stored'
        });
      } catch (error) {
        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    });

    // ===== PHASE 0: SETTINGS MANAGEMENT ENDPOINTS =====
    // Secure credential storage with AES-256 encryption
    // Persists to %APPDATA%\KahunaAir\settings.json

    /**
     * POST /api/settings
     * Save all 7 credentials with individual field encryption
     * 
     * Required body:
     * {
     *   "siApiKey": "string",
     *   "oaCompanyId": "uuid",
     *   "oaApiKey": "string",
     *   "oaVaId": "uuid",
     *   "oaVaApiKey": "string",
     *   "oaPilotId": "string",
     *   "simBriefPilotId": "string"
     * }
     */
    this.app.post('/api/settings', (req, res) => {
      try {
        const settingsManager = require('./settingsManager');
        const result = settingsManager.save(req.body);

        if (!result.success) {
          return res.status(400).json(result);
        }

        res.json(result);
      } catch (error) {
        console.error('[API /api/settings POST]', error.message);
        res.status(500).json({
          success: false,
          message: 'Failed to save settings',
          error: error.message,
          recovery: 'Check server logs for details'
        });
      }
    });

    /**
     * GET /api/settings
     * Load and decrypt all credentials
     * 
     * Returns:
     * {
     *   "success": true,
     *   "data": {
     *     "siApiKey": "decrypted-value",
     *     "oaCompanyId": "decrypted-value",
     *     ...
     *   },
     *   "message": "Settings loaded successfully",
     *   "lastUpdated": "2026-03-08T12:00:00Z"
     * }
     */
    this.app.get('/api/settings', (req, res) => {
      try {
        const settingsManager = require('./settingsManager');
        const result = settingsManager.load();

        if (result.success) {
          return res.json(result);
        }

        // No settings file yet — attempt migration from old credentials store
        const oldCreds = credentialsManager.loadCredentials();
        if (oldCreds) {
          console.log('[API /api/settings GET] No settings file — returning migrated credentials for pre-fill');
          return res.json({
            success: true,
            migrated: true,
            message: 'Pre-filled from legacy credentials (not yet saved to encrypted store)',
            data: {
              siApiKey: oldCreds.SI_API_KEY || '',
              oaCompanyId: oldCreds.ONAIR_COMPANY_ID || '',
              oaApiKey: oldCreds.ONAIR_COMPANY_API_KEY || '',
              oaVaId: oldCreds.ONAIR_VA_ID || '',
              oaVaApiKey: oldCreds.ONAIR_VA_API_KEY || '',
              oaPilotId: '',
              simBriefPilotId: oldCreds.SIMBRIEF_PILOT_ID || ''
            }
          });
        }

        return res.status(404).json(result);
      } catch (error) {
        console.error('[API /api/settings GET]', error.message);
        res.status(500).json({
          success: false,
          message: 'Failed to load settings',
          error: error.message,
          recovery: 'Delete settings file at %APPDATA%\\KahunaAir\\settings.json and reinitialize via POST /api/settings'
        });
      }
    });

    // ===== CONNECTION TEST ENDPOINTS =====

    // Test SayIntentions.AI connection
    this.app.get('/api/test-si-connection', async (req, res) => {
      try {
        const creds = credentialsManager.loadCredentials();
        if (!creds.SI_API_KEY) {
          return res.status(400).json({
            success: false,
            siConnected: false,
            error: 'SI API key not configured'
          });
        }

        // Test SI connection with a simple method call
        const axios = require('axios');
        try {
          const response = await axios.get('https://apipri.sayintentions.ai/sapi/health', {
            headers: {
              'Authorization': `Bearer ${creds.SI_API_KEY}`
            },
            timeout: 5000
          });

          res.json({
            success: true,
            siConnected: true,
            message: 'SayIntentions.AI connection successful'
          });
        } catch (siError) {
          console.warn('[DispatchServer] SI connection test failed:', siError.message);
          res.status(200).json({
            success: true,
            siConnected: false,
            error: `SI API test failed: ${siError.message}`
          });
        }
      } catch (error) {
        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    });

    // Test SimConnect connection (via simConnectService)
    this.app.get('/api/test-simconnect-connection', async (req, res) => {
      try {
        // Just return status - SimConnect is optional
        const isConnected = simConnectService && simConnectService.isConnected();

        res.json({
          success: true,
          simConnectConnected: isConnected || false,
          message: isConnected ? 'SimConnect connected' : 'SimConnect not connected (optional)'
        });
      } catch (error) {
        res.status(200).json({
          success: true,
          simConnectConnected: false,
          message: 'SimConnect not available'
        });
      }
    });

    // ===== DEPLOYMENT ENDPOINT =====

    this.app.post('/api/dispatch/deploy-to-si', async (req, res) => {
      try {
        const { flightId, crewPersonalities, vaProfile, flightData } = req.body;

        if (!flightId || !crewPersonalities || !vaProfile || !flightData) {
          return res.status(400).json({
            success: false,
            error: 'Missing required fields: flightId, crewPersonalities, vaProfile, flightData'
          });
        }

        logger.info(`[Deploy] Starting SI deployment for flight ${flightId}`);

        // Get crew members with SI API keys from flightData
        const crew = flightData.crew?.members || [];
        const crewData = crew.map(member => {
          const personKey = `crew_personality_${flightId}_${member.id}`;
          const stored = JSON.parse(crewPersonalities[personKey] || '{}');
          return {
            name: member.name,
            role: member.role,
            personality: stored.personality || 'professional',
            notes: stored.notes || '',
            siApiKey: member.siApiKey // From OnAir flight data
          };
        });

        // Build dispatcher data from flight info
        const dispatcherData = {
          flightNumber: flightData.flightNumber || `KHA${flightData.id?.slice(0, 4).toUpperCase()}`,
          origin: flightData.departureAirport || 'UNKNOWN',
          destination: flightData.arrivalAirport || 'UNKNOWN',
          aircraft: flightData.aircraftType || 'Unknown Aircraft',
          distance: flightData.distance || 0,
          estimatedFlight: flightData.estimatedFlightTime || 'N/A',
          passengers: flightData.paxCount || 0,
          cargo: flightData.cargoWeight || 0
        };

        // Build VA context
        const vaContext = {
          name: vaProfile.name || 'Kahuna Air',
          callsign: vaProfile.callsign || 'KAHUNA',
          personality: vaProfile.personality || '',
          operationalNotes: vaProfile.operationalNotes || ''
        };

        // Call SI deployment via siDispatch service
        logger.info(`[Deploy] Building VA import data for ${crewData.length} crew members`);

        // Send to SI using the VA Pilot's SI key (primary)
        const siKey = process.env.SI_API_KEY;
        if (!siKey) {
          throw new Error('SI_API_KEY not configured');
        }

        // Build the importVAData payload
        const importPayload = {
          crew_data: crewData.map(c => ({
            name: c.name,
            role: c.role,
            personality: c.personality,
            custom_notes: c.notes
          })),
          dispatcher_data: dispatcherData,
          copilot_data: crewData[1] || crewData[0] // Secondary crew or use first as copilot
        };

        logger.info(`[Deploy] Calling SI importVAData with:`, {
          crewCount: crewData.length,
          dispatcherData,
          vaContext
        });

        // Make the SI API call
        const axios = require('axios');
        const siResponse = await axios.post(
          'https://apipri.sayintentions.ai/sapi/importVAData',
          importPayload,
          {
            headers: {
              'Authorization': `Bearer ${siKey}`,
              'Content-Type': 'application/json'
            }
          }
        );

        logger.info(`[Deploy] SI importVAData response:`, siResponse.status, siResponse.data);

        // Success response
        res.json({
          success: true,
          siDeployed: true,
          message: 'Flight data deployed to SayIntentions.AI',
          response: siResponse.data
        });
      } catch (error) {
        logger.error(`[Deploy] Deployment failed:`, error.message);
        res.status(500).json({
          success: false,
          error: `Deployment failed: ${error.message}`
        });
      }
    });

    // ===== FLIGHT & DISPATCH ENDPOINTS =====

    // Get all Kahuna flights
    this.app.get('/api/flights', async (req, res) => {
      const timeoutHandle = setTimeout(() => {
        if (!res.headersSent) {
          res.status(504).json({
            success: false,
            error: 'Request timeout',
            flights: []
          });
        }
      }, 12000);

      try {
        const flights = await this.flightService.getAllKahunaFlights();
        clearTimeout(timeoutHandle);
        res.json({
          success: true,
          count: flights.length,
          flights: flights.map(f => this.formatFlightResponse(f))
        });
      } catch (error) {
        clearTimeout(timeoutHandle);
        res.status(500).json({
          success: false,
          error: error.message,
          flights: []
        });
      }
    });

    // Get active Kahuna flights only
    this.app.get('/api/flights/active', async (req, res) => {
      const timeoutHandle = setTimeout(() => {
        if (!res.headersSent) {
          res.status(504).json({
            success: false,
            error: 'Request timeout',
            flights: []
          });
        }
      }, 12000);

      try {
        const flights = await this.flightService.getActiveKahunaFlights();
        clearTimeout(timeoutHandle);

        const formattedFlights = flights.map(f => this.formatFlightResponse(f));

        res.json({
          success: true,
          count: flights.length,
          flights: formattedFlights
        });
      } catch (error) {
        clearTimeout(timeoutHandle);
        // Log only critical errors
        console.error('[ERROR] /api/flights/active failed:', error.message);
        res.status(500).json({
          success: false,
          error: error.message,
          flights: []
        });
      }
    });

    // ===== PHASE 1: ONAIR FLIGHT DETECTION =====
    /**
     * GET /api/flight/active
     * Returns the current active flight with crew details
     * 
     * Response:
     * {
     *   "success": true,
     *   "flight": {
     *     "id": "flight-uuid",
     *     "aircraft": { "type": "Boeing 737", "registration": "N12345" },
     *     "route": {
     *       "departure": { "ICAO": "KJFK", "name": "JFK" },
     *       "arrival": { "ICAO": "KLAX", "name": "LAX" }
     *     },
     *     "crew": {
     *       "members": [
     *         { "id": "crew-uuid", "name": "John Doe", "role": "Captain" },
     *         { "id": "crew-uuid", "name": "Jane Smith", "role": "First Officer" }
     *       ]
     *     }
     *   }
     * }
     */
    this.app.get('/api/flight/active', async (req, res) => {
      const timeoutHandle = setTimeout(() => {
        if (!res.headersSent) {
          res.status(504).json({
            success: false,
            error: 'Request timeout - OnAir API took too long'
          });
        }
      }, 12000);

      try {
        const activeFlights = await this.flightService.getActiveKahunaFlights();
        clearTimeout(timeoutHandle);

        if (!activeFlights || activeFlights.length === 0) {
          return res.status(404).json({
            success: false,
            error: 'No active flight found',
            recovery: 'Start a flight in OnAir and try again',
            flight: null
          });
        }

        // Get the first (most recent) active flight
        const activeFlight = activeFlights[0];
        const formattedFlight = this.formatFlightResponse(activeFlight);

        res.json({
          success: true,
          flight: formattedFlight,
          message: 'Active flight detected',
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        clearTimeout(timeoutHandle);
        console.error('[API /api/flight/active]', error.message);
        res.status(500).json({
          success: false,
          error: error.message,
          recovery: 'Check that OnAir credentials are configured and valid',
          flight: null
        });
      }
    });

    // ===== PHASE 2: SIMBRIEFOFP RETRIEVAL =====
    /**
     * GET /api/flight/ofp
     * Fetch flight plan (OFP) from SimBrief
     * 
     * Response:
     * {
     *   "success": true,
     *   "ofp": {
     *     "flightNumber": "...",
     *     "departure": { "ICAO": "KJFK", "SID": "...", "runway": "...", "name": "JFK" },
     *     "arrival": { "ICAO": "KLAX", "STAR": "...", "runway": "27L", "name": "LAX" },
     *     "alternate": { "ICAO": "KSAN", "name": "San Diego" },
     *     "route": "SID ROUTE STAR",
     *     "cruise": { "level": 350, "speed": 0.78 },
     *     "fuel": { "plannedLbs": 45000, "reserve": 5000, "alternate": 3000 },
     *     "payload": { "passengers": 150, "cargoWeight": 2000 },
     *     "weights": { "zeroFuelWeight": 350000, "takeoffWeight": 395000 },
     *     "estimatedTime": 315
     *   },
     *   "message": "OFP fetched from SimBrief",
     *   "timestamp": "2026-03-08T..."
     * }
     */
    this.app.get('/api/flight/ofp', async (req, res) => {
      const timeoutHandle = setTimeout(() => {
        if (!res.headersSent) {
          res.status(504).json({
            success: false,
            error: 'Request timeout - SimBrief API took too long',
            ofp: null
          });
        }
      }, 12000);

      try {
        const settingsManager = require('./settingsManager');

        // Load SimBrief Pilot ID from settings
        const settingsResult = settingsManager.load();
        if (!settingsResult.success) {
          clearTimeout(timeoutHandle);
          return res.status(400).json({
            success: false,
            error: 'Settings not configured',
            recovery: 'Configure settings via POST /api/settings first',
            ofp: null
          });
        }

        const simBriefPilotId = settingsResult.data.simBriefPilotId;
        if (!simBriefPilotId) {
          clearTimeout(timeoutHandle);
          return res.status(400).json({
            success: false,
            error: 'SimBrief Pilot ID not found in settings',
            recovery: 'Set simBriefPilotId via POST /api/settings',
            ofp: null
          });
        }

        // Fetch OFP from SimBrief
        const SimBriefClient = require('./simBriefClient');
        const simBrief = new SimBriefClient();
        const ofp = await simBrief.getLatestOFP(simBriefPilotId);

        clearTimeout(timeoutHandle);

        res.json({
          success: true,
          ofp: ofp,
          message: 'OFP fetched from SimBrief',
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        clearTimeout(timeoutHandle);
        console.error('[API /api/flight/ofp]', error.message);
        res.status(500).json({
          success: false,
          error: error.message,
          recovery: 'Verify SimBrief Pilot ID is correct and you have recent flight plans in SimBrief',
          ofp: null
        });
      }
    });

    // ===== PHASE 3: CREW PROFILE MANAGEMENT ENDPOINTS =====
    // Store and retrieve crew personality profiles by crew ID
    // Persists to %APPDATA%\KahunaAir\crews\{crewId}.json

    /**
     * GET /api/crew/{id}/profile
     * Load crew profile by ID (returns existing profile or indicates new crew)
     * 
     * Response:
     * {
     *   "success": true/false,
     *   "isNew": true/false (indicates if crew member is new),
     *   "profile": { crew profile object },
     *   "message": "string"
     * }
     */
    this.app.get('/api/crew/:crewId/profile', (req, res) => {
      try {
        const crewId = req.params.crewId;
        console.log('[API GET /api/crew/:crewId/profile] Loading crew:', crewId);

        const CrewProfileManager = require('./crewProfileManager');
        const crewManager = new CrewProfileManager();
        console.log('[API GET /api/crew/:crewId/profile] CrewManager created, calling load()...');

        const result = crewManager.load(crewId);
        console.log('[API GET /api/crew/:crewId/profile] Load result: success =', result.success, 'isNew =', result.isNew, 'message =', result.message);

        if (!result.success && result.isNew) {
          // Crew member not found - indicate this is a new crew member
          console.log('[API GET /api/crew/:crewId/profile] Profile not found for', crewId, '(new crew)');
          return res.status(404).json({
            success: false,
            isNew: true,
            profile: null,
            message: result.message,
            recovery: result.recovery
          });
        }

        if (!result.success) {
          // Error loading profile
          console.error('[API GET /api/crew/:crewId/profile] Error loading profile:', result.error);
          return res.status(result.code || 500).json({
            success: false,
            isNew: false,
            error: result.error,
            recovery: result.recovery
          });
        }

        // Profile found
        console.log('[API GET /api/crew/:crewId/profile] ✓ Profile loaded for', crewId);
        res.json({
          success: true,
          isNew: false,
          profile: result.profile,
          message: result.message,
          lastUpdated: result.lastUpdated
        });
      } catch (error) {
        console.error('[API GET /api/crew/:crewId/profile] Exception:', error.message);
        res.status(500).json({
          success: false,
          error: error.message,
          recovery: 'Check logs for profile loading error'
        });
      }
    });

    /**
     * POST /api/crew/{id}/profile
     * Save or update crew profile
     * 
     * Required body:
     * {
     *   "currentName": "string",
     *   "role": 0|1|2 (0=Captain, 1=FO, 2=FA),
     *   "companyId": "uuid",
     *   "personality": "formal|casual|humorous|standard",
     *   "customNotes": "string",
     *   "siKey": "string (SayIntentions.AI crew key)",
     *   "crew_data": { SI format object }
     * }
     */
    this.app.post('/api/crew/:crewId/profile', (req, res) => {
      try {
        const crewId = req.params.crewId;

        console.log('[API POST /api/crew/:crewId/profile] crewId:', crewId);
        console.log('[API POST /api/crew/:crewId/profile] Body keys:', Object.keys(req.body).slice(0, 10));
        console.log('[API POST /api/crew/:crewId/profile] Body size:', JSON.stringify(req.body).length, 'bytes');

        // ===== DEBUG: Check if typeRatings is in the request body =====
        console.log('[API POST /api/crew/:crewId/profile] Request body has typeRatings?', Array.isArray(req.body.typeRatings), 'Items:', req.body.typeRatings?.length);
        console.log('[API POST /api/crew/:crewId/profile] Request body has totalHours?', typeof req.body.totalHours, 'Value:', req.body.totalHours);

        if (!crewId || typeof crewId !== 'string') {
          console.error('[API POST /api/crew/:crewId/profile] Invalid crew ID');
          return res.status(400).json({
            success: false,
            error: 'Invalid crew ID',
            recovery: 'Provide a valid crew ID in the URL'
          });
        }

        const CrewProfileManager = require('./crewProfileManager');
        const crewManager = new CrewProfileManager();

        console.log('[API POST /api/crew/:crewId/profile] Calling crewManager.save...');
        const result = crewManager.save(crewId, req.body);

        console.log('[API POST /api/crew/:crewId/profile] Save result:', result.success ? '✓' : '✗', result.message);

        if (!result.success) {
          console.error('[API POST /api/crew/:crewId/profile] Save failed:', result.error);
          return res.status(result.code || 500).json({
            success: false,
            error: result.error,
            recovery: result.recovery
          });
        }

        console.log('[API POST /api/crew/:crewId/profile] ✓ Profile saved successfully');
        console.log('[API POST /api/crew/:crewId/profile] Saved profile has typeRatings?', Array.isArray(result.profile.typeRatings), 'Items:', result.profile.typeRatings?.length);

        res.json({
          success: true,
          profile: result.profile,
          message: result.message,
          isNew: result.isNew,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        console.error('[API POST /api/crew/:crewId/profile] Exception:', error.message, error.stack);
        res.status(500).json({
          success: false,
          error: error.message,
          recovery: 'Check logs. Verify crew profile data is valid JSON.'
        });
      }
    });

    /**
     * DELETE /api/crew/{id}/profile
     * Delete crew profile (for testing/reset only)
     */
    this.app.delete('/api/crew/:crewId/profile', (req, res) => {
      try {
        const crewId = req.params.crewId;

        const CrewProfileManager = require('./crewProfileManager');
        const crewManager = new CrewProfileManager();
        const result = crewManager.delete(crewId);

        if (!result.success) {
          return res.status(result.code || 500).json({
            success: false,
            error: result.error
          });
        }

        res.json({
          success: true,
          message: result.message
        });
      } catch (error) {
        console.error('[API /api/crew/{id}/profile DELETE]', error.message);
        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    });

    /**
     * GET /api/crews
     * List all stored crew profiles
     */
    this.app.get('/api/crews', (req, res) => {
      try {
        const CrewProfileManager = require('./crewProfileManager');
        const crewManager = new CrewProfileManager();
        const result = crewManager.listAll();

        if (!result.success) {
          return res.status(result.code || 500).json({
            success: false,
            error: result.error
          });
        }

        res.json({
          success: true,
          crews: result.crews,
          count: result.count
        });
      } catch (error) {
        console.error('[API /api/crews GET]', error.message);
        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    });

    /**
     * GET /api/si/status
     * Check whether SayIntentions.AI is running by looking for flight.json.
     * Returns { running: bool, callsign: string|null }
     */
    this.app.get('/api/si/status', (req, res) => {
      try {
        const fs = require('fs');
        const path = require('path');
        const os = require('os');
        const flightJsonPath = path.join(
          process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'),
          'SayIntentionsAI', 'flight.json'
        );
        if (fs.existsSync(flightJsonPath)) {
          try {
            const flightJson = JSON.parse(fs.readFileSync(flightJsonPath, 'utf8'));
            const fd = flightJson?.flight_details || {};
            return res.json({
              running: true,
              callsign: fd.callsign || null,
              flight_id: fd.flight_id ?? null,
              on_ground: fd.on_ground ?? null,
              current_airport: fd.current_airport || null
            });
          } catch {
            return res.json({ running: true, callsign: null, flight_id: null, on_ground: null, current_airport: null });
          }
        } else {
          return res.json({ running: false, callsign: null, flight_id: null, on_ground: null, current_airport: null });
        }
      } catch (e) {
        return res.json({ running: false, callsign: null, error: e.message });
      }
    });

    /**
     * POST /api/dispatch/crew-to-si
     * Assemble crew profiles for the active flight, build the importVAData payload,
     * and POST to SayIntentions.AI.
     *
     * Request body (optional):
     * {
     *   "crewMembers": [...],  // Array of crew member objects (if not provided, fetches from active flight)
     *   "flight": {...}        // Formatted flight object (if not provided, fetches from active flight)
     * }
     *
     * Response:
     * {
     *   "success": true,
     *   "siStatus": "OK",
     *   "message": "Sent to SayIntentions.AI"
     * }
     */
    this.app.post('/api/dispatch/crew-to-si', async (req, res) => {
      try {
        const CrewProfileManager = require('./crewProfileManager');
        const siPayloadBuilder = require('./siPayloadBuilder');
        const axios = require('axios');
        const fs = require('fs');
        const path = require('path');

        // Resolve SI API key:
        // 1. Prefer live key from %LOCALAPPDATA%\SayIntentionsAI\flight.json (rotates per session)
        // 2. Fall back to stored settings key
        let siApiKey = '';
        let siKeySource = 'settings';
        try {
          const flightJsonPath = require('path').join(
            process.env.LOCALAPPDATA || require('path').join(require('os').homedir(), 'AppData', 'Local'),
            'SayIntentionsAI', 'flight.json'
          );
          if (require('fs').existsSync(flightJsonPath)) {
            const flightJson = JSON.parse(require('fs').readFileSync(flightJsonPath, 'utf8'));
            const liveKey = flightJson?.flight_details?.api_key;
            if (liveKey && liveKey.trim()) {
              siApiKey = liveKey.trim();
              siKeySource = 'flight.json';
              console.log('[crew-to-si] Using SI key from flight.json');
            }
          }
        } catch (e) {
          console.warn('[crew-to-si] Could not read flight.json:', e.message);
        }

        // Fallback to stored settings key if flight.json key not available
        if (!siApiKey) {
          const settingsManager = require('./settingsManager');
          const settingsResult = settingsManager.load();
          if (!settingsResult.success) {
            return res.status(400).json({
              success: false,
              siStatus: 'error',
              message: 'Settings not configured',
              error: 'Cannot load credentials — configure settings first'
            });
          }
          siApiKey = settingsResult.data?.siApiKey || '';
          siKeySource = 'settings';
        }

        if (!siApiKey) {
          return res.status(400).json({
            success: false,
            siStatus: 'error',
            message: 'SI API key not available',
            error: 'Start SayIntentions.AI (key will be read from flight.json) or configure siApiKey in settings'
          });
        }

        console.log(`[crew-to-si] SI key source: ${siKeySource}`);

        // Get flight and crew — use provided data or fetch from active flight
        let crewMembers = req.body?.crewMembers;
        let flight = req.body?.flight;

        if (!crewMembers || !flight) {
          // Fetch active flight
          const activeFlights = await this.flightService.getActiveKahunaFlights();
          if (!activeFlights || activeFlights.length === 0) {
            return res.status(404).json({
              success: false,
              siStatus: 'error',
              message: 'No active flight found',
              error: 'Start a flight in OnAir before sending to SI'
            });
          }
          const formatted = this.formatFlightResponse(activeFlights[0]);
          if (!flight) flight = formatted;
          if (!crewMembers) crewMembers = formatted.crew?.members || [];
        }

        // Load all crew profiles
        const crewManager = new CrewProfileManager();
        const crewProfilesMap = {};

        for (const member of crewMembers) {
          const profileId = member.isMe ? 'my-pilot' : member.id; // captain always uses 'my-pilot' key
          const result = crewManager.load(profileId);
          if (result.success && result.profile) {
            crewProfilesMap[profileId] = result.profile;
          }
          // Skipped crew or missing profiles → no entry (handled gracefully in builder)
        }

        // Load VA profile
        let vaProfile = null;
        try {
          const vaProfilePath = path.join(__dirname, 'data', 'va-profiles', 'kahuna-air.json');
          if (fs.existsSync(vaProfilePath)) {
            vaProfile = JSON.parse(fs.readFileSync(vaProfilePath, 'utf8'));
          }
        } catch (e) {
          console.warn('[crew-to-si] Could not load VA profile:', e.message);
        }

        // Assemble payload
        const { crew_data, copilot_data, dispatcher_data } = siPayloadBuilder.assembleVAPayload(
          crewProfilesMap,
          crewMembers,
          flight,
          vaProfile,
          null // ofpData - not available here, could be added later
        );

        // va_api_key (inside payload) is the VA registration key — different from the outer api_key
        // Load it from settings; outer api_key comes from flight.json (pilot's personal session key)
        const settingsForVaKey = require('./settingsManager').load();
        const siVaApiKey = (settingsForVaKey.success ? settingsForVaKey.data?.siVaApiKey : '') || '';

        if (!siVaApiKey) {
          return res.status(400).json({
            success: false,
            siStatus: 'error',
            message: 'SI VA Key not configured',
            error: 'Add your SI VA Key (va_api_key) in Settings — it is different from your personal SI key'
          });
        }

        const payload = {
          va_api_key: siVaApiKey.trim(),
          crew_data,
          copilot_data,
          dispatcher_data
        };

        // POST to SayIntentions.AI importVAData
        // SI expects api_key + payload as application/x-www-form-urlencoded POST body (not query string)
        const querystring = require('querystring');
        const cleanKey = siApiKey.trim();
        const formBody = querystring.stringify({
          api_key: cleanKey,
          payload: JSON.stringify(payload)
        });

        console.log('[crew-to-si] Sending to SI importVAData...');
        const siResponse = await axios.post(
          'https://apipri.sayintentions.ai/sapi/importVAData',
          formBody,
          {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            timeout: 15000
          }
        );

        console.log('[crew-to-si] ✓ SI response:', siResponse.status, siResponse.data);

        return res.json({
          success: true,
          siStatus: siResponse.data?.status || 'OK',
          message: 'Sent to SayIntentions.AI',
          crewCount: crewMembers.length,
          profilesLoaded: Object.keys(crewProfilesMap).length,
          timestamp: new Date().toISOString(),
          // Full diagnostic info so the frontend can show what was sent and received
          sentPayload: { crew_data, copilot_data, dispatcher_data },
          siRawResponse: siResponse.data,
          siHttpStatus: siResponse.status
        });
      } catch (error) {
        const isAxiosError = error.isAxiosError || error.response;
        const statusCode = error.response?.status;
        const siMessage = error.response?.data;
        console.error('[crew-to-si] Error:', error.message, siMessage || '');

        return res.status(500).json({
          success: false,
          siStatus: 'error',
          message: isAxiosError
            ? `SI API error (${statusCode}): ${JSON.stringify(siMessage)}`
            : error.message,
          error: error.message,
          siRawResponse: siMessage,
          siHttpStatus: statusCode
        });
      }
    });

    /**
     * GET /api/dispatch/si-preview
     * Assemble the SI importVAData payload WITHOUT sending it.
     * Returns the full crew_data, copilot_data, dispatcher_data strings
     * so the operator can inspect exactly what would be sent to SI.
     */
    this.app.get('/api/dispatch/si-preview', async (req, res) => {
      try {
        const siPayloadBuilder = require('./siPayloadBuilder');
        const CrewProfileManager = require('./crewProfileManager');
        const fs = require('fs');
        const path = require('path');

        const activeFlights = await this.flightService.getActiveKahunaFlights();
        if (!activeFlights || activeFlights.length === 0) {
          return res.status(404).json({ success: false, error: 'No active flight' });
        }
        const flight = this.formatFlightResponse(activeFlights[0]);
        const crewMembers = flight.crew?.members || [];

        const crewManager = new CrewProfileManager();
        const crewProfilesMap = {};
        for (const member of crewMembers) {
          const profileId = member.isMe ? 'my-pilot' : member.id; // captain always uses 'my-pilot'
          const result = crewManager.load(profileId);
          if (result.success && result.profile) crewProfilesMap[profileId] = result.profile;
        }

        let vaProfile = null;
        try {
          const vaProfilePath = path.join(__dirname, 'data', 'va-profiles', 'kahuna-air.json');
          if (fs.existsSync(vaProfilePath)) vaProfile = JSON.parse(fs.readFileSync(vaProfilePath, 'utf8'));
        } catch (e) {}

        const { crew_data, copilot_data, dispatcher_data } = siPayloadBuilder.assembleVAPayload(
          crewProfilesMap, crewMembers, flight, vaProfile, null
        );

        return res.json({
          success: true,
          note: 'Preview only — not sent to SI',
          crewMembers: crewMembers.map(m => ({ name: m.name, role: m.role, id: m.isMe ? 'my-pilot' : m.id, hasProfile: !!crewProfilesMap[m.isMe ? 'my-pilot' : m.id] })),
          sentPayload: { crew_data, copilot_data, dispatcher_data }
        });
      } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
      }
    });

    /**
     * GET /api/crew/{id}/si-format
     * Get crew profile formatted for SayIntentions.AI importVAData endpoint
     * 
     * Response:
     * {
     *   "success": true,
     *   "crewId": "uuid",
     *   "currentName": "string",
     *   "crew_data": "string (formatted for SI API)"
     * }
     */
    this.app.get('/api/crew/:crewId/si-format', (req, res) => {
      try {
        const CrewProfileManager = require('./crewProfileManager');
        const crewManager = new CrewProfileManager();
        const result = crewManager.load(req.params.crewId);

        if (!result.success) {
          return res.status(result.code || 500).json({
            success: false,
            error: result.error,
            recovery: result.recovery
          });
        }

        // Format crew data for SI API
        const siFormattedData = crewManager.formatCrewDataForSI(result.profile);

        res.json({
          success: true,
          crewId: req.params.crewId,
          currentName: result.profile.currentName,
          personality: result.profile.personality,
          crew_data: siFormattedData,
          message: 'Crew profile formatted for SI importVAData endpoint'
        });
      } catch (error) {
        console.error('[API /api/crew/{id}/si-format]', error.message);
        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    });

    // ===== PHASE 4: VA PROFILE MANAGEMENT ENDPOINTS =====
    // Store and retrieve single VA profile
    // Persists to %APPDATA%\KahunaAir\profiles\va-profile.json

    /**
     * GET /api/va/profile
     * Load VA profile (returns single profile or indicates no profile exists)
     * 
     * Response:
     * {
     *   "success": true/false,
     *   "profile": { VA profile object },
     *   "exists": true/false,
     *   "message": "string"
     * }
     */
    this.app.get('/api/va/profile', (req, res) => {
      try {
        const VAProfileManager = require('./vaProfileManager');
        const vaManager = new VAProfileManager();
        const result = vaManager.load();

        if (!result.success && !result.exists) {
          // No profile found
          return res.status(404).json({
            success: false,
            exists: false,
            profile: null,
            message: result.message,
            recovery: result.recovery
          });
        }

        if (!result.success) {
          // Error loading profile
          return res.status(result.code || 500).json({
            success: false,
            error: result.error,
            recovery: result.recovery
          });
        }

        // Profile found
        res.json({
          success: true,
          exists: true,
          profile: result.profile,
          message: result.message,
          lastUpdated: result.lastUpdated
        });
      } catch (error) {
        console.error('[API /api/va/profile GET]', error.message);
        res.status(500).json({
          success: false,
          error: error.message,
          recovery: 'Check logs for profile loading error'
        });
      }
    });

    /**
     * POST /api/va/profile
     * Save or update VA profile
     * 
     * Required body:
     * {
     *   "companyId": "uuid",
     *   "vaId": "uuid",
     *   "name": "string",
     *   "callsign": "string",
     *   "about": "string",
     *   "personality": "formal|casual|humorous|standard",
     *   "dispatcherStyle": "string",
     *   "logo": "base64 or url (optional)",
     *   "customNotes": "string",
     *   "siKey": "string (SayIntentions.AI VA API key)"
     * }
     */
    this.app.post('/api/va/profile', (req, res) => {
      try {
        const VAProfileManager = require('./vaProfileManager');
        const vaManager = new VAProfileManager();
        const result = vaManager.save(req.body);

        if (!result.success) {
          return res.status(result.code || 500).json({
            success: false,
            error: result.error,
            recovery: result.recovery
          });
        }

        res.json({
          success: true,
          profile: result.profile,
          message: result.message,
          isNew: result.isNew,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        console.error('[API /api/va/profile POST]', error.message);
        res.status(500).json({
          success: false,
          error: error.message,
          recovery: 'Check logs. Verify VA profile data is valid JSON.'
        });
      }
    });

    /**
     * DELETE /api/va/profile
     * Delete VA profile (for testing/reset only)
     */
    this.app.delete('/api/va/profile', (req, res) => {
      try {
        const VAProfileManager = require('./vaProfileManager');
        const vaManager = new VAProfileManager();
        const result = vaManager.delete();

        if (!result.success) {
          return res.status(result.code || 500).json({
            success: false,
            error: result.error
          });
        }

        res.json({
          success: true,
          message: result.message
        });
      } catch (error) {
        console.error('[API /api/va/profile DELETE]', error.message);
        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    });

    /**
     * GET /api/va/si-format
     * Get VA profile formatted for SayIntentions.AI importVAData endpoint
     * 
     * Response:
     * {
     *   "success": true,
     *   "vaName": "string",
     *   "callsign": "string",
     *   "va_data": "string (formatted for SI API)"
     * }
     */
    this.app.get('/api/va/si-format', (req, res) => {
      try {
        const VAProfileManager = require('./vaProfileManager');
        const vaManager = new VAProfileManager();
        const result = vaManager.load();

        if (!result.success || !result.exists) {
          return res.status(404).json({
            success: false,
            error: 'VA profile not found',
            recovery: result.recovery
          });
        }

        // Format VA data for SI API
        const siFormattedData = vaManager.formatVADataForSI(result.profile);

        res.json({
          success: true,
          vaName: result.profile.name,
          callsign: result.profile.callsign,
          personality: result.profile.personality,
          va_data: siFormattedData,
          message: 'VA profile formatted for SI importVAData endpoint'
        });
      } catch (error) {
        console.error('[API /api/va/si-format]', error.message);
        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    });

    // ===== PHASE 4.5: DISPATCHER PROFILE MANAGEMENT ENDPOINTS =====
    // Store and retrieve company dispatcher profile
    // Persists to %APPDATA%\KahunaAir\profiles\dispatcher-profile.json

    /**
     * GET /api/dispatcher/profile
     * Load dispatcher profile (returns single profile or indicates no profile exists)
     * 
     * Response:
     * {
     *   "success": true/false,
     *   "profile": { dispatcher profile object },
     *   "exists": true/false,
     *   "message": "string"
     * }
     */
    this.app.get('/api/dispatcher/profile', async (req, res) => {
      try {
        const DispatcherProfileManager = require('./dispatcherProfileManager');
        const dispatcherManager = new DispatcherProfileManager();
        const result = await dispatcherManager.load();

        if (!result.success && !result.exists) {
          // No profile found
          return res.status(404).json({
            success: false,
            exists: false,
            profile: null,
            message: result.message
          });
        }

        if (!result.success) {
          // Error loading profile
          return res.status(500).json({
            success: false,
            error: result.message
          });
        }

        // Profile found
        res.json({
          success: true,
          exists: true,
          profile: result.profile,
          message: result.message
        });
      } catch (error) {
        console.error('[API /api/dispatcher/profile GET]', error.message);
        res.status(500).json({
          success: false,
          error: error.message,
          recovery: 'Check dispatcher profile storage'
        });
      }
    });

    /**
     * POST /api/dispatcher/profile
     * Save or update dispatcher profile
     * 
     * Required body:
     * {
     *   "companyName": "string",
     *   "dispatcherStyle": "professional|casual|formal|supportive",
     *   "contactName": "string",
     *   "contactEmail": "string",
     *   "contactPhone": "string",
     *   "operationalPolicies": "string",
     *   "weatherAlerts": boolean,
     *   "NOTAMTracking": boolean,
     *   "customNotes": "string",
     *   "siKey": "string (optional)"
     * }
     */
    this.app.post('/api/dispatcher/profile', async (req, res) => {
      try {
        const DispatcherProfileManager = require('./dispatcherProfileManager');
        const dispatcherManager = new DispatcherProfileManager();
        const result = await dispatcherManager.save(req.body);

        if (!result.success) {
          return res.status(500).json({
            success: false,
            error: result.message
          });
        }

        res.json({
          success: true,
          profile: result.profile,
          message: result.message,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        console.error('[API /api/dispatcher/profile POST]', error.message);
        res.status(500).json({
          success: false,
          error: error.message,
          recovery: 'Verify dispatcher profile data is valid JSON'
        });
      }
    });

    /**
     * DELETE /api/dispatcher/profile
     * Delete dispatcher profile (for testing/reset only)
     */
    this.app.delete('/api/dispatcher/profile', async (req, res) => {
      try {
        const DispatcherProfileManager = require('./dispatcherProfileManager');
        const dispatcherManager = new DispatcherProfileManager();
        const result = await dispatcherManager.delete();

        if (!result.success) {
          return res.status(500).json({
            success: false,
            error: result.message
          });
        }

        res.json({
          success: true,
          message: result.message
        });
      } catch (error) {
        console.error('[API /api/dispatcher/profile DELETE]', error.message);
        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    });

    /**
     * GET /api/dispatcher/si-format
     * Get dispatcher profile formatted for SayIntentions.AI importVAData endpoint
     * 
     * Response:
     * {
     *   "success": true,
     *   "dispatcherName": "string",
     *   "dispatcher_data": "string (formatted for SI API)"
     * }
     */
    this.app.get('/api/dispatcher/si-format', async (req, res) => {
      try {
        const DispatcherProfileManager = require('./dispatcherProfileManager');
        const dispatcherManager = new DispatcherProfileManager();
        const result = await dispatcherManager.load();

        if (!result.success || !result.exists) {
          return res.status(404).json({
            success: false,
            error: 'Dispatcher profile not found',
            recovery: 'Create a dispatcher profile first via POST /api/dispatcher/profile'
          });
        }

        // Format dispatcher data for SI API
        const siFormattedData = dispatcherManager.formatDispatcherDataForSI(result.profile);

        res.json({
          success: true,
          companyName: result.profile.companyName,
          dispatcherStyle: result.profile.dispatcherStyle,
          dispatcher_data: siFormattedData,
          message: 'Dispatcher profile formatted for SI importVAData endpoint'
        });
      } catch (error) {
        console.error('[API /api/dispatcher/si-format]', error.message);
        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    });

    // Construct SI importVAData payload from crew, VA, and dispatcher profiles (PHASE 5)
    this.app.post('/api/dispatch/payload', async (req, res) => {
      try {
        const SIPayloadConstructor = require('./siPayloadConstructor');
        const CrewProfileManager = require('./crewProfileManager');
        const VAProfileManager = require('./vaProfileManager');
        const DispatcherProfileManager = require('./dispatcherProfileManager');
        const credentialsManager = require('./credentialsManager');

        // 1. Get SI API key from settings (Phase 0)
        // Note: credentialsManager is not a class, it's an object with methods
        const siApiKey = process.env.SI_API_KEY || process.env.SAYINTENTIONS_API_KEY;

        if (!siApiKey || siApiKey.trim() === '') {
          return res.status(400).json({
            success: false,
            error: 'SI API key not configured',
            recovery: 'Set SI_API_KEY in environment variables or configure via settings',
            message: 'Cannot construct SI payload without SI API key'
          });
        }

        // 2. Load crew data string (from crew ID if provided, or all crew)
        let crewDataString = '';
        const crewIdParam = req.body.crewId;

        if (crewIdParam) {
          // Load single crew member
          const crewManager = new CrewProfileManager();
          const crewResult = await crewManager.load(crewIdParam);
          if (crewResult.success && crewResult.profile) {
            crewDataString = crewManager.formatCrewDataForSI(crewResult.profile);
          }
        } else {
          // Load all active crew (from current flight context if available)
          const CrewList = req.body.crewIds || [];
          const crewManager = new CrewProfileManager();

          if (CrewList.length > 0) {
            const crewDataList = [];
            for (const crewId of CrewList) {
              const crewResult = await crewManager.load(crewId);
              if (crewResult.success && crewResult.profile) {
                crewDataList.push(crewManager.formatCrewDataForSI(crewResult.profile));
              }
            }
            if (crewDataList.length > 0) {
              crewDataString = crewDataList.join('\n---\n');
            }
          }
        }

        // 3. Load VA data string
        let vaDataString = '';
        const vaManager = new VAProfileManager();
        const vaResult = await vaManager.load();
        if (vaResult.success && vaResult.exists && vaResult.profile) {
          vaDataString = vaManager.formatVADataForSI(vaResult.profile);
        }

        // 4. Load dispatcher data string
        let dispatcherDataString = '';
        const dispatcherManager = new DispatcherProfileManager();
        const dispatcherResult = await dispatcherManager.load();
        if (dispatcherResult.success && dispatcherResult.exists && dispatcherResult.profile) {
          dispatcherDataString = dispatcherManager.formatDispatcherDataForSI(dispatcherResult.profile);
        }

        // 5. Construct payload using SIPayloadConstructor
        const constructor = new SIPayloadConstructor(siApiKey);
        const payloadResult = await constructor.construct(
          crewDataString,
          vaDataString,
          dispatcherDataString
        );

        if (!payloadResult.success) {
          return res.status(400).json({
            success: false,
            error: payloadResult.message,
            errors: payloadResult.errors,
            recovery: 'Ensure at least crew, VA, or dispatcher profile is configured'
          });
        }

        // 6. Return complete payload ready for SI deployment
        res.json({
          success: true,
          payload: payloadResult.payload,
          message: payloadResult.message,
          dataTypes: payloadResult.dataTypes,
          stats: payloadResult.stats,
          validation: payloadResult.validation,
          nextStep: 'POST this payload to https://apipri.sayintentions.ai/sapi/importVAData',
          readyForDeployment: true
        });

      } catch (error) {
        console.error('[API /api/dispatch/payload]', error.message);
        res.status(500).json({
          success: false,
          error: error.message,
          message: 'Failed to construct SI payload'
        });
      }
    });

    // Deploy payload to SayIntentions.AI (PHASE 6)
    this.app.post('/api/dispatch/deploy', async (req, res) => {
      try {
        const SIDeploymentService = require('./siDeploymentService');

        // 1. Get user's SI API key from request or environment
        const userSIApiKey = req.body.siApiKey || process.env.USER_SI_API_KEY || process.env.SI_PERSONAL_KEY;

        if (!userSIApiKey || userSIApiKey.trim() === '') {
          return res.status(400).json({
            success: false,
            error: 'User SI API key not configured',
            recovery: 'Provide siApiKey in request body or set USER_SI_API_KEY environment variable',
            message: 'Cannot deploy to SI without user API key'
          });
        }

        // 2. Get payload from request or construct fresh
        let payload = req.body.payload;

        if (!payload) {
          // Construct payload from latest profiles
          const SIPayloadConstructor = require('./siPayloadConstructor');
          const CrewProfileManager = require('./crewProfileManager');
          const VAProfileManager = require('./vaProfileManager');
          const DispatcherProfileManager = require('./dispatcherProfileManager');
          const credentialsManager = require('./credentialsManager');

          // Get VA API key from settings
          const vaApiKey = process.env.SI_API_KEY;
          if (!vaApiKey) {
            return res.status(400).json({
              success: false,
              error: 'VA API key not configured',
              recovery: 'Configure SI_API_KEY in environment or settings',
              message: 'Cannot construct payload without VA API key'
            });
          }

          // Load crew, VA, dispatcher data
          let crewDataString = '';
          let vaDataString = '';
          let dispatcherDataString = '';

          const crewIds = req.body.crewIds || [];
          if (crewIds.length > 0) {
            const crewManager = new CrewProfileManager();
            const crewDataList = [];
            for (const crewId of crewIds) {
              const result = await crewManager.load(crewId);
              if (result.success && result.profile) {
                crewDataList.push(crewManager.formatCrewDataForSI(result.profile));
              }
            }
            crewDataString = crewDataList.join('\n---\n');
          }

          const vaManager = new VAProfileManager();
          const vaResult = await vaManager.load();
          if (vaResult.success && vaResult.exists) {
            vaDataString = vaManager.formatVADataForSI(vaResult.profile);
          }

          const dispatcherManager = new DispatcherProfileManager();
          const dispatcherResult = await dispatcherManager.load();
          if (dispatcherResult.success && dispatcherResult.exists) {
            dispatcherDataString = dispatcherManager.formatDispatcherDataForSI(dispatcherResult.profile);
          }

          // Construct payload
          const constructor = new SIPayloadConstructor(vaApiKey);
          const constructResult = await constructor.construct(crewDataString, vaDataString, dispatcherDataString);

          if (!constructResult.success) {
            return res.status(400).json({
              success: false,
              error: 'Failed to construct payload',
              errors: constructResult.errors,
              message: constructResult.message
            });
          }

          payload = constructResult.payload;
        }

        // 3. Deploy payload to SI
        const deployment = new SIDeploymentService(userSIApiKey);
        const deployResult = await deployment.deploy(payload);

        // 4. Return deployment result
        if (deployResult.success) {
          res.json({
            success: true,
            deployed: true,
            message: deployResult.message,
            timestamp: deployResult.timestamp,
            payloadStats: deployResult.payloadStats,
            siResponse: deployResult.siResponse,
            recoveryInfo: deployResult.recoveryInfo,
            nextStep: 'Monitor SI dashboard for data updates (5-10 minutes)'
          });
        } else {
          res.status(400).json({
            success: false,
            error: deployResult.error,
            errorMessage: deployResult.errorMessage,
            message: deployResult.message,
            recovery: deployResult.recovery,
            canRetry: deployResult.retry
          });
        }

      } catch (error) {
        console.error('[API /api/dispatch/deploy]', error.message);
        res.status(500).json({
          success: false,
          error: 'Deployment failed',
          message: error.message
        });
      }
    });

    // Get dispatch summary (optimized response)
    this.app.get('/api/dispatch/summary', async (req, res) => {
      const timeoutHandle = setTimeout(() => {
        if (!res.headersSent) {
          res.status(504).json({
            success: false,
            error: 'Request timeout'
          });
        }
      }, 12000);

      try {
        const summary = await this.flightService.getDispatchSummary();
        clearTimeout(timeoutHandle);
        res.json({
          success: true,
          data: summary
        });
      } catch (error) {
        clearTimeout(timeoutHandle);
        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    });

    // DEBUG: Show jobs with cargo/passengers for debugging
    this.app.get('/api/dispatch/cargo-summary', async (req, res) => {
      try {
        const jobsWithCargo = await this.flightService.getJobsWithCargoSummary();
        res.json({
          success: true,
          jobsWithCargo: jobsWithCargo
        });
      } catch (error) {
        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    });

    // DEBUG: Detailed flight detection diagnostics
    this.app.get('/api/dispatch/debug', async (req, res) => {
      try {
        const allFlights = await this.flightService.getAllKahunaFlights();

        const diagnostics = {
          timestamp: new Date().toISOString(),
          credentials: {
            companyId: this.flightService.companyId ? '***' : 'not set',
            hasApiKey: !!this.flightService.apiKey
          },
          flightsReturned: allFlights.length,
          flightDetails: allFlights.map((flight, idx) => {
            const crewList = flight.FlightCrews || [];
            const kahunaCrewCount = crewList.filter(c => c.People?.CompanyId === '5597c4b6-8f0b-4bbd-a13e-42f8a6e04026').length;
            const isKahuna = kahunaCrewCount > 0;
            const isActive = !!(flight.StartTime || flight.EngineOnTime || flight.AirborneTime);

            return {
              index: idx,
              id: flight.Id,
              aircraft: flight.Aircraft?.AircraftType?.Name || 'Unknown',
              route: `${flight.DepartureAirport} → ${flight.ArrivalIntendedAirport}`,
              crewCount: crewList.length,
              kahunaCrewCount,
              isKahunaFlight: isKahuna,
              timingFields: {
                StartTime: flight.StartTime || null,
                EngineOnTime: flight.EngineOnTime || null,
                AirborneTime: flight.AirborneTime || null,
                TouchDownTime: flight.TouchDownTime || null,
                Registered: flight.Registered || false
              },
              isActive,
              reason: !isKahuna ? 'No Kahuna crew found' : !isActive ? 'No timing fields set (waiting for MSFS?)' : 'Should be active'
            };
          })
        };

        res.json({
          success: true,
          data: diagnostics
        });
      } catch (error) {
        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    });

    // DEBUG: Raw OnAir flight data dump (all fields)
    this.app.get('/api/debug/raw-flight', async (req, res) => {
      try {
        const allFlights = await this.flightService.getAllKahunaFlights();
        if (allFlights.length === 0) {
          return res.json({
            success: false,
            error: 'No flights found'
          });
        }

        // Return full raw OnAir data for first flight
        const flight = allFlights[0];
        res.json({
          success: true,
          flight: flight,
          flightKeys: Object.keys(flight).sort()
        });
      } catch (error) {
        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    });

    // DEBUG: Show all available fields in raw OnAir flight object
    this.app.get('/api/debug/flight-fields', async (req, res) => {
      try {
        const allFlights = await this.flightService.getAllKahunaFlights();
        if (allFlights.length === 0) {
          return res.json({
            success: false,
            error: 'No flights found'
          });
        }

        // Get the first active flight and show all available fields
        const flight = allFlights[0];
        const allKeys = Object.keys(flight).sort();

        // Show which fields might contain cargo/passenger details
        const cargoRelated = allKeys.filter(k =>
          k.toLowerCase().includes('cargo') ||
          k.toLowerCase().includes('hazmat') ||
          k.toLowerCase().includes('dangerous') ||
          k.toLowerCase().includes('type')
        );

        const passengerRelated = allKeys.filter(k =>
          k.toLowerCase().includes('passenger') ||
          k.toLowerCase().includes('pax')
        );

        // Get a sample of all field values for inspection
        const sampleValues = {};
        allKeys.forEach(k => {
          const val = flight[k];
          // Show first 100 chars of value
          if (typeof val === 'object') {
            sampleValues[k] = JSON.stringify(val).substring(0, 100);
          } else {
            sampleValues[k] = String(val).substring(0, 100);
          }
        });

        res.json({
          success: true,
          totalFields: allKeys.length,
          allAvailableFields: allKeys,
          cargoRelatedFields: cargoRelated,
          passengerRelatedFields: passengerRelated,
          sampleValues: sampleValues
        });
      } catch (error) {
        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    });

    // Get current/most recent active flight for frontend
    this.app.get('/api/flights/current', async (req, res) => {
      const startTime = Date.now();
      try {
        console.log('[API /flights/current] ▶ Starting request at', new Date().toISOString());

        const flightServiceStart = Date.now();
        const activeFlights = await this.flightService.getActiveKahunaFlights();
        const flightServiceDuration = Date.now() - flightServiceStart;
        console.log(`[API /flights/current] ✓ getActiveKahunaFlights took ${flightServiceDuration}ms, got ${activeFlights?.length || 0} flights`);

        if (!activeFlights || activeFlights.length === 0) {
          const totalDuration = Date.now() - startTime;
          console.log(`[API /flights/current] ✓ Responding after ${totalDuration}ms with: No active flights`);
          return res.json({
            success: true,
            flight: null,
            message: 'No active flights found'
          });
        }

        // Get the most recent active flight (first one)
        const flight = activeFlights[0];
        console.log(`[API /flights/current] ✓ Processing flight ID: ${flight.Id}`);

        // Build crew array first to extract SI key
        const crewArray = (flight.FlightCrews || []).map(c => {
          // Skip console.log here - it's slow
          // console.log('[API] Processing crew member:', JSON.stringify(c, null, 2));

          // Map role numbers to crew titles (since names aren't consistently provided)
          const getRoleTitle = (role) => {
            switch (role) {
              case 0: return 'Captain';
              case 1: return 'First Officer';
              case 2: return 'Flight Attendant';
              default: return `Crew Member ${role}`;
            }
          };

          const crewRole = c.People?.Role || c.Role || 2;
          const crewName = c.People?.Name || c.Name || getRoleTitle(crewRole);

          return {
            id: c.People?.Id || c.Id,
            name: crewName,
            role: crewRole,
            companyId: c.People?.CompanyId || c.CompanyId,
            siKey: c.People?.Company?.SayIntentionsPilotKey || c.SayIntentionsPilotKey
          };
        });

        // Extract SI key from first crew member
        const flightSiKey = crewArray[0]?.siKey || process.env.SI_API_KEY || 'None';

        // Format the response to match frontend expectations
        const formattedFlight = {
          id: flight.Id,
          flightNumber: `${flight.FlightNumber || 'N/A'}`,
          aircraft: {
            id: flight.AircraftId,
            type: flight.Aircraft?.AircraftType?.Name || 'Unknown',
            registration: flight.Aircraft?.Registration || 'N/A'
          },
          route: {
            departure: {
              ICAO: flight.DepartureAirport?.ICAO || 'DEP',
              name: flight.DepartureAirport?.Name || 'Unknown',
              city: flight.DepartureAirport?.City || ''
            },
            arrival: {
              ICAO: flight.ArrivalIntendedAirport?.ICAO || 'ARR',
              name: flight.ArrivalIntendedAirport?.Name || 'Unknown',
              city: flight.ArrivalIntendedAirport?.City || ''
            }
          },
          timing: {
            startTime: flight.StartTime,
            engineOnTime: flight.EngineOnTime,
            airborneTime: flight.AirborneTime,
            touchDownTime: flight.TouchDownTime
          },
          crew: crewArray,
          registered: flight.Registered,
          status: flight.AirborneTime ? 'AIRBORNE' : 'GROUND',
          siKey: flightSiKey
        };


        // Log crew data for debugging
        console.log('[API] Flight crew from OnAir:')
        console.log('[API]   FlightCrews exists:', !!flight.FlightCrews)
        console.log('[API]   FlightCrews length:', flight.FlightCrews?.length || 0)
        if (flight.FlightCrews && flight.FlightCrews.length > 0) {
          console.log('[API]   Crew members forwarded to frontend:')
          formattedFlight.crew.forEach((c, i) => {
            console.log(`[API]     [${i}] ${c.name || '(no name)'} (${c.role || '(no role)'}) - ID: ${c.id || '(no id)'}`)
          })
        } else {
          console.log('[API]   ⚠️  No crew data received from OnAir')
        }

        // ── Staged cargo loading ─────────────────────────────────────────
        // Only fetch cargo once StartTime is set (player has clicked Fly Now).
        // Poll the jobs API at 60-second intervals until cargo is found.
        // Once found, cache it for the duration of the flight.
        const CARGO_POLL_INTERVAL_MS = 60000;
        const flightId = flight.Id;
        const hasStartTime = !!flight.StartTime;
        const hasEngineOnTime = !!flight.EngineOnTime;
        const now = Date.now();

        // Reset state when a new flight is detected
        if (this.cargoState.flightId !== flightId) {
          console.log(`[API /flights/current] New flight detected (${flightId}), resetting cargo state`);
          this.cargoState = {
            flightId,
            cargoCharter: null,
            cargoStatus: 'IDLE',
            lastCargoFetch: null
          };
        }

        if (!hasStartTime) {
          // Flight exists in OA but Fly Now hasn't been pressed yet
          this.cargoState.cargoStatus = 'AWAITING_OA_START';
        } else if (this.cargoState.cargoStatus !== 'READY') {
          // StartTime is set — determine if it's time to poll
          const timeSinceLastFetch = this.cargoState.lastCargoFetch
            ? now - this.cargoState.lastCargoFetch
            : Infinity;
          const shouldFetch = timeSinceLastFetch >= CARGO_POLL_INTERVAL_MS;

          if (shouldFetch) {
            try {
              const ccStart = Date.now();
              console.log(`[API /flights/current] ▶ Polling cargo/charter (StartTime set, ${hasEngineOnTime ? 'engines on' : 'pre-engine'})`);
              this.cargoState.lastCargoFetch = now;

              const result = await matchCargoCharterForActiveFlight(flight, this.credentials);
              const ccDuration = Date.now() - ccStart;

              if (result.cargos.length > 0 || result.charters.length > 0) {
                // Cargo found — cache and mark ready
                this.cargoState.cargoCharter = result;
                this.cargoState.cargoStatus = 'READY';
                console.log(`[API /flights/current] ✓ Cargo READY in ${ccDuration}ms: ${result.cargos.length} cargos, ${result.charters.length} charters`);
              } else if (hasEngineOnTime) {
                // Engines are on but no cargo — this is genuinely a no-cargo flight
                this.cargoState.cargoCharter = result;
                this.cargoState.cargoStatus = 'READY';
                console.log(`[API /flights/current] ✓ Engines on, no cargo found — marking READY (empty flight)`);
              } else {
                // StartTime set but no cargo yet and no engine on — keep polling
                this.cargoState.cargoStatus = 'LOADING';
                console.log(`[API /flights/current] ℹ Cargo not yet available, will retry in ${CARGO_POLL_INTERVAL_MS / 1000}s`);
              }
            } catch (err) {
              console.warn(`[API /flights/current] ⚠️  Cargo fetch failed: ${err.message}`);
              this.cargoState.cargoStatus = 'LOADING';
            }
          } else {
            const remaining = Math.round((CARGO_POLL_INTERVAL_MS - timeSinceLastFetch) / 1000);
            console.log(`[API /flights/current] ⏳ Cargo poll in ${remaining}s (status: ${this.cargoState.cargoStatus})`);
          }
        }

        formattedFlight.cargoCharter = this.cargoState.cargoCharter;
        formattedFlight.cargoStatus = this.cargoState.cargoStatus;

        console.log(`[API /flights/current] ✓ Sending response (${Date.now() - startTime}ms)`);
        res.json({
          success: true,
          flight: formattedFlight
        });
      } catch (error) {
        console.error(`[API /flights/current] ✗ ERROR after ${Date.now() - startTime}ms:`, error.message);
        res.status(500).json({
          success: false,
          error: error.message,
          flight: null
        });
      }
    });

    // Get specific flight by ID
    this.app.get('/api/flights/:flightId', async (req, res) => {
      const timeoutHandle = setTimeout(() => {
        if (!res.headersSent) {
          res.status(504).json({
            success: false,
            error: 'Request timeout'
          });
        }
      }, 12000);

      try {
        const flight = await this.flightService.getActiveFlight(req.params.flightId);
        clearTimeout(timeoutHandle);

        if (!flight) {
          return res.status(404).json({
            success: false,
            error: 'Flight not found'
          });
        }
        res.json({
          success: true,
          flight: this.formatFlightResponse(flight)
        });
      } catch (error) {
        clearTimeout(timeoutHandle);
        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    });

    // Load flight to SayIntentions.AI
    this.app.post('/api/dispatch/load', async (req, res) => {
      try {
        const { flightId, preferences } = req.body;
        if (!flightId) {
          return res.status(400).json({
            success: false,
            error: 'flightId required'
          });
        }

        // Logging disabled to reduce I/O overhead
        // console.log(`[Dispatch] Loading flight ${flightId}...`);

        // Get flight data
        const flight = await this.flightService.getActiveFlight(flightId);
        if (!flight) {
          return res.status(404).json({
            success: false,
            error: 'Flight not found'
          });
        }

        // Get VA API Key from flight crew
        const vaApiKey = this.flightService.getSayIntentionsKey(flight);
        if (!vaApiKey) {
          return res.status(400).json({
            success: false,
            error: 'No SayIntentions key found for this flight'
          });
        }

        // Logging disabled to reduce I/O overhead
        // console.log(`[Dispatch] Found VA key: ${vaApiKey.substring(0, 4)}...`);

        // Get saved preferences or use provided ones
        const savedPrefs = this.dispatchPreferences[flightId] || {};
        const finalPreferences = {
          ...savedPrefs,
          ...preferences
        };

        // Logging disabled to reduce I/O overhead
        // console.log(`[Dispatch] Applying preferences:`, finalPreferences);

        // Transform and dispatch to SI
        const dispatchResult = await this.siDispatch.dispatchFlight(
          flight,
          vaApiKey,
          finalPreferences
        );

        // Logging disabled to reduce I/O overhead
        // console.log(`[Dispatch] SI dispatch successful`);

        // Return success with integration details
        res.json({
          success: true,
          message: 'Flight dispatched to SayIntentions.AI',
          transformed: dispatchResult.transformed,
          integration: {
            flightId,
            siKey: vaApiKey,
            siBaseUrl: 'https://apipri.sayintentions.ai/sapi/',
            aircraft: {
              id: flight.AircraftId,
              type: flight.Aircraft?.AircraftType?.Name
            },
            route: {
              departure: flight.DepartureAirport,
              arrival: flight.ArrivalIntendedAirport
            },
            crew: {
              count: flight.FlightCrews?.length || 0,
              kahunaCrewCount: flight.FlightCrews?.filter(
                c => c.People?.CompanyId === '5597c4b6-8f0b-4bbd-a13e-42f8a6e04026'
              ).length || 0
            },
            appliedPreferences: finalPreferences,
            siResponse: dispatchResult.siResponse
          }
        });
      } catch (error) {
        console.error(`[Dispatch] Error:`, error.message);
        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    });

    // Save dispatch preferences endpoint
    this.app.post('/api/dispatch/preferences', (req, res) => {
      try {
        const { flightId, preferences } = req.body;
        if (!flightId) {
          return res.status(400).json({
            success: false,
            error: 'flightId required'
          });
        }

        // Store preferences (in-memory storage; can be upgraded to database)
        this.dispatchPreferences[flightId] = {
          ...this.dispatchPreferences[flightId],
          ...preferences
        };

        res.json({
          success: true,
          message: 'Preferences saved',
          flightId,
          preferences: this.dispatchPreferences[flightId],
          personalityOptions: this.siDispatch.getPersonalityOptions()
        });
      } catch (error) {
        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    });

    // Get SI personality options endpoint
    this.app.get('/api/dispatch/personality-options', (req, res) => {
      res.json({
        success: true,
        options: this.siDispatch.getPersonalityOptions()
      });
    });

    // ===== PHASE 2: DISPATCH ORCHESTRATOR ENDPOINTS =====

    /**
     * Load flight with full profile orchestration
     * Phase 2 version - uses Profile Services
     */
    this.app.post('/api/dispatch/load-v2', async (req, res) => {
      try {
        const { flightId, vaId } = req.body;

        if (!flightId || !vaId) {
          return res.status(400).json({
            success: false,
            error: 'flightId and vaId required'
          });
        }

        const result = await this.dispatcher.loadFlightForDispatch(flightId, vaId);

        res.json({
          success: true,
          context: result.context,
          validation: result.validation
        });
      } catch (error) {
        console.error('[/api/dispatch/load-v2] Error:', error.message);
        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    });

    /**
     * Get current flight session data
     */
    this.app.get('/api/dispatch/session', (req, res) => {
      try {
        const session = this.dispatcher.getSessionData();

        if (!session) {
          return res.json({
            success: true,
            data: null,
            message: 'No active session'
          });
        }

        // Transform session data to match frontend expectations
        const responseData = {
          flightId: session.flight?.id || session.flightId,
          va: {
            name: session.va?.name || session.vaProfile?.name,
            callsign: session.va?.callsign || session.vaProfile?.callsign
          },
          crew: session.crew?.map(c => ({
            peopleId: c.peopleId,
            name: c.name,
            role: c.role,
            seniorityRank: c.seniorityRank
          })) || [],
          flight: {
            departure: session.flight?.departure,
            arrival: session.flight?.arrival,
            aircraft: session.flight?.aircraft
          },
          readiness: {
            isReady: true,
            missing: []
          }
        };

        res.json({
          success: true,
          data: responseData
        });
      } catch (error) {
        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    });

    /**
     * Validate current session readiness
     * Checks crew profiles, crew roles, VA profile completeness
     */
    this.app.get('/api/dispatch/validate', (req, res) => {
      try {
        const validation = this.dispatcher.validateCurrentSession();

        // Transform validation to match frontend expectations
        const responseData = {
          valid: validation.ready || validation.valid,
          ready: validation.ready,
          summary: validation.summary || (validation.ready ? '✅ All profiles complete' : '❌ Missing profiles'),
          missingCount: validation.warnings?.length || 0,
          crewStatus: {},
          errors: validation.errors || [],
          warnings: validation.warnings || []
        };

        res.json({
          success: true,
          data: responseData
        });
      } catch (error) {
        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    });

    /**
     * Update crew profile (edit customization)
     */
    this.app.post('/api/dispatch/profiles/:peopleId', (req, res) => {
      try {
        const { peopleId } = req.params;
        const updates = req.body;

        if (!peopleId) {
          return res.status(400).json({
            success: false,
            error: 'peopleId required'
          });
        }

        const result = this.dispatcher.updateCrewProfile(peopleId, updates);

        res.json({
          success: true,
          profile: result.profile
        });
      } catch (error) {
        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    });

    /**
     * Update VA profile
     */
    this.app.post('/api/dispatch/va-profile', (req, res) => {
      try {
        const { vaId } = req.body;
        const updates = { ...req.body };
        delete updates.vaId; // Remove vaId from updates

        if (!vaId) {
          return res.status(400).json({
            success: false,
            error: 'vaId required'
          });
        }

        const result = this.dispatcher.updateVAProfile(vaId, updates);

        res.json({
          success: true,
          profile: result.profile
        });
      } catch (error) {
        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    });

    /**
     * Build dispatch payload for SayIntentions.AI
     */
    this.app.post('/api/dispatch/payload', (req, res) => {
      try {
        const customization = req.body.customization || {};

        const result = this.dispatcher.buildDispatchPayload(customization);

        res.json({
          success: true,
          payload: result.payload,
          validation: result.validation
        });
      } catch (error) {
        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    });

    /**
     * End flight session
     * Clears all session data and crew profiles from memory
     */
    this.app.post('/api/dispatch/end-flight', (req, res) => {
      try {
        const result = this.dispatcher.endFlight();

        res.json({
          success: true,
          message: result.message,
          endedFlight: result.endedFlight
        });
      } catch (error) {
        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    });

    /**
     * Deploy to SayIntentions.AI
     * Sends customized crew data to SI API to customize flight operations
     */
    this.app.post('/api/dispatch/deploy-to-si', async (req, res) => {
      try {
        const { vaApiKey } = req.body || {};

        // Check if there's an active session
        const sessionData = this.dispatcher.getSessionData();
        if (!sessionData) {
          return res.status(400).json({
            success: false,
            error: 'No active flight session'
          });
        }

        // ✅ P0 INTEGRATION: Validate readiness before allowing dispatch
        console.log('[DispatchServer] Validating session readiness before SI deployment...');
        const validation = DispatchValidator.validateReadiness(sessionData);

        if (!validation.ready) {
          console.log('[DispatchServer] Validation failed - blocking deployment');
          console.log('[DispatchServer] Errors:', validation.errors);
          console.log('[DispatchServer] Warnings:', validation.warnings);
          return res.status(400).json({
            success: false,
            error: 'Flight not ready for dispatch',
            details: {
              ready: validation.ready,
              errors: validation.errors,
              warnings: validation.warnings,
              crewProfiles: validation.details?.crew || [],
              vaProfile: validation.details?.va || null
            },
            hint: 'All crew and VA profiles must be created before dispatch. Check crew customization panel.'
          });
        }

        console.log('[DispatchServer] ✅ Session validation passed - proceeding with SI deployment');

        // Get the payload that will be sent to SI
        const payloadResult = this.dispatcher.buildDispatchPayload();
        if (!payloadResult || !payloadResult.payload) {
          return res.status(400).json({
            success: false,
            error: 'Unable to build dispatch payload'
          });
        }

        // Get crew member's SI API key
        // Try multiple sources for SI API key
        let siApiKey = vaApiKey;

        // Fallback 1: Try to get from FlightSessionManager's stored SI flight data
        if (!siApiKey) {
          try {
            const FlightSessionManager = require('./services/FlightSessionManager');
            const session = FlightSessionManager.getSessionData();
            if (session && session.siFlightData && session.siFlightData.FlightCrews && session.siFlightData.FlightCrews.length > 0) {
              const captainData = session.siFlightData.FlightCrews.find(c => c.Role === 0) || session.siFlightData.FlightCrews[0];
              if (captainData && captainData.People && captainData.People.SayIntentionsPilotKey) {
                siApiKey = captainData.People.SayIntentionsPilotKey;
                console.log('[DispatchServer] Retrieved SI API key from flight crew data');
              }
            }
          } catch (e) {
            console.error('[DispatchServer] Failed to get SI key from flight data:', e.message);
          }
        }

        // Fallback 2: Use SI API key from environment
        if (!siApiKey) {
          siApiKey = process.env.SI_API_KEY;
          if (siApiKey) {
            console.log('[DispatchServer] Using SI API key from environment');
          }
        }

        if (!siApiKey) {
          return res.status(400).json({
            success: false,
            error: 'No SayIntentions.AI API key available. Please check environment configuration.'
          });
        }

        // Create SI client and send payload
        const { SayIntentionsAIClient } = require('./apiClients');
        const siClient = new SayIntentionsAIClient(siApiKey);

        // Call importVAData with the dispatch payload
        const siResponse = await siClient.importVAData(siApiKey, payloadResult.payload);

        // Log successful deployment
        console.log('[DispatchServer] Successfully deployed to SayIntentions.AI');
        console.log('[DispatchServer] Payload size:', JSON.stringify(payloadResult.payload).length, 'bytes');

        res.json({
          success: true,
          message: 'Crew customizations sent to SayIntentions.AI',
          deployment: {
            timestamp: new Date().toISOString(),
            crewSize: sessionData.crew ? sessionData.crew.length : 0,
            vaName: sessionData.va?.name || 'Unknown',
            flightDeparture: sessionData.flight?.departure
          },
          siResponse: siResponse
        });
      } catch (error) {
        console.error('[DispatchServer] SI deployment failed:', error.message);
        res.status(500).json({
          success: false,
          error: error.message,
          hint: 'Check that SayIntentions.AI API is available and SI API key is configured'
        });
      }
    });

    // ===== DIAGNOSTIC ENDPOINTS =====

    // SI Crew Settings Diagnostic
    // Reads what crew data is currently stored in SI and compares with what we sent
    this.app.get('/api/diagnostic/crew-settings', async (req, res) => {
      try {
        const SICrewDiagnostic = require('./siCrewDiagnostic');
        const diagnostic = new SICrewDiagnostic(process.env.SI_API_KEY);

        // Read what's currently in SI's flight.json
        let siFlightJson = null;
        let crewInfo = null;

        try {
          siFlightJson = await diagnostic.readSIFlightJson();
          if (siFlightJson && siFlightJson.success) {
            crewInfo = diagnostic.extractCrewFromFlightJson(siFlightJson);
          }
        } catch (err) {
          // Silently handle SI flight.json read errors
          siFlightJson = {
            success: false,
            error: err.message
          };
        }

        // Get the flight for comparison
        let currentFlight = null;
        let dispatchedData = null;

        try {
          const flights = await this.flightService.getActiveKahunaFlights();
          if (flights && flights.length > 0) {
            currentFlight = flights[0];
            dispatchedData = diagnostic.logDispatchPayload(
              currentFlight,
              this.dispatchPreferences[currentFlight.Id] || {}
            );
          }
        } catch (err) {
          // Silently handle flight retrieval errors
        }

        res.json({
          success: true,
          timestamp: new Date().toISOString(),
          siFlightJsonStatus: siFlightJson || { success: false, error: 'Could not read SI flight.json' },
          extractedCrewInfo: crewInfo,
          lastDispatchedData: dispatchedData,
          currentFlight: currentFlight ? {
            id: currentFlight.Id,
            number: currentFlight.FlightNumber,
            route: `${currentFlight.DepartureAirport} → ${currentFlight.ArrivalIntendedAirport}`,
            aircraft: currentFlight.Aircraft?.AircraftType?.Name
          } : null,
          diagnostic: 'Use this to compare what we sent to SI vs what SI currently has loaded'
        });
      } catch (error) {
        res.status(500).json({
          success: false,
          error: error.message,
          stack: error.stack
        });
      }
    });

    // Clear cache endpoint
    this.app.post('/api/admin/cache-clear', (req, res) => {
      this.flightService.clearCache();
      res.json({ success: true, message: 'Cache cleared' });
    });

    // Graceful shutdown endpoint
    this.app.post('/api/admin/shutdown', (req, res) => {
      console.log('[Server] Shutdown requested from frontend');
      res.json({ success: true, message: 'Shutting down...' });

      // Give response time to send back (50ms)
      setTimeout(() => {
        console.log('[Server] Performing graceful shutdown...');

        // Disconnect SimConnect if available
        try {
          if (typeof simConnectService !== 'undefined' && simConnectService) {
            console.log('[Server] Disconnecting SimConnect...');
            simConnectService.disconnect();
          }
        } catch (error) {
          console.error('[Server] Error disconnecting SimConnect:', error.message);
        }

        // Close all listeners
        console.log('[Server] Closing server...');
        process.exit(0);
      }, 50);
    });

    // ===== LOGGING ENDPOINTS =====

    // Receive frontend logs from browser console
    this.app.post('/api/logs/frontend', (req, res) => {
      try {
        const { logs } = req.body;
        if (Array.isArray(logs)) {
          logs.forEach(log => {
            const { timestamp, level, message, data, url } = log;
            const prefix = url ? `[${url}]` : '[BROWSER]';
            const fullMessage = `${prefix} ${message}`;

            if (level === 'ERROR') {
              logger.error(fullMessage, data);
            } else if (level === 'WARN') {
              logger.warn(fullMessage, data);
            } else if (level === 'DEBUG') {
              logger.debug(fullMessage, data);
            } else {
              logger.info(fullMessage, data);
            }
          });
        }
        res.json({ success: true, received: logs?.length || 0 });
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // Get recent server logs
    this.app.get('/api/logs/server', (req, res) => {
      try {
        const lines = parseInt(req.query.lines) || 100;
        const logContent = logger.getRecentLogs(lines);
        res.json({
          success: true,
          logs: logContent,
          path: logger.getLogPath()
        });
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // Get log file path
    this.app.get('/api/logs/path', (req, res) => {
      res.json({
        success: true,
        path: logger.getLogPath()
      });
    });

    // ===== SI FLIGHT.JSON INTEGRATION =====

    // Diagnostic: List files in SI directory
    this.app.get('/api/si-flight-json/diagnostic', (req, res) => {
      try {
        const fs = require('fs');
        const path = require('path');
        const os = require('os');

        // Debug logging
        const debugInfo = {
          platform: process.platform,
          home: os.homedir(),
          localappdata: process.env.LOCALAPPDATA,
          appdata: process.env.APPDATA
        };
        console.log('[SI Diagnostic]', JSON.stringify(debugInfo, null, 2));

        let siDir;
        let directories = [];

        if (process.platform === 'win32') {
          siDir = path.join(
            process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'),
            'SayIntentionsAI'
          );
          directories = [siDir];
        } else if (process.platform === 'darwin') {
          siDir = path.join(os.homedir(), 'Library', 'Application Support', 'SayIntentionsAI');
          directories = [siDir];
        } else {
          // Linux - check both Linux and WSL Windows paths
          const linuxDir = path.join(os.homedir(), '.config', 'SayIntentionsAI');
          const wslWindowsDir = '/mnt/c/Users/leo/AppData/Local/SayIntentionsAI';
          directories = [wslWindowsDir, linuxDir];
          siDir = linuxDir;
        }

        // Try to find the first directory that exists
        let diagnostic = null;

        for (const dir of directories) {
          if (fs.existsSync(dir)) {
            const files = fs.readdirSync(dir, { withFileTypes: true });
            diagnostic = {
              siDirectory: dir,
              directoryExists: true,
              files: files.map(f => ({
                name: f.name,
                isDirectory: f.isDirectory(),
                size: f.isFile() ? fs.statSync(path.join(dir, f.name)).size : null
              }))
            };
            break;
          }
        }

        // If no directory found, return details about what was checked
        if (!diagnostic) {
          diagnostic = {
            siDirectory: siDir,
            directoryExists: false,
            checkedDirectories: directories,
            files: [],
            help: 'No SI directory found. Make sure SayIntentions.AI is installed and has an active flight.'
          };
        }

        res.json(diagnostic);
      } catch (error) {
        res.status(500).json({
          error: error.message,
          stack: error.stack
        });
      }
    });

    // Read flight.json from SayIntentions.AI local directory
    // Re-enabled with timeout protection to prevent resource exhaustion
    this.app.get('/api/si-flight-json', (req, res) => {
      try {
        const fs = require('fs');
        const path = require('path');
        const os = require('os');

        let siDir;
        if (process.platform === 'win32') {
          siDir = path.join(
            process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'),
            'SayIntentionsAI'
          );
        } else if (process.platform === 'darwin') {
          siDir = path.join(os.homedir(), 'Library', 'Application Support', 'SayIntentionsAI');
        } else {
          // Linux
          siDir = path.join(os.homedir(), '.config', 'SayIntentionsAI');
        }

        const flightJsonPath = path.join(siDir, 'flight.json');

        if (!fs.existsSync(flightJsonPath)) {
          return res.status(404).json({
            success: false,
            error: 'flight.json not found',
            details: `Expected location: ${flightJsonPath}`
          });
        }

        // Read file with timeout protection
        const fileContent = fs.readFileSync(flightJsonPath, 'utf8', { timeout: 5000 });
        const flightData = JSON.parse(fileContent);

        res.json({
          success: true,
          flight_details: flightData,
          source: 'SI flight.json'
        });
      } catch (error) {
        if (error.code === 'ENOENT') {
          return res.status(404).json({
            success: false,
            error: 'SI flight.json not found - ensure SayIntentions.AI is running with an active flight'
          });
        }

        if (error instanceof SyntaxError) {
          return res.status(400).json({
            success: false,
            error: 'Invalid JSON in SI flight.json',
            message: error.message
          });
        }

        res.status(500).json({
          success: false,
          error: 'Failed to read SI flight.json',
          message: error.message
        });
      }
    });

    // SPA fallback: serve index.html for any non-API routes
    const path = require('path');
    const fs = require('fs');
    const frontendPath = path.join(__dirname, '..', 'frontend', 'dist');
    const indexPath = path.join(frontendPath, 'index.html');

    // Fallback handler for SPA routing - must be last
    this.app.use((req, res) => {
      // Don't serve index.html for /api/* routes
      if (req.path.startsWith('/api')) {
        return res.status(404).json({
          success: false,
          error: 'Endpoint not found'
        });
      }

      // Serve index.html for all other routes (SPA routing)
      if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
      } else {
        res.status(404).json({
          success: false,
          error: 'Frontend not found'
        });
      }
    });
  }

  formatFlightResponse(flight) {
    // Load configured oaPilotId from settings — used as primary isMe indicator.
    // Evaluated once here (require() is cached) before the crew map.
    let configuredPilotId = null;
    try {
      const sm = require('./settingsManager');
      const s = sm.load();
      configuredPilotId = s.success ? (s.data?.oaPilotId || null) : null;
    } catch (e) {}

    // Extract crew member details with detailed logging
    let crewMembers = [];

    if (flight.FlightCrews && flight.FlightCrews.length > 0) {
      crewMembers = flight.FlightCrews.map((crew, idx) => {
        // Get the pilot name from People.Pseudo (actual pilot name)
        const crewName = crew.People?.Pseudo
          || crew.People?.Company?.Name
          || crew.Name
          || crew.CallSign
          || crew.PilotName
          || `Crew ${idx + 1}`;

        const crewLevel = crew.People?.Company?.Level
          || crew.Level
          || 'Unknown';

        // OnAir role mapping: 0 = Captain (user), 1 = First Officer, 2+ = Flight Attendant
        // Use ?? (nullish) not || so that role 0 (Captain) is not treated as falsy
        const roleValue = crew.Role ?? 0;
        let crewRole;
        if (roleValue === 0) {
          crewRole = 'Captain';
        } else if (roleValue === 1) {
          crewRole = 'First Officer';
        } else {
          crewRole = 'Flight Attendant'; // roles 2+ are all cabin crew
        }

        // Special handling for hours calculation
        // FlightHoursTotalBeforeHiring = 0 for company founders; use company total + company-specific hours
        let careerHours = crew.People?.FlightHoursTotalBeforeHiring || 0;
        const companyHours = crew.People?.FlightHoursInCompany || 0;
        if (careerHours === 0 && companyHours > 0) {
          // For company founders/admins, use company-specific hours
          careerHours = companyHours;
        }

        const isKahuna = (crew.People?.CompanyId || crew.CompanyId) === '5597c4b6-8f0b-4bbd-a13e-42f8a6e04026';
        const peopleId = crew.People?.Id;
        const extracted = {
          id: crew.Id,
          name: crewName,
          level: crewLevel,
          role: crewRole,
          companyId: crew.People?.CompanyId || crew.CompanyId,
          isKahuna: isKahuna,
          // isMe: true ONLY for the user's own OnAir character.
          // Primary: oaPilotId setting matches People.Id (most reliable — unique per pilot)
          // Fallback: crew name contains 'kahuna' (user's OnAir Pseudo)
          // REMOVED: roleValue===0 — unreliable, any hired crew can occupy slot 0
          // REMOVED: isKahuna company ID — matches ALL Kahuna Air crew members, not just user
          isMe: (configuredPilotId && peopleId && configuredPilotId === peopleId) ||
                crewName.toLowerCase().includes('kahuna'),
          // Career flight hours (total before hiring + company hours for founders)
          hours: Math.round(careerHours),
          // Career landings (total across all companies)
          flights: crew.People?.TotalLandings || crew.NumberOfFlights || 0
        };

        // Debug: log each crew member
        // logger.info(`Crew ${idx + 1}: ${extracted.name} (${crewRole})`, extracted);

        return extracted;
      });
    }

    // Debug: log final crew list
    // logger.info(`Flight ${flight.Id?.substring(0, 8)}... - Final crew members (${crewMembers.length}):`, crewMembers);

    // Extract telemetry data
    const intendedFL = telemetryUtils.convertToFlightLevel(flight.IntendedFlightLevel);
    const nearestAirport = telemetryUtils.findNearestAirport(
      flight.Latitude || 0,
      flight.Longitude || 0,
      flight.DepartureAirport,
      flight.ArrivalIntendedAirport
    );
    const location = telemetryUtils.estimateLocation(
      flight.Latitude,
      flight.Longitude,
      flight.DepartureAirport,
      flight.ArrivalIntendedAirport
    );
    const flightStateLabel = telemetryUtils.interpretFlightState(flight.FlightState);

    // Debug: log aircraft and airport data (disabled to reduce console spam)
    // logger.info('AIRCRAFT DATA:', {...});
    // logger.info('AIRPORT DATA:', {...});

    return {
      id: flight.Id,
      aircraft: {
        id: flight.AircraftId,
        type: flight.Aircraft?.AircraftType?.Name || 'Unknown',
        displayName: flight.Aircraft?.AircraftType?.DisplayName
          || flight.Aircraft?.AircraftType?.Name
          || 'Unknown Aircraft',
        registration: flight.Registration || 'N/A'
      },
      route: {
        departure: {
          ICAO: typeof flight.DepartureAirport === 'string' ? flight.DepartureAirport : flight.DepartureAirport?.ICAO,
          city: flight.DepartureAirport?.City || '',
          name: flight.DepartureAirport?.Name || flight.DepartureAirport || 'Unknown'
        },
        arrival: {
          ICAO: typeof flight.ArrivalIntendedAirport === 'string' ? flight.ArrivalIntendedAirport : flight.ArrivalIntendedAirport?.ICAO,
          city: flight.ArrivalIntendedAirport?.City || '',
          name: flight.ArrivalIntendedAirport?.Name || flight.ArrivalIntendedAirport || 'Unknown'
        }
      },
      position: {
        latitude: flight.Latitude || null,
        longitude: flight.Longitude || null,
        heading: flight.Heading || null,
        nearestAirport: nearestAirport,
        location: location
      },
      telemetry: {
        intendedFlightLevel: intendedFL,
        flightState: flightStateLabel,
        flightStateCode: flight.FlightState,
        actualCruiseAltitude: flight.ActualCruiseAltitude || null,
        actualTAS: flight.ActualTASAtCruiseLevel || null,
        actualFuelConsumption: flight.ActualConsumptionAtCruiseLevelInGalPerHour || null,
        // Fuel data with lbs conversion
        fuel: {
          currentGallons: flight.fuelTotalGallons || null,
          currentLbs: flight.fuelTotalGallons
            ? Math.round(fuelUtils.gallonsToLbs(flight.fuelTotalGallons, flight.fuelType || 1))
            : null,
          capacityGallons: flight.FuelTotalCapacityInGallons || null,
          capacityLbs: flight.FuelTotalCapacityInGallons
            ? Math.round(fuelUtils.gallonsToLbs(flight.FuelTotalCapacityInGallons, flight.fuelType || 1))
            : null,
          type: fuelUtils.getFuelTypeName(flight.fuelType || 1),
          fuelTypeCode: flight.fuelType || 1
        }
      },
      crew: {
        total: flight.FlightCrews?.length || 0,
        kahuna: flight.FlightCrews?.filter(
          c => c.People?.CompanyId === '5597c4b6-8f0b-4bbd-a13e-42f8a6e04026'
        ).length || 0,
        aiCount: flight.FlightCrews?.filter(c => !c.People?.CompanyId).length || 0,
        members: crewMembers
      },
      payload: {
        passengerCount: flight.PassengerCount || 0,
        cargoWeight: flight.CargoWeight || 0,
        cargoWeightUoM: flight.CargoWeightUoM || 'lbs'
      },
      timing: {
        scheduled: flight.StartTime,
        engineOn: flight.EngineOnTime,
        airborne: flight.AirborneTime
      },
      status: (flight.StartTime || flight.EngineOnTime || flight.AirborneTime)
        ? 'ACTIVE'
        : 'GROUND',
      siKey: this.flightService.getSayIntentionsKey(flight)
    };
  }

  start() {
    const fs = require('fs');
    const path = require('path');
    const os = require('os');

    const configDir = path.join(os.homedir(), '.kahunair-dispatch');
    const portFile = path.join(configDir, 'backend-port.json');

    // Add global error handlers to prevent server crashes
    this.app.use((err, req, res, next) => {
      // Express error handler middleware
      logger.error('[Server Error] Unhandled exception:', err);
      res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: err.message
      });
    });

    // Handle unhandled promise rejections
    process.on('unhandledRejection', (reason, promise) => {
      logger.error('[Process] Unhandled promise rejection:', reason);
    });

    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
      logger.error('[Process] Uncaught exception:', error);
      // Try to stay alive and log the error instead of crashing
    });

    const tryPort = (port, attempt = 1) => {
      const listener = this.app.listen(port, () => {
        // Save the actual port to a file so frontend can find it
        try {
          if (!fs.existsSync(configDir)) {
            fs.mkdirSync(configDir, { recursive: true });
          }
          fs.writeFileSync(portFile, JSON.stringify({ port }, null, 2), 'utf-8');
          logger.info(`Backend port saved to config: ${port}`);
        } catch (err) {
          logger.warn(`Could not save port to config: ${err.message}`);
        }

        const startupMsg = `\n✅ KahunaAir Dispatch Server running on port ${port}\n🚀 Environment: ${this.env}\n📍 API Base: http://localhost:${port}/api\n\nAvailable endpoints:\n  GET  /health                         - Health check\n  GET  /api/credentials-status         - Check if credentials configured\n  POST /api/set-credentials            - Store credentials\n  POST /api/validate-credentials       - Validate and store credentials\n  GET  /api/flights                    - All Kahuna flights\n  GET  /api/flights/active             - Active Kahuna flights\n  GET  /api/dispatch/summary           - Optimized dispatch summary\n  GET  /api/flights/:flightId          - Get specific flight\n  POST /api/dispatch/load              - Load flight to SI (with crew customization)\n  POST /api/dispatch/preferences       - Save flight dispatch preferences\n  GET  /api/dispatch/personality-options - Get available personality options\n  GET  /api/logs/server                - Get server logs\n  GET  /api/logs/path                  - Get log file path\n  POST /api/admin/cache-clear          - Clear cache\n`;
        logger.info(startupMsg);
        console.log(startupMsg);
      });

      listener.on('error', (error) => {
        if (error.code === 'EADDRINUSE' && attempt <= 5) {
          logger.warn(`Port ${port} in use, trying port ${port + 1}...`);
          tryPort(port + 1, attempt + 1);
        } else {
          logger.error('Server error:', error);
          process.exit(1);
        }
      });

      // Initialize SimConnect connection to MSFS (non-blocking with timeout)
      // Don't wait for this to complete - server can serve requests even if SimConnect fails
      const simConnectTimeout = new Promise((resolve) => {
        setTimeout(() => {
          logger.warn('[Server] SimConnect connection timeout - continuing without telemetry');
          resolve(false);
        }, 3000); // 3 second timeout
      });

      Promise.race([
        simConnectService.connect(),
        simConnectTimeout
      ]).then((connected) => {
        if (connected) {
          logger.info('[Server] SimConnect service ready for real-time telemetry');
        } else {
          logger.warn('[Server] SimConnect not connected - telemetry unavailable (MSFS not running?)');
        }
      }).catch((error) => {
        logger.error('[Server] SimConnect initialization error:', error.message);
      });

      return listener;
    };

    tryPort(this.port);
  }
}

module.exports = DispatchServer;
