import React, { useState, useEffect } from 'react'
import './AppMinimal.css'
import CrewProfileEditorV2 from './components/CrewProfileEditorV2'

/**
 * FRESH START: Minimal App
 * - ONLY shows connection status indicators
 * - NO old code reused
 * - NO complex state management
 * - Pure, simple React
 */
export default function AppMinimal() {
  // Log immediately when component mounts to verify React is rendering
  console.log('[AppMinimal] Component rendering - this should be visible immediately after React starts')
  const [apiUrl, setApiUrl] = useState('http://localhost:3000')
  const [onAirStatus, setOnAirStatus] = useState('checking')
  const [siStatus, setSiStatus] = useState('checking')
  const [simConnectStatus, setSimConnectStatus] = useState('checking')
  const [simBriefStatus, setSimBriefStatus] = useState('checking')
  const [backendStatus, setBackendStatus] = useState('checking')
  const [telemetry, setTelemetry] = useState(null)
  const [flightData, setFlightData] = useState({
    flightNumber: null,
    departure: null,
    arrival: null,
    alternate: { ICAO: '----', name: '----' },
    route: '',
    tow: '----',
    blockFuel: '----',
    avgWindDir: '---',
    avgWindSpd: '---',
    isaDeviation: '---',
    cargoWeight: 0,
    cargoUoM: 'lbs',
    cargoTypes: [],
    passengerTypes: []
  })
  const [procedures, setProcedures] = useState({
    departure: { runway: '---', sid: '---' },
    arrival: { runway: '---', star: '---' }
  })
  const [crew, setCrew] = useState(null)
  const [crewProfiles, setCrewProfiles] = useState({}) // crewId -> profile mapping
  const [cargoCharter, setCargoCharter] = useState({ cargos: [], charters: [] }) // NEW: Cargo/Charter data
  const [cargoStatus, setCargoStatus] = useState('IDLE') // IDLE | AWAITING_OA_START | LOADING | READY

  // Handle saving crew profile (called by CrewProfileEditorV2)
  const handleSaveCrewPersonality = async (crewId, payload) => {
    if (!crewId) return

    try {
      console.log('[AppMinimal] Saving crew profile for:', crewId)
      const res = await fetch(`${apiUrl}/api/crew/${crewId}/profile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })

      if (res.ok) {
        const data = await res.json()
        console.log('[AppMinimal] ✓ Crew profile saved')
        // Update local crew profiles with new data
        setCrewProfiles(prev => ({
          ...prev,
          [crewId]: data.profile || payload
        }))
        setEditingCrewId(null)
      } else {
        console.error('[AppMinimal] Save failed, status:', res.status)
        alert('Failed to save crew profile')
      }
    } catch (error) {
      console.error('[AppMinimal] Error saving crew profile:', error)
      alert(`Error saving profile: ${error.message}`)
    }
  }

  const handleExit = async () => {
    console.log('[AppMinimal] Exit requested')
    try {
      // Tell backend to shut down gracefully
      await fetch(`${apiUrl}/api/admin/shutdown`, {
        method: 'POST',
        signal: AbortSignal.timeout(3000)
      })
    } catch (error) {
      console.warn('[AppMinimal] Backend shutdown request failed:', error.message)
      // Continue with exit even if backend shutdown fails
    }

    // Tell Electron to close the window
    if (window.electronAPI && window.electronAPI.closeWindow) {
      console.log('[AppMinimal] Requesting Electron to close window')
      window.electronAPI.closeWindow()
    } else {
      console.log('[AppMinimal] No Electron API available, using window.close()')
      // Fallback for non-Electron
      window.close()
    }
  }
  const [editingCrewId, setEditingCrewId] = useState(null) // Currently editing crew ID

  // On mount, find the backend
  useEffect(() => {
    const findBackend = async () => {
      console.log('[AppMinimal] Starting backend discovery (timeout: 15s per port)...')
      for (const port of [3000, 3001, 3002, 3003, 3004]) {
        try {
          console.log(`[AppMinimal] Testing port ${port}...`)
          const res = await fetch(`http://localhost:${port}/health`, {
            signal: AbortSignal.timeout(15000)  // Increased to 15s to allow backend to fully initialize after restart
          })
          if (res.ok) {
            const url = `http://localhost:${port}`
            console.log(`[AppMinimal] ✓ Found backend at ${url}`)
            setApiUrl(url)
            setBackendStatus('online')
            return
          }
        } catch (e) {
          console.log(`[AppMinimal] Port ${port} failed: ${e.message}`)
        }
      }
      setBackendStatus('offline')
    }

    findBackend()
  }, [])

  // Poll connection status every 5 seconds
  useEffect(() => {
    let pollCount = 0

    const pollStatus = async () => {
      pollCount++
      try {
        // After restart, backend can take longer to fully initialize
        // First poll: 30 seconds (backend may still be initializing)
        // Polls 2-5: 20 seconds (still warming up)
        // After that: 10 seconds (should be ready by then)
        let timeout = 30000
        if (pollCount > 1 && pollCount <= 5) {
          timeout = 20000
        } else if (pollCount > 5) {
          timeout = 10000
        }

        console.log(`[AppMinimal] Health check #${pollCount} (timeout: ${timeout}ms, ${(timeout / 1000).toFixed(0)}s)...`)

        // Test backend health -- if this succeeds, assume all services are reachable
        const backRes = await fetch(`${apiUrl}/health`, {
          signal: AbortSignal.timeout(timeout)
        })

        if (backRes.ok) {
          console.log(`[AppMinimal] ✓ Backend is healthy (poll #${pollCount})`)
          // Backend is up, assume all services are available (individual data polls will fail if not)
          setBackendStatus('online')
          setOnAirStatus('online')
          setSiStatus('online')
          setSimConnectStatus('online')
          setSimBriefStatus('online')
        } else {
          console.warn(`[AppMinimal] Backend health check returned ${backRes.status}`)
          // Backend is down
          setBackendStatus('offline')
          setOnAirStatus('offline')
          setSiStatus('offline')
          setSimConnectStatus('offline')
          setSimBriefStatus('offline')
        }
      } catch (error) {
        // Distinguish between timeout and other errors
        if (error.name === 'AbortError' || error.message.includes('signal')) {
          console.warn(`[AppMinimal] Status poll #${pollCount} TIMEOUT: Backend still initializing (${(timeout / 1000).toFixed(0)}s timeout reached)`)
        } else {
          console.warn(`[AppMinimal] Status poll #${pollCount} error:`, error.message)
        }
        setBackendStatus('offline')
        setOnAirStatus('offline')
        setSiStatus('offline')
        setSimConnectStatus('offline')
        setSimBriefStatus('offline')
      }
    }

    // Initial poll
    pollStatus()

    // Set up interval for subsequent polls
    const interval = setInterval(pollStatus, 5000)
    return () => clearInterval(interval)
  }, [apiUrl])

  // Poll telemetry every 1 second
  useEffect(() => {
    const pollTelemetry = async () => {
      try {
        const res = await fetch(`${apiUrl}/api/telemetry`, {
          signal: AbortSignal.timeout(5000)
        })
        if (res.ok) {
          const json = await res.json()
          if (json.success && json.data) {
            setTelemetry(json.data)
          }
        }
      } catch (error) {
        // Silently fail telemetry polling
      }
    }

    // Initial poll
    pollTelemetry()

    // Set up interval (1Hz)
    const interval = setInterval(pollTelemetry, 1000)
    return () => clearInterval(interval)
  }, [apiUrl])

  // Poll flight data from /api/flights/active (includes crew) - every 10 seconds
  useEffect(() => {
    const pollFlight = async () => {
      try {
        const res = await fetch(`${apiUrl}/api/flights/active`, {
          signal: AbortSignal.timeout(5000)
        })
        if (res.ok) {
          const json = await res.json()
          if (json.success && json.flights && json.flights.length > 0) {
            const activeFlight = json.flights[0]
            console.log('[AppMinimal] Active flight:', activeFlight.id, activeFlight.route?.departure?.ICAO, activeFlight.route?.arrival?.ICAO)
            // Extract crew data (changes frequently)
            setCrew(activeFlight.crew)
            // Update flight number and departure/arrival from OnAir
            setFlightData(prev => ({
              ...prev || {},
              flightNumber: activeFlight.id,
              departure: activeFlight.route?.departure,
              arrival: activeFlight.route?.arrival
            }))

            // NEW: Fetch cargo/charter data
            try {
              const ccRes = await fetch(`${apiUrl}/api/flights/current`, {
                signal: AbortSignal.timeout(5000)
              })
              if (ccRes.ok) {
                const ccJson = await ccRes.json()
                if (ccJson.flight) {
                  const status = ccJson.flight.cargoStatus || 'IDLE'
                  setCargoStatus(status)
                  if (ccJson.flight.cargoCharter) {
                    console.log('[AppMinimal] Loaded cargoCharter:', ccJson.flight.cargoCharter.cargos?.length, 'cargos,', ccJson.flight.cargoCharter.charters?.length, 'charters')
                    setCargoCharter(ccJson.flight.cargoCharter)
                  }
                }
              }
            } catch (err) {
              // Silently fail cargo/charter - optional feature
            }
          }
        }
      } catch (error) {
        // Silently fail flight data polling
      }
    }

    // Initial poll
    pollFlight()

    // Set up interval (every 10 seconds for crew changes)
    const interval = setInterval(pollFlight, 10000)
    return () => clearInterval(interval)
  }, [apiUrl])

  // Load crew profiles when crew data changes
  useEffect(() => {
    if (!crew || !crew.members || crew.members.length === 0) return

    const loadCrewProfiles = async () => {
      const profiles = {}
      for (const member of crew.members) {
        try {
          const res = await fetch(`${apiUrl}/api/crew/${member.id}/profile`, {
            signal: AbortSignal.timeout(5000)
          })

          if (res.ok) {
            // Profile exists
            const data = await res.json()
            if (data.profile) {
              profiles[member.id] = data.profile
            }
          } else if (res.status === 404) {
            // New crew member - create empty profile
            const jsonBody = {
              currentName: member.name,
              role: member.role === 'Captain' ? 0 : member.role === 'First Officer' ? 1 : 2,
              companyId: member.companyId || 'unknown',
              personality: 'standard',
              customNotes: '',
              siKey: member.siKey || '',
              crew_data: {}
            }

            const createRes = await fetch(`${apiUrl}/api/crew/${member.id}/profile`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(jsonBody),
              signal: AbortSignal.timeout(5000)
            })

            if (createRes.ok) {
              const createData = await createRes.json()
              if (createData.profile) {
                profiles[member.id] = createData.profile
                console.log('[AppMinimal] Created new profile for', member.name)
              }
            } else {
              console.warn('[AppMinimal] Failed to create profile for', member.name)
            }
          }
        } catch (e) {
          console.error('[AppMinimal] Error loading crew profile:', member.name, e.message)
        }
      }
      setCrewProfiles(profiles)
    }

    loadCrewProfiles()
  }, [crew, apiUrl])

  // Fetch OFP data from SimBrief via backend - provides route, alternate, procedures, weights
  useEffect(() => {
    const fetchOFPData = async () => {
      try {
        const res = await fetch(`${apiUrl}/api/flight/ofp`, {
          signal: AbortSignal.timeout(10000) // 10 second timeout (more generous than 5s)
        })

        if (!res.ok) {
          console.warn('[AppMinimal] OFP endpoint returned status:', res.status)
          return
        }

        const json = await res.json()
        if (json.success && json.ofp) {
          const ofp = json.ofp
          console.log('[AppMinimal] OFP data received - route:', ofp.route)

          // Extract flight plan data
          const towThousands = ofp.weights?.takeoffWeight !== undefined ? (ofp.weights.takeoffWeight / 1000).toFixed(1) : '----'
          const blockFuelThousands = ofp.fuel?.plannedLbs !== undefined ? (ofp.fuel.plannedLbs / 1000).toFixed(1) : '----'

          setFlightData(prev => ({
            ...prev || {},
            alternate: ofp.alternate || { ICAO: '----', name: '----' },
            route: ofp.route || '',
            tow: towThousands,
            blockFuel: blockFuelThousands,
            avgWindDir: ofp.weather?.avgWindDir || '---',
            avgWindSpd: ofp.weather?.avgWindSpd || '---',
            isaDeviation: ofp.weather?.isaDeviation !== undefined ? ofp.weather.isaDeviation : '---'
          }))

          setProcedures({
            departure: {
              runway: ofp.departure?.runway || '---',
              sid: ofp.departure?.SID || '---'
            },
            arrival: {
              runway: ofp.arrival?.runway || '---',
              star: ofp.arrival?.STAR || '---'
            }
          })
        }
      } catch (error) {
        // Silently fail - OFP is optional, app continues without it
        console.debug('[AppMinimal] OFP fetch failed (non-blocking):', error.message)
      }
    }

    // Fetch OFP once after short delay (let other data load first)
    const timer = setTimeout(fetchOFPData, 500)
    return () => clearTimeout(timer)
  }, [apiUrl])

  // Poll SI for procedure updates and cargo info
  useEffect(() => {
    const pollSIData = async () => {
      try {
        const res = await fetch(`${apiUrl}/api/dispatch/summary`, {
          signal: AbortSignal.timeout(10000)
        })

        if (!res.ok) return

        const json = await res.json()
        const summary = json.data || json
        const flights = summary?.flights || []

        if (flights.length > 0) {
          const firstFlight = flights[0]

          // Update cargo and passenger info
          const cargoTypes = firstFlight.payload?.cargoTypes || []
          const passengerTypes = firstFlight.payload?.passengerTypes || []
          const cargoWeight = firstFlight.payload?.cargo || 0

          setFlightData(prev => ({
            ...prev,
            cargoTypes: cargoTypes,
            passengerTypes: passengerTypes,
            cargoWeight: cargoWeight,
            cargoUoM: firstFlight.payload?.cargoUoM || 'lbs'
          }))

          // Update procedures if SI has different values
          const siProcs = summary?.procedures || firstFlight?.procedures
          if (siProcs) {
            setProcedures(prev => {
              // Only update if SI has new data
              if (siProcs.departure?.runway || siProcs.departure?.sid || siProcs.arrival?.runway || siProcs.arrival?.star) {
                return {
                  departure: {
                    runway: siProcs.departure?.runway || prev?.departure?.runway || '---',
                    sid: siProcs.departure?.sid || prev?.departure?.sid || '---'
                  },
                  arrival: {
                    runway: siProcs.arrival?.runway || prev?.arrival?.runway || '---',
                    star: siProcs.arrival?.star || prev?.arrival?.star || '---'
                  }
                }
              }
              return prev
            })
          }
        }
      } catch (error) {
        // Silently fail - SI procedures are optional
        console.debug('[AppMinimal] SI data fetch failed (non-blocking):', error.message)
      }
    }

    // Watch for flight changes and poll SI
    if (flightData?.departure?.ICAO) {
      pollSIData()
      const timer = setTimeout(pollSIData, 1000)
      return () => clearTimeout(timer)
    }
  }, [flightData?.departure?.ICAO, apiUrl])

  const StatusDot = ({ status, label }) => {
    const dotColor = {
      'online': '#4ade80',
      'offline': '#ef4444',
      'checking': '#fbbf24'
    }[status] || '#9ca3af'

    return (
      <div className="status-item-column">
        <span className="status-label-text">{label}</span>
        <div className="status-dot-only" style={{ backgroundColor: dotColor }}></div>
      </div>
    )
  }

  // NEW: Cargo & Charter Display Component
  const CargoCharterDisplay = () => {
    if (cargoStatus === 'AWAITING_OA_START') {
      return (
        <div className="cargo-charter-section">
          <div className="cargo-charter-title">📦 CARGO & CHARTERS</div>
          <div className="cargo-status-message">⏳ Waiting for OnAir flight start...</div>
        </div>
      )
    }

    if (cargoStatus === 'LOADING') {
      return (
        <div className="cargo-charter-section">
          <div className="cargo-charter-title">📦 CARGO & CHARTERS</div>
          <div className="cargo-status-message">🔄 Loading cargo details...</div>
        </div>
      )
    }

    if (!cargoCharter || (cargoCharter.cargos?.length === 0 && cargoCharter.charters?.length === 0)) {
      return null // Don't show if no cargo/charter (IDLE or READY with empty flight)
    }

    const cabinAbbr = { 'Eco': 'Eco', 'Business': 'Bus', 'First': '1st' }

    return (
      <div className="cargo-charter-section">
        <div className="cargo-charter-title">📦 CARGO & CHARTERS</div>

        {/* CHARTERS - single compact line */}
        {cargoCharter.charters?.length > 0 && (
          <div className="charter-line">
            {cargoCharter.charters.map((charter, i) => (
              <span key={charter.id}>
                {i > 0 && <span className="charter-sep"> | </span>}
                <span className="charter-cabin">{cabinAbbr[charter.cabinClass] || charter.cabinClass}</span>
                {' '}{charter.passengers} {charter.description} {charter.from}-{charter.to}
              </span>
            ))}
          </div>
        )}

        {/* CARGO - one line per item */}
        {cargoCharter.cargos?.length > 0 && (
          <div className="cargo-line-list">
            {cargoCharter.cargos.map((cargo) => (
              <div key={cargo.id} className="cargo-line">
                {cargo.description} · {cargo.weight} {cargo.weight_unit || 'lbs'} · {cargo.from}-{cargo.to}
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  const TelemetryDisplay = () => {
    if (!telemetry) {
      return (
        <div className="telemetry-panel">
          <div className="telem-group">
            <div className="telem-label">ALT</div>
            <div className="telem-value">---</div>
            <div className="telem-unit">FT</div>
          </div>
          <div className="telem-group">
            <div className="telem-label">IAS</div>
            <div className="telem-value">---</div>
            <div className="telem-unit">KTS</div>
          </div>
          <div className="telem-group">
            <div className="telem-label">GS</div>
            <div className="telem-value">---</div>
            <div className="telem-unit">KTS</div>
          </div>
          <div className="telem-group">
            <div className="telem-label">VS</div>
            <div className="telem-value">---</div>
            <div className="telem-unit">FT/MIN</div>
          </div>
          <div className="telem-group">
            <div className="telem-label">ETE</div>
            <div className="telem-value">---</div>
            <div className="telem-unit">MIN</div>
          </div>
          <div className="telem-group">
            <div className="telem-label">PAX</div>
            <div className="telem-value">---</div>
            <div className="telem-unit">PAX</div>
          </div>
          <div className="telem-group">
            <div className="telem-label">FUEL</div>
            <div className="telem-value">---</div>
            <div className="telem-unit">LBS</div>
          </div>
          <div className="telem-group">
            <div className="telem-label">CARGO</div>
            <div className="telem-value">---</div>
            <div className="telem-unit">LBS</div>
          </div>
          <div className="telem-group">
            <div className="telem-label">WEIGHT</div>
            <div className="telem-value">---</div>
            <div className="telem-unit">LBS</div>
          </div>
        </div>
      )
    }

    const alt = telemetry.altitude?.indicated ? Math.round(telemetry.altitude.indicated) : '---'
    const ias = telemetry.speed?.airspeed ? Math.round(telemetry.speed.airspeed) : '---'
    const gs = telemetry.speed?.groundSpeed ? Math.round(telemetry.speed.groundSpeed) : '---'
    const vs = telemetry.speed?.verticalSpeed ? Math.round(telemetry.speed.verticalSpeed) : '---'

    // Format ETE as "Xh Ymm" if >= 60 minutes, otherwise just minutes
    let ete = '---'
    let eteUnit = 'MIN'
    if (telemetry.navigation?.eteMinutes) {
      const eteMin = Math.round(telemetry.navigation.eteMinutes)
      if (eteMin >= 60) {
        const hours = Math.floor(eteMin / 60)
        const mins = eteMin % 60
        ete = `${hours}h ${mins}m`
        eteUnit = ''
      } else {
        ete = eteMin
      }
    }

    const pax = telemetry.passengers?.count ? Math.round(telemetry.passengers.count) : '---'
    const fuel = telemetry.fuel?.total ? Math.round(telemetry.fuel.total) : '---'
    const cargo = telemetry.cargo?.weight ? Math.round(telemetry.cargo.weight) : '---'
    const weight = telemetry.weight?.current ? Math.round(telemetry.weight.current) : '---'

    return (
      <div className="telemetry-panel">
        <div className="telem-group">
          <div className="telem-label">ALT</div>
          <div className="telem-value">{alt}</div>
          <div className="telem-unit">FT</div>
        </div>
        <div className="telem-group">
          <div className="telem-label">IAS</div>
          <div className="telem-value">{ias}</div>
          <div className="telem-unit">KTS</div>
        </div>
        <div className="telem-group">
          <div className="telem-label">GS</div>
          <div className="telem-value">{gs}</div>
          <div className="telem-unit">KTS</div>
        </div>
        <div className="telem-group">
          <div className="telem-label">VS</div>
          <div className="telem-value">{vs}</div>
          <div className="telem-unit">FT/MIN</div>
        </div>
        <div className="telem-group">
          <div className="telem-label">ETE</div>
          <div className="telem-value">{ete}</div>
          <div className="telem-unit">{eteUnit}</div>
        </div>
        <div className="telem-group">
          <div className="telem-label">PAX</div>
          <div className="telem-value">{pax}</div>
          <div className="telem-unit">PAX</div>
        </div>
        <div className="telem-group">
          <div className="telem-label">FUEL</div>
          <div className="telem-value">{fuel}</div>
          <div className="telem-unit">LBS</div>
        </div>
        <div className="telem-group">
          <div className="telem-label">CARGO</div>
          <div className="telem-value">{cargo}</div>
          <div className="telem-unit">LBS</div>
        </div>
        <div className="telem-group">
          <div className="telem-label">WEIGHT</div>
          <div className="telem-value">{weight}</div>
          <div className="telem-unit">LBS</div>
        </div>
      </div>
    )
  }

  const FlightInfoDisplay = () => {
    if (!flightData) {
      return (
        <div className="flight-info-bar">
          <div className="flight-info-text">
            Departure: ---- / ---- <span className="arrow-icon">✈</span> ---- / ----: Arrival
          </div>
        </div>
      )
    }

    const depIcao = flightData.departure?.ICAO || '----'
    const depName = flightData.departure?.name || '----'
    const arrName = flightData.arrival?.name || '----'
    const arrIcao = flightData.arrival?.ICAO || '----'
    const altIcao = flightData.alternate?.ICAO || '----'
    const altName = flightData.alternate?.name || '----'
    const route = flightData.route || ''

    const depRwy = procedures?.departure?.runway || '---'
    const depSid = procedures?.departure?.sid || '---'
    const arrRwy = procedures?.arrival?.runway || '---'
    const arrStar = procedures?.arrival?.star || '---'

    // Format wind as direction/speed (e.g., "180/15")
    const windDir = flightData.avgWindDir && flightData.avgWindDir !== '---' ? String(flightData.avgWindDir).padStart(3, '0') : '---'
    const windSpd = flightData.avgWindSpd && flightData.avgWindSpd !== '---' ? String(flightData.avgWindSpd).padStart(2, '0') : '--'
    const formattedWind = `${windDir}/${windSpd}`

    // Format ISA as +/- deviation
    const isaDisplay = flightData.isaDeviation && flightData.isaDeviation !== '---' && flightData.isaDeviation !== '----'
      ? (flightData.isaDeviation > 0 ? '+' : '') + flightData.isaDeviation
      : '----'

    return (
      <div className="flight-info-bar">
        <div className="flight-info-text">
          Departure: {depIcao} / {depName} <span className="arrow-icon">✈</span> {arrIcao} / {arrName}: Arrival
        </div>
        <div className="flight-alternate-text">
          Alternate: {altIcao} / {altName}
        </div>
        <div className="flight-procedures-text">
          RWY {depRwy} | SID {depSid} | STAR {arrStar} | RWY {arrRwy}
        </div>
        <div className="flight-route-text">
          {route}
        </div>
        <div className="flight-params-text">
          TOW {flightData.tow}K | BF {flightData.blockFuel}K | AVG WIND {formattedWind} | ISA {isaDisplay}°
        </div>
        {(flightData.cargoTypes && flightData.cargoTypes.length > 0) && (
          <div className="flight-cargo-text">
            CARGO TYPES: {flightData.cargoTypes.join(', ')}
          </div>
        )}
        {(flightData.passengerTypes && flightData.passengerTypes.length > 0) && (
          <div className="flight-passenger-text">
            PASSENGER TYPES: {flightData.passengerTypes.join(', ')}
          </div>
        )}
      </div>
    )
  }

  const CrewCard = ({ crewId, name, role, hours, flights, profile, onEdit }) => {
    const getRoleColor = (role) => {
      if (role === 'Captain') return '#fbbf24'
      if (role === 'First Officer') return '#60a5fa'
      if (role === 'Flight Attendant') return '#34d399'
      return '#9ca3af'
    }

    const personalityColor = {
      'formal': '#3b82f6',
      'casual': '#8b5cf6',
      'humorous': '#ec4899',
      'standard': '#6b7280'
    }[profile?.personality] || '#6b7280'

    return (
      <div className="crew-card">
        <div className="crew-role" style={{ borderLeftColor: getRoleColor(role) }}>
          <div className="crew-name">{name}</div>
          <div className="crew-position">{role}</div>
        </div>
        <div className="crew-stats">
          <div className="crew-stat">
            <div className="crew-stat-label">HOURS</div>
            <div className="crew-stat-value">{hours.toLocaleString()}</div>
          </div>
          <div className="crew-stat">
            <div className="crew-stat-label">FLIGHTS</div>
            <div className="crew-stat-value">{flights.toLocaleString()}</div>
          </div>
        </div>
        <div className="crew-personality">
          <div className="personality-badge" style={{ backgroundColor: personalityColor }}>
            {profile?.personality || 'standard'}
          </div>
          <button className="crew-edit-btn" onClick={() => onEdit(crewId)}>
            Edit
          </button>
        </div>
      </div>
    )
  }

  const CrewDisplay = () => {
    if (!crew || !crew.members || crew.members.length === 0) {
      return (
        <div className="crew-section">
          <div className="crew-title">CREW</div>
          <div className="crew-grid">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="crew-card placeholder">
                <div className="crew-role">
                  <div className="crew-name">---</div>
                  <div className="crew-position">---</div>
                </div>
                <div className="crew-stats">
                  <div className="crew-stat">
                    <div className="crew-stat-label">HOURS</div>
                    <div className="crew-stat-value">---</div>
                  </div>
                  <div className="crew-stat">
                    <div className="crew-stat-label">FLIGHTS</div>
                    <div className="crew-stat-value">---</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )
    }

    // Separate crew by role
    const captain = crew.members.find(m => m.role === 'Captain')
    const firstOfficer = crew.members.find(m => m.role === 'First Officer')
    const attendants = crew.members.filter(m => m.role === 'Flight Attendant').slice(0, 5)

    return (
      <div className="crew-section">
        <div className="crew-title">CREW</div>
        <div className="crew-grid">
          {captain && (
            <CrewCard
              crewId={captain.id}
              name={captain.name}
              role={captain.role}
              hours={captain.hours}
              flights={captain.flights}
              profile={crewProfiles[captain.id]}
              onEdit={setEditingCrewId}
            />
          )}
          {firstOfficer && (
            <CrewCard
              crewId={firstOfficer.id}
              name={firstOfficer.name}
              role={firstOfficer.role}
              hours={firstOfficer.hours}
              flights={firstOfficer.flights}
              profile={crewProfiles[firstOfficer.id]}
              onEdit={setEditingCrewId}
            />
          )}
          {attendants.map((member) => (
            <CrewCard
              key={member.id}
              crewId={member.id}
              name={member.name}
              role={member.role}
              hours={member.hours}
              flights={member.flights}
              profile={crewProfiles[member.id]}
              onEdit={setEditingCrewId}
            />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="app-minimal">
      <div className="top-bar">
        <TelemetryDisplay />
        <div className="status-indicators">
          <StatusDot status={backendStatus} label="BE" />
          <StatusDot status={onAirStatus} label="OA" />
          <StatusDot status={siStatus} label="SI" />
          <StatusDot status={simConnectStatus} label="SC" />
          <StatusDot status={simBriefStatus} label="SB" />
        </div>
      </div>

      <FlightInfoDisplay />

      <CargoCharterDisplay />

      <CrewDisplay />

      <CrewProfileEditorV2
        crewId={editingCrewId}
        crewName={crew?.members?.find(m => m.id === editingCrewId)?.name}
        crewRole={crew?.members?.find(m => m.id === editingCrewId)?.role}
        profile={crewProfiles[editingCrewId]}
        onSave={handleSaveCrewPersonality}
        onCancel={() => setEditingCrewId(null)}
      />

      <footer className="app-footer">
        <h1>✈ KahunaAir Dispatch</h1>
        <button className="exit-button" onClick={handleExit} title="Gracefully shut down the application">
          ✕ EXIT
        </button>
      </footer>
    </div>
  )
}

