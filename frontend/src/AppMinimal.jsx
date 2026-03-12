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

  // Crew profile editor queue state
  const [crewQueue, setCrewQueue] = useState([])       // ordered list of { crewId, member } needing profiles
  const [queueIndex, setQueueIndex] = useState(0)      // current position in queue
  const [skipConfirm, setSkipConfirm] = useState(null) // crewId pending skip confirm, or null
  const [siSendStatus, setSiSendStatus] = useState('idle') // idle | sending | sent | error

  // Settings modal state
  const [showSettings, setShowSettings] = useState(false)
  const [settingsForm, setSettingsForm] = useState({
    siApiKey: '', siVaApiKey: '', oaCompanyId: '', oaApiKey: '',
    oaVaId: '', oaVaApiKey: '', oaPilotId: '', simBriefPilotId: ''
  })
  const [settingsSaveStatus, setSettingsSaveStatus] = useState('idle') // idle | saving | saved | error

  const openSettings = async () => {
    setSettingsSaveStatus('idle')
    setShowSettings(true)
    try {
      const res = await fetch(`${apiUrl}/api/settings`, { signal: AbortSignal.timeout(5000) })
      if (res.ok) {
        const data = await res.json()
        if (data.success && data.data) {
          setSettingsForm({
            siApiKey: data.data.siApiKey || '',
            siVaApiKey: data.data.siVaApiKey || '',
            oaCompanyId: data.data.oaCompanyId || '',
            oaApiKey: data.data.oaApiKey || '',
            oaVaId: data.data.oaVaId || '',
            oaVaApiKey: data.data.oaVaApiKey || '',
            oaPilotId: data.data.oaPilotId || '',
            simBriefPilotId: data.data.simBriefPilotId || ''
          })
        }
      }
    } catch (e) {
      // Start with empty form if settings haven't been saved yet
    }
  }

  const saveSettings = async () => {
    setSettingsSaveStatus('saving')
    try {
      const res = await fetch(`${apiUrl}/api/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settingsForm),
        signal: AbortSignal.timeout(10000)
      })
      const data = await res.json()
      if (res.ok && data.success) {
        setSettingsSaveStatus('saved')
        setTimeout(() => setShowSettings(false), 800)
      } else {
        setSettingsSaveStatus(`error:${data.error || data.message || 'Save failed'}`)
      }
    } catch (e) {
      setSettingsSaveStatus(`error:${e.message}`)
    }
  }

  // Fire SI send after all profiles are handled
  const fireSISend = async (members) => {
    setSiSendStatus('sending')
    try {
      console.log('[AppMinimal] Firing SI send...')
      const res = await fetch(`${apiUrl}/api/dispatch/crew-to-si`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ crewMembers: members }),
        signal: AbortSignal.timeout(20000)
      })
      const data = await res.json()
      if (res.ok && data.success) {
        console.log('[AppMinimal] ✓ SI send success:', data.siStatus)
        setSiSendStatus('sent')
      } else {
        console.error('[AppMinimal] SI send failed:', data.message)
        setSiSendStatus('error')
      }
    } catch (error) {
      console.error('[AppMinimal] SI send error:', error.message)
      setSiSendStatus('error')
    }
  }

  // Advance queue after save or skip
  const advanceQueue = async (currentIndex, queue, updatedMembers) => {
    const nextIndex = currentIndex + 1
    if (nextIndex < queue.length) {
      setQueueIndex(nextIndex)
      setEditingCrewId(queue[nextIndex].crewId)
    } else {
      // Queue exhausted — fire SI send
      setEditingCrewId(null)
      setCrewQueue([])
      setQueueIndex(0)
      await fireSISend(updatedMembers)
    }
  }

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
        setCrewProfiles(prev => ({
          ...prev,
          [crewId]: data.profile || payload
        }))
        // Advance the queue
        await advanceQueue(queueIndex, crewQueue, crew?.members || [])
      } else {
        console.error('[AppMinimal] Save failed, status:', res.status)
        alert('Failed to save crew profile')
      }
    } catch (error) {
      console.error('[AppMinimal] Error saving crew profile:', error)
      alert(`Error saving profile: ${error.message}`)
    }
  }

  // Handle skip request from editor
  const handleSkipCrew = (crewId) => {
    setSkipConfirm(crewId)
  }

  // Confirm skip — advance queue without saving
  const confirmSkip = async () => {
    const crewId = skipConfirm
    setSkipConfirm(null)
    await advanceQueue(queueIndex, crewQueue, crew?.members || [])
  }

  // Cancel skip — reopen editor for same crew member
  const cancelSkip = () => {
    setSkipConfirm(null)
    // editingCrewId still set — editor stays open
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

  // Load crew profiles when crew data changes — build queue for missing profiles
  useEffect(() => {
    if (!crew || !crew.members || crew.members.length === 0) return

    const loadCrewProfiles = async () => {
      const profiles = {}
      const queue = []

      // Sort: Captain first (isMe), then FO, then FAs
      const sorted = [...crew.members].sort((a, b) => {
        const order = { Captain: 0, 'First Officer': 1, 'Flight Attendant': 2 }
        return (order[a.role] ?? 3) - (order[b.role] ?? 3)
      })

      for (const member of sorted) {
        // Captain always uses my-pilot profile key
        const profileId = member.isMe ? 'my-pilot' : member.id

        try {
          const res = await fetch(`${apiUrl}/api/crew/${profileId}/profile`, {
            signal: AbortSignal.timeout(5000)
          })

          if (res.ok) {
            const data = await res.json()
            if (data.profile) {
              profiles[profileId] = data.profile
            }
          } else if (res.status === 404) {
            // New crew member — add to queue
            queue.push({ crewId: profileId, member })
            console.log('[AppMinimal] New crew member (no profile):', member.name, '→ queued')
          }
        } catch (e) {
          console.error('[AppMinimal] Error checking crew profile:', member.name, e.message)
        }
      }

      setCrewProfiles(profiles)

      if (queue.length === 0) {
        // All profiles exist — fire SI send immediately
        console.log('[AppMinimal] All crew profiled — firing SI send')
        setSiSendStatus('idle')
        setCrewQueue([])
        setQueueIndex(0)
        setEditingCrewId(null)
        await fireSISend(crew.members)
      } else {
        // Open editor for first in queue
        setCrewQueue(queue)
        setQueueIndex(0)
        setEditingCrewId(queue[0].crewId)
        console.log('[AppMinimal] Crew queue built:', queue.length, 'missing profiles')
      }
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
        {/* Cargo: type name + weight */}
        {cargoCharter.cargos?.length > 0 ? (
          <div className="flight-cargo-text">
            CARGO: {cargoCharter.cargos.map(c => `${c.type} (${c.weight} ${c.weight_unit || 'lbs'})`).join(', ')}
          </div>
        ) : (flightData.cargoTypes && flightData.cargoTypes.length > 0) && (
          <div className="flight-cargo-text">
            CARGO TYPES: {flightData.cargoTypes.join(', ')}
          </div>
        )}
        {/* Charters: sorted Eco → Bus → 1st, class badge + count + charter type */}
        {cargoCharter.charters?.length > 0 ? (
          <div className="flight-passenger-text">
          {['Eco', 'Business', 'First'].flatMap(cls =>
            cargoCharter.charters.filter(ch => (ch.cabinClass || 'Eco') === cls)
          ).map((ch, i) => {
            const abbr = { 'Eco': 'Eco', 'Business': 'Bus', 'First': '1st' }
            const cls = ch.cabinClass || 'Eco'
            return (
              <span key={ch.id}>
                {i > 0 && <span className="pax-sep"> | </span>}
                <span className={`pax-class-badge pax-class-${cls.toLowerCase()}`}>{abbr[cls] || cls}</span>
                {' '}{ch.passengers} {ch.type}
              </span>
            )
          })}
        </div>
        ) : (flightData.passengerTypes && flightData.passengerTypes.length > 0) && (
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

    // SI status badge
    const siBadge = siSendStatus === 'sent'
      ? <span style={{ marginLeft: '10px', fontSize: '11px', color: '#4ade80', fontWeight: 600 }}>✓ Sent to SI</span>
      : siSendStatus === 'sending'
      ? <span style={{ marginLeft: '10px', fontSize: '11px', color: '#fbbf24', fontWeight: 600 }}>⟳ Sending...</span>
      : siSendStatus === 'error'
      ? <span style={{ marginLeft: '10px', fontSize: '11px', color: '#f87171', fontWeight: 600 }}>⚠ SI Error</span>
      : null

    return (
      <div className="crew-section">
        <div className="crew-title" style={{ display: 'flex', alignItems: 'center' }}>
          CREW {siBadge}
        </div>
        <div className="crew-grid">
          {captain && (
            <CrewCard
              crewId={captain.isMe ? 'my-pilot' : captain.id}
              name={captain.name}
              role={captain.role}
              hours={captain.hours}
              flights={captain.flights}
              profile={crewProfiles[captain.isMe ? 'my-pilot' : captain.id]}
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
          <button
            onClick={openSettings}
            title="Settings"
            style={{
              background: 'none',
              border: '1px solid #374151',
              borderRadius: '4px',
              color: '#9ca3af',
              cursor: 'pointer',
              fontSize: '14px',
              padding: '2px 6px',
              marginLeft: '6px',
              lineHeight: 1
            }}
          >⚙</button>
        </div>
      </div>

      <FlightInfoDisplay />

      <CrewDisplay />

      <CrewProfileEditorV2
        crewId={skipConfirm ? null : editingCrewId}
        crewName={
          editingCrewId === 'my-pilot'
            ? crew?.members?.find(m => m.isMe || m.role === 'Captain')?.name
            : crew?.members?.find(m => m.id === editingCrewId)?.name
        }
        crewRole={
          editingCrewId === 'my-pilot'
            ? 'Captain'
            : crew?.members?.find(m => m.id === editingCrewId)?.role
        }
        crewHours={
          editingCrewId === 'my-pilot'
            ? (crew?.members?.find(m => m.isMe || m.role === 'Captain')?.hours || 0)
            : (crew?.members?.find(m => m.id === editingCrewId)?.hours || 0)
        }
        crewFlights={
          editingCrewId === 'my-pilot'
            ? (crew?.members?.find(m => m.isMe || m.role === 'Captain')?.flights || 0)
            : (crew?.members?.find(m => m.id === editingCrewId)?.flights || 0)
        }
        profile={crewProfiles[editingCrewId]}
        onSave={handleSaveCrewPersonality}
        onSkip={handleSkipCrew}
      />

      {/* Skip confirm modal */}
      {skipConfirm && (
        <div style={{
          position: 'fixed',
          inset: 0,
          backgroundColor: 'rgba(0,0,0,0.85)',
          zIndex: 10000,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '16px'
        }}>
          <div style={{
            backgroundColor: '#0f1117',
            border: '1px solid #374151',
            borderRadius: '8px',
            padding: '24px',
            maxWidth: '400px',
            width: '100%'
          }}>
            <h3 style={{ margin: '0 0 12px', color: '#f9fafb', fontSize: '15px' }}>Skip this crew member?</h3>
            <p style={{ margin: '0 0 20px', color: '#9ca3af', fontSize: '13px', lineHeight: 1.5 }}>
              Skipping{' '}
              <strong style={{ color: '#e5e7eb' }}>
                {skipConfirm === 'my-pilot'
                  ? (crew?.members?.find(m => m.isMe || m.role === 'Captain')?.name || 'Captain')
                  : (crew?.members?.find(m => m.id === skipConfirm)?.name || skipConfirm)}
              </strong>
              {' '}will send incomplete data to SayIntentions.AI.
            </p>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button
                onClick={cancelSkip}
                style={{
                  padding: '8px 16px',
                  backgroundColor: 'transparent',
                  border: '1px solid #374151',
                  borderRadius: '5px',
                  color: '#9ca3af',
                  fontSize: '13px',
                  cursor: 'pointer'
                }}
              >
                No — Continue Editing
              </button>
              <button
                onClick={confirmSkip}
                style={{
                  padding: '8px 16px',
                  backgroundColor: '#7f1d1d',
                  border: '1px solid #991b1b',
                  borderRadius: '5px',
                  color: '#fca5a5',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                Yes — Skip
              </button>
            </div>
          </div>
        </div>
      )}

      <footer className="app-footer">
        <h1>✈ KahunaAir Dispatch</h1>
        <button className="exit-button" onClick={handleExit} title="Gracefully shut down the application">
          ✕ EXIT
        </button>
      </footer>

      {/* Settings modal */}
      {showSettings && (
        <div style={{
          position: 'fixed',
          inset: 0,
          backgroundColor: 'rgba(0,0,0,0.85)',
          zIndex: 10000,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '16px'
        }}>
          <div style={{
            backgroundColor: '#0f1117',
            border: '1px solid #374151',
            borderRadius: '8px',
            padding: '24px',
            width: '100%',
            maxWidth: '480px',
            maxHeight: '90vh',
            overflowY: 'auto'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <h3 style={{ margin: 0, color: '#f9fafb', fontSize: '15px', fontWeight: 600 }}>⚙ Settings</h3>
              <button
                onClick={() => setShowSettings(false)}
                style={{ background: 'none', border: 'none', color: '#9ca3af', fontSize: '18px', cursor: 'pointer', padding: '0 4px' }}
              >✕</button>
            </div>

            {/* SayIntentions */}
            <div style={{ marginBottom: '6px', color: '#6b7280', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>SayIntentions.AI</div>
            {[['siApiKey', 'SI API Key'], ['siVaApiKey', 'SI VA API Key']].map(([field, label]) => (
              <div key={field} style={{ marginBottom: '12px' }}>
                <label style={{ display: 'block', color: '#9ca3af', fontSize: '12px', marginBottom: '4px' }}>{label}</label>
                <input
                  type="password"
                  value={settingsForm[field]}
                  onChange={e => setSettingsForm(f => ({ ...f, [field]: e.target.value }))}
                  style={{
                    width: '100%',
                    backgroundColor: '#1f2937',
                    border: '1px solid #374151',
                    borderRadius: '4px',
                    color: '#f9fafb',
                    fontSize: '13px',
                    padding: '7px 10px',
                    boxSizing: 'border-box',
                    outline: 'none'
                  }}
                />
              </div>
            ))}

            {/* OnAir */}
            <div style={{ marginBottom: '6px', marginTop: '16px', color: '#6b7280', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>OnAir</div>
            {[['oaCompanyId', 'Company ID'], ['oaApiKey', 'Company API Key'], ['oaVaId', 'VA ID'], ['oaVaApiKey', 'VA API Key'], ['oaPilotId', 'Pilot ID']].map(([field, label]) => (
              <div key={field} style={{ marginBottom: '12px' }}>
                <label style={{ display: 'block', color: '#9ca3af', fontSize: '12px', marginBottom: '4px' }}>{label}</label>
                <input
                  type={field.toLowerCase().includes('key') ? 'password' : 'text'}
                  value={settingsForm[field]}
                  onChange={e => setSettingsForm(f => ({ ...f, [field]: e.target.value }))}
                  style={{
                    width: '100%',
                    backgroundColor: '#1f2937',
                    border: '1px solid #374151',
                    borderRadius: '4px',
                    color: '#f9fafb',
                    fontSize: '13px',
                    padding: '7px 10px',
                    boxSizing: 'border-box',
                    outline: 'none'
                  }}
                />
              </div>
            ))}

            {/* SimBrief */}
            <div style={{ marginBottom: '6px', marginTop: '16px', color: '#6b7280', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>SimBrief</div>
            <div style={{ marginBottom: '12px' }}>
              <label style={{ display: 'block', color: '#9ca3af', fontSize: '12px', marginBottom: '4px' }}>Pilot ID</label>
              <input
                type="text"
                value={settingsForm.simBriefPilotId}
                onChange={e => setSettingsForm(f => ({ ...f, simBriefPilotId: e.target.value }))}
                style={{
                  width: '100%',
                  backgroundColor: '#1f2937',
                  border: '1px solid #374151',
                  borderRadius: '4px',
                  color: '#f9fafb',
                  fontSize: '13px',
                  padding: '7px 10px',
                  boxSizing: 'border-box',
                  outline: 'none'
                }}
              />
            </div>

            {settingsSaveStatus.startsWith('error') && (
              <div style={{ marginBottom: '12px', color: '#f87171', fontSize: '12px' }}>
                ⚠ {settingsSaveStatus.replace(/^error:/, '')}
              </div>
            )}

            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '8px' }}>
              <button
                onClick={() => setShowSettings(false)}
                style={{
                  padding: '8px 16px',
                  backgroundColor: 'transparent',
                  border: '1px solid #374151',
                  borderRadius: '5px',
                  color: '#9ca3af',
                  fontSize: '13px',
                  cursor: 'pointer'
                }}
              >Cancel</button>
              <button
                onClick={saveSettings}
                disabled={settingsSaveStatus === 'saving'}
                style={{
                  padding: '8px 20px',
                  backgroundColor: settingsSaveStatus === 'saved' ? '#065f46' : '#1d4ed8',
                  border: '1px solid ' + (settingsSaveStatus === 'saved' ? '#047857' : '#2563eb'),
                  borderRadius: '5px',
                  color: '#f9fafb',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: settingsSaveStatus === 'saving' ? 'not-allowed' : 'pointer'
                }}
              >
                {settingsSaveStatus === 'saving' ? 'Saving...' : settingsSaveStatus === 'saved' ? '✓ Saved' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

