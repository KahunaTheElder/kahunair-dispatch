import React, { useState, useEffect, useRef, useCallback, memo } from 'react'
import './AppMinimal.css'
import CrewProfileEditorV2 from './components/CrewProfileEditorV2'

// Module-level memoized component — defined outside AppMinimal so React never
// unmounts/remounts it during the 1-second telemetry re-renders, preserving scroll.
const SIDebugPanel = memo(function SIDebugPanel({ show, info, sendStatus, onClose }) {
  if (!show || !info) return null
  const payload = info.sentPayload
  return (
    <div style={{
      position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.88)', zIndex: 9500,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px'
    }}>
      <div style={{
        backgroundColor: '#0a0e1a', border: '1px solid #1e3a5f', borderRadius: '8px',
        padding: '20px', width: '100%', maxWidth: '860px', maxHeight: '88vh',
        overflowY: 'auto', fontFamily: 'monospace'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
          <h3 style={{ margin: 0, color: '#60a5fa', fontSize: '13px', fontWeight: 700, letterSpacing: '0.05em' }}>SI PAYLOAD INSPECTOR</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#6b7280', fontSize: '16px', cursor: 'pointer' }}>✕</button>
        </div>
        <div style={{ marginBottom: '14px', padding: '10px', backgroundColor: '#0f1623', borderRadius: '6px', border: '1px solid #1e3a5f' }}>
          <div style={{ fontSize: '11px', color: '#9ca3af', marginBottom: '4px' }}>RESPONSE</div>
          <div style={{ fontSize: '12px', color: info.siStatus === 'error' || sendStatus === 'error' ? '#f87171' : '#4ade80' }}>
            HTTP {info.siHttpStatus || '?'} — {info.message || '(no message)'}
          </div>
          <div style={{ fontSize: '11px', color: '#6b7280', marginTop: '4px' }}>Raw: {JSON.stringify(info.siRawResponse)}</div>
          <div style={{ fontSize: '10px', color: '#4b5563', marginTop: '4px' }}>{info.timestamp}</div>
        </div>
        {payload ? [['crew_data', 'CREW DATA'], ['copilot_data', 'COPILOT DATA'], ['dispatcher_data', 'DISPATCHER DATA']].map(([key, label]) => (
          <div key={key} style={{ marginBottom: '12px' }}>
            <div style={{ fontSize: '10px', color: '#60a5fa', letterSpacing: '0.08em', marginBottom: '4px' }}>{label}</div>
            <pre style={{
              margin: 0, padding: '10px', backgroundColor: '#0f1623', borderRadius: '4px',
              border: '1px solid #1e3a5f', fontSize: '11px', color: '#d1d5db',
              whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.5
            }}>{payload[key] || '(empty)'}</pre>
          </div>
        )) : <div style={{ color: '#6b7280', fontSize: '12px' }}>No payload data captured</div>}
      </div>
    </div>
  )
})

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
  const [crewCollapsed, setCrewCollapsed] = useState(() => {
    try { return localStorage.getItem('crewCollapsed') === 'true' } catch { return false }
  })
  const appRootRef = useRef(null)

  // Resize window when crew section collapses/expands
  useEffect(() => {
    try { localStorage.setItem('crewCollapsed', crewCollapsed) } catch {}
    if (!window.electronAPI?.setWindowHeight) return
    const timer = setTimeout(() => {
      const el = appRootRef.current
      if (!el) return
      // Sum heights of all direct children — works even when container is min-height: 100vh
      let contentH = 0
      for (const child of el.children) {
        contentH += child.getBoundingClientRect().height
      }
      contentH += 40 // padding top + bottom (20px each)
      const chromeOffset = window.outerHeight - window.innerHeight
      window.electronAPI.setWindowHeight(chromeOffset + Math.ceil(contentH))
    }, 80)
    return () => clearTimeout(timer)
  }, [crewCollapsed])
  const [cargoCharter, setCargoCharter] = useState({ cargos: [], charters: [] }) // NEW: Cargo/Charter data
  const [cargoStatus, setCargoStatus] = useState('IDLE') // IDLE | AWAITING_OA_START | LOADING | READY
  const [noFlight, setNoFlight] = useState(true) // true until OA confirms an active flight
  const [flightPollKey, setFlightPollKey] = useState(0) // increment to restart flight polling

  // Crew profile editor queue state
  const [crewQueue, setCrewQueue] = useState([])       // ordered list of { crewId, member } needing profiles
  const [queueIndex, setQueueIndex] = useState(0)      // current position in queue
  const [skipConfirm, setSkipConfirm] = useState(null) // crewId pending skip confirm, or null
  const [siSendStatus, setSiSendStatus] = useState('idle') // idle | sending | sent | error | waiting
  const [siDebugInfo, setSiDebugInfo] = useState(null)   // { sentPayload, siRawResponse, siHttpStatus, timestamp }
  const [showSiDebug, setShowSiDebug] = useState(false)  // toggle debug panel
  const closeSiDebug = useCallback(() => setShowSiDebug(false), [])
  const [siRunning, setSiRunning] = useState(null)       // null=unknown, true=running, false=not running
  const pendingSISendRef = useRef(null)                  // crew members queued to send once SI comes up
  const siFlightIdRef = useRef(null)                    // last known flight_id — changes on new SI session
  const siSentSessionRef = useRef(false)                // true after a successful send this Kahuna session
  const ofpProceduresRef = useRef(null)                 // OFP baseline procedures, set once on first OFP load
  const [siProcedures, setSiProcedures] = useState(null) // live procedures from SI flight.json

  // Settings modal state
  const [showSettings, setShowSettings] = useState(false)
  const [settingsForm, setSettingsForm] = useState({
    siApiKey: '', siVaApiKey: '', oaCompanyId: '', oaApiKey: '',
    oaVaId: '', oaVaApiKey: '', oaPilotId: '', simBriefPilotId: ''
  })
  const [settingsSaveStatus, setSettingsSaveStatus] = useState('idle') // idle | saving | saved | error

  // VA Profile modal state
  const [showVAProfile, setShowVAProfile] = useState(false)
  const [vaForm, setVAForm] = useState({
    name: '', about: '',
    crewGreeting: '', signatureAmenities: '', traditions: '',
    culture: '', safetyQuirks: '', humorPolicy: '',
    communicationStyle: 'formal, professional, to-the-point',
    serviceLevel: 'premium',
    dispatcherStyle: 'professional and supportive', companyPolicies: '',
    customNotes: ''
  })
  const [vaSaveStatus, setVASaveStatus] = useState('idle') // idle | saving | saved | error

  const openVAProfile = async () => {
    setVASaveStatus('idle')
    setShowVAProfile(true)
    try {
      const res = await fetch(`${apiUrl}/api/va/profile`, { signal: AbortSignal.timeout(5000) })
      if (res.ok) {
        const data = await res.json()
        if (data.success && data.profile) {
          const p = data.profile
          setVAForm({
            name: p.name || '',
            about: p.about || '',
            crewGreeting: p.crewGreeting || '',
            signatureAmenities: p.signatureAmenities || '',
            traditions: p.traditions || '',
            culture: p.culture || '',
            safetyQuirks: p.safetyQuirks || '',
            humorPolicy: p.humorPolicy || '',
            communicationStyle: p.communicationStyle || 'formal, professional, to-the-point',
            serviceLevel: p.serviceLevel || 'premium',
            dispatcherStyle: p.dispatcherStyle || 'professional and supportive',
            companyPolicies: p.companyPolicies || '',
            customNotes: p.customNotes || ''
          })
        }
      }
    } catch (e) {
      // Start with blank form if no profile saved yet
    }
  }

  const saveVAProfile = async () => {
    setVASaveStatus('saving')
    try {
      const res = await fetch(`${apiUrl}/api/va/profile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(vaForm),
        signal: AbortSignal.timeout(10000)
      })
      const data = await res.json()
      if (res.ok && data.success) {
        setVASaveStatus('saved')
        setTimeout(() => setShowVAProfile(false), 800)
      } else {
        setVASaveStatus(`error:${data.error || 'Save failed'}`)
      }
    } catch (e) {
      setVASaveStatus(`error:${e.message}`)
    }
  }

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

  // Auto-send when SI comes up while a send is pending
  useEffect(() => {
    if (siRunning === true && pendingSISendRef.current !== null) {
      const members = pendingSISendRef.current
      pendingSISendRef.current = null
      fireSISend(members)
    }
  }, [siRunning]) // eslint-disable-line react-hooks/exhaustive-deps

  // Fire SI send after all profiles are handled
  const fireSISend = async (members) => {
    // If SI is confirmed not running, queue the send until it starts
    if (siRunning === false) {
      console.log('[AppMinimal] SI not running — queuing send until detected')
      pendingSISendRef.current = members
      setSiSendStatus('waiting')
      return
    }
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
      // Store full diagnostic info regardless of outcome
      setSiDebugInfo({
        sentPayload: data.sentPayload || null,
        siRawResponse: data.siRawResponse,
        siHttpStatus: data.siHttpStatus,
        siStatus: data.siStatus,
        message: data.message,
        timestamp: data.timestamp || new Date().toISOString()
      })
      if (res.ok && data.success) {
        console.log('[AppMinimal] ✓ SI send success:', data.siStatus, data.siRawResponse)
        setSiSendStatus('sent')
        siSentSessionRef.current = true
      } else {
        console.error('[AppMinimal] SI send failed:', data.message, data.siRawResponse)
        setSiSendStatus('error')
      }
    } catch (error) {
      console.error('[AppMinimal] SI send error:', error.message)
      setSiSendStatus('error')
      setSiDebugInfo({ message: error.message, timestamp: new Date().toISOString() })
    }
  }

  // Advance queue after save or skip
  const advanceQueue = (currentIndex, queue, updatedMembers) => {
    const nextIndex = currentIndex + 1
    if (nextIndex < queue.length) {
      setQueueIndex(nextIndex)
      setEditingCrewId(queue[nextIndex].crewId)
    } else {
      // Queue exhausted — close editor first, then fire SI send in background
      setEditingCrewId(null)
      setCrewQueue([])
      setQueueIndex(0)
      fireSISend(updatedMembers) // fire-and-forget, don't await
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

  const handleNewFlight = () => {
    // Reset all flight state so a new flight can be loaded fresh
    setFlightPollKey(k => k + 1) // restart the flight polling interval
    setFlightData({
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
    setProcedures({
      departure: { runway: '---', sid: '---' },
      arrival: { runway: '---', star: '---' }
    })
    setCrew(null)
    setCrewProfiles({})
    setCargoCharter({ cargos: [], charters: [] })
    setCargoStatus('IDLE')
    setNoFlight(true)
    setCrewQueue([])
    setQueueIndex(0)
    setEditingCrewId(null)
    setSiSendStatus('idle')
    pendingSISendRef.current = null
    siSentSessionRef.current = false
    setSkipConfirm(null)
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
  const editingCrewIdRef = useRef(null) // Always-current editingCrewId for async callbacks
  useEffect(() => { editingCrewIdRef.current = editingCrewId }, [editingCrewId])

  // F12 opens DevTools for in-production debugging
  useEffect(() => {
    const onKey = e => { if (e.key === 'F12') window.electronAPI?.openDevTools?.() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

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

            // Auto-open settings modal if any required field is missing
            try {
              const sRes = await fetch(`${url}/api/settings`, { signal: AbortSignal.timeout(5000) })
              if (sRes.ok) {
                const sData = await sRes.json()
                const d = sData.data || {}
                const required = ['siApiKey', 'siVaApiKey', 'oaCompanyId', 'oaApiKey', 'oaVaId', 'oaVaApiKey', 'simBriefPilotId']
                const missing = required.some(f => !d[f])
                if (missing) {
                  // Pre-fill form and open
                  setSettingsForm({
                    siApiKey: d.siApiKey || '',
                    siVaApiKey: d.siVaApiKey || '',
                    oaCompanyId: d.oaCompanyId || '',
                    oaApiKey: d.oaApiKey || '',
                    oaVaId: d.oaVaId || '',
                    oaVaApiKey: d.oaVaApiKey || '',
                    oaPilotId: d.oaPilotId || '',
                    simBriefPilotId: d.simBriefPilotId || ''
                  })
                  setSettingsSaveStatus('idle')
                  setShowSettings(true)
                }
              } else {
                // 404 or error → definitely missing, open modal blank
                setSettingsSaveStatus('idle')
                setShowSettings(true)
              }
            } catch (e) {
              console.warn('[AppMinimal] Settings check failed:', e.message)
            }

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
      // Declare timeout outside try so it's accessible in catch
      let timeout = 30000
      if (pollCount > 1 && pollCount <= 5) {
        timeout = 20000
      } else if (pollCount > 5) {
        timeout = 10000
      }
      try {
        // After restart, backend can take longer to fully initialize
        // First poll: 30 seconds (backend may still be initializing)
        // Polls 2-5: 20 seconds (still warming up)
        // After that: 10 seconds (should be ready by then)

        console.log(`[AppMinimal] Health check #${pollCount} (timeout: ${timeout}ms, ${(timeout / 1000).toFixed(0)}s)...`)

        // Test backend health -- if this succeeds, assume all services are reachable
        const backRes = await fetch(`${apiUrl}/health`, {
          signal: AbortSignal.timeout(timeout)
        })

        if (backRes.ok) {
          console.log(`[AppMinimal] ✓ Backend is healthy (poll #${pollCount})`)
          setBackendStatus('online')
          setOnAirStatus('online')
          setSimConnectStatus('online')
          setSimBriefStatus('online')
          // Check SI independently via flight.json detection
          try {
            const siRes = await fetch(`${apiUrl}/api/si/status`, { signal: AbortSignal.timeout(3000) })
            if (siRes.ok) {
              const siData = await siRes.json()
              setSiRunning(siData.running)
              setSiStatus(siData.running ? 'online' : 'warning')
              // Detect flight_id rotation → new SI session started
              if (siData.running && siData.flight_id != null) {
                const prev = siFlightIdRef.current
                if (prev !== null && prev !== siData.flight_id && siSentSessionRef.current) {
                  // New SI session detected after a successful send → data is now active
                  setSiSendStatus('applied')
                }
                siFlightIdRef.current = siData.flight_id
              }
            }
          } catch {
            setSiRunning(null)
            setSiStatus('checking')
          }
        } else {
          console.warn(`[AppMinimal] Backend health check returned ${backRes.status}`)
          setBackendStatus('offline')
          setOnAirStatus('offline')
          setSiStatus('offline')
          setSiRunning(null)
          setSimConnectStatus('offline')
          setSimBriefStatus('offline')
        }
      } catch (error) {
        if (error.name === 'AbortError' || error.message.includes('signal')) {
          console.warn(`[AppMinimal] Status poll #${pollCount} TIMEOUT: Backend still initializing (${(timeout / 1000).toFixed(0)}s timeout reached)`)
        } else {
          console.warn(`[AppMinimal] Status poll #${pollCount} error:`, error.message)
        }
        setBackendStatus('offline')
        setOnAirStatus('offline')
        setSiStatus('offline')
        setSiRunning(null)
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

  // Poll flight data from /api/flights/active (includes crew)
  // Polls every 60 seconds until flight + crew data is received, then stops.
  // Reset by flightPollKey (incremented by New Flight button).
  useEffect(() => {
    let interval
    let hasData = false

    const pollFlight = async () => {
      if (hasData) return // flight + crew already loaded — skip
      try {
        const res = await fetch(`${apiUrl}/api/flights/active`, {
          signal: AbortSignal.timeout(5000)
        })
        if (res.ok) {
          const json = await res.json()
          if (json.success && json.flights && json.flights.length > 0) {
            setNoFlight(false)
            const activeFlight = json.flights[0]
            console.log('[AppMinimal] Active flight:', activeFlight.id, activeFlight.route?.departure?.ICAO, activeFlight.route?.arrival?.ICAO)
            setCrew(activeFlight.crew)
            setFlightData(prev => ({
              ...prev || {},
              flightNumber: activeFlight.id,
              departure: activeFlight.route?.departure,
              arrival: activeFlight.route?.arrival
            }))

            // Fetch cargo/charter data
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
              // Silently fail cargo/charter
            }

            // Stop polling once we have flight AND crew
            if (activeFlight.crew?.members?.length > 0) {
              hasData = true
              clearInterval(interval)
              console.log('[AppMinimal] ✓ Flight + crew received — flight polling stopped')
            }
          } else {
            setNoFlight(true)
          }
        }
      } catch (error) {
        // Silently fail
      }
    }

    pollFlight()
    interval = setInterval(pollFlight, 60000)
    return () => clearInterval(interval)
  }, [apiUrl, flightPollKey])

  // Load crew profiles when crew data changes — build queue for missing profiles
  useEffect(() => {
    if (!crew || !crew.members || crew.members.length === 0) return

    let isMounted = true // prevent stale state updates if crew changes mid-fetch

    const loadCrewProfiles = async () => {
      const profiles = {}
      const queue = []

      // Sort: Captain first (isMe), then FO, then FAs
      const sorted = [...crew.members].sort((a, b) => {
        const order = { Captain: 0, 'First Officer': 1, 'Flight Attendant': 2 }
        return (order[a.role] ?? 3) - (order[b.role] ?? 3)
      })

      for (const member of sorted) {
        if (!isMounted) return // crew changed while loading — bail out
        // Captain always uses my-pilot profile key
        const profileId = member.isMe ? 'my-pilot' : member.id

        try {
          const res = await fetch(`${apiUrl}/api/crew/${profileId}/profile`, {
            signal: AbortSignal.timeout(5000)
          })

          if (res.ok) {
            const data = await res.json()
            if (data.profile && data.profile.background) {
              // Only treat as complete if it has the new-format background field
              // Old stub profiles (personality: string, no background) are re-queued
              profiles[profileId] = data.profile
            } else if (data.profile) {
              // Old-format stub — queue for new editor
              console.log('[AppMinimal] Old-format profile (no background) for', member.name, '→ re-queued')
              queue.push({ crewId: profileId, member })
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

      if (!isMounted) return // bail out before any state updates

      setCrewProfiles(profiles)

      if (queue.length === 0) {
        // All profiles exist — fire SI send immediately
        console.log('[AppMinimal] All crew profiled — firing SI send')
        setSiSendStatus('idle')
        setCrewQueue([])
        setQueueIndex(0)
        setEditingCrewId(null)
        fireSISend(crew.members) // fire-and-forget
      } else {
        // Check if we're already editing someone still in this queue (60s re-poll re-runs this)
        const currentEditing = editingCrewIdRef.current
        const alreadyEditingInQueue = currentEditing && queue.some(q => q.crewId === currentEditing)
        if (alreadyEditingInQueue) {
          // Re-poll fired while editor was open — just refresh queue data, don't reset position
          console.log('[AppMinimal] Re-poll while editing', currentEditing, '— keeping position')
          setCrewQueue(queue)
        } else {
          // Fresh queue start
          setCrewQueue(queue)
          setQueueIndex(0)
          setEditingCrewId(queue[0].crewId)
          console.log('[AppMinimal] Crew queue built:', queue.length, 'missing profiles')
        }
      }
    }

    loadCrewProfiles()
    return () => { isMounted = false }
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

          // Capture OFP baseline once — used later to detect SI procedure changes
          if (!ofpProceduresRef.current) {
            ofpProceduresRef.current = {
              depRwy: ofp.departure?.runway || null,
              sid: ofp.departure?.SID || null,
              arrRwy: ofp.arrival?.runway || null,
              star: ofp.arrival?.STAR || null
            }
          }
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

  // Poll SI flight.json every 15s for live procedure changes (STAR, SID, runway, approach)
  useEffect(() => {
    if (!siRunning) {
      setSiProcedures(null)
      return
    }
    const pollProcs = async () => {
      try {
        const res = await fetch(`${apiUrl}/api/si/procedures`, { signal: AbortSignal.timeout(5000) })
        if (!res.ok) return
        const json = await res.json()
        if (json.success && json.procedures) {
          setSiProcedures(json.procedures)
        }
      } catch { /* silent — flight.json may not exist yet */ }
    }
    pollProcs()
    const interval = setInterval(pollProcs, 15000)
    return () => clearInterval(interval)
  }, [apiUrl, siRunning])

  const StatusDot = ({ status, label }) => {
    const dotColor = {
      'online': '#4ade80',
      'offline': '#ef4444',
      'checking': '#fbbf24',
      'warning': '#f59e0b'
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
    if (noFlight) {
      return (
        <div className="cargo-charter-section">
          <div className="cargo-status-message" style={{ color: '#6b7280', fontStyle: 'italic' }}>Waiting for OnAir Flight...</div>
        </div>
      )
    }

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

    const depRwy = siProcedures?.depRwy || procedures?.departure?.runway || '---'
    const depSid = siProcedures?.sid || procedures?.departure?.sid || '---'
    const arrRwy = siProcedures?.arrRwy || procedures?.arrival?.runway || '---'
    const arrStar = siProcedures?.star || procedures?.arrival?.star || '---'
    const approach = siProcedures?.approach || null

    // Detect changes vs OFP baseline (highlight amber when SI value differs from what was filed)
    const ofpBase = ofpProceduresRef.current
    const chgDepRwy = ofpBase && siProcedures?.depRwy && siProcedures.depRwy !== ofpBase.depRwy
    const chgSid = ofpBase && siProcedures?.sid && siProcedures.sid !== ofpBase.sid
    const chgStar = ofpBase && siProcedures?.star && siProcedures.star !== ofpBase.star
    const chgArrRwy = ofpBase && siProcedures?.arrRwy && siProcedures.arrRwy !== ofpBase.arrRwy

    const siGate = siProcedures?.gate || null
    const siTaxiPath = siProcedures?.taxiPath || null

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
          <span style={chgDepRwy ? { color: '#fbbf24' } : undefined} title={chgDepRwy ? `was: ${ofpBase.depRwy}` : undefined}>RWY {depRwy}{chgDepRwy ? ' ↑' : ''}</span>
          {' | '}
          <span style={chgSid ? { color: '#fbbf24' } : undefined} title={chgSid ? `was: ${ofpBase.sid}` : undefined}>SID {depSid}{chgSid ? ' ↑' : ''}</span>
          {' | '}
          <span style={chgStar ? { color: '#fbbf24' } : undefined} title={chgStar ? `was: ${ofpBase.star}` : undefined}>STAR {arrStar}{chgStar ? ' ↑' : ''}</span>
          {' | '}
          <span style={chgArrRwy ? { color: '#fbbf24' } : undefined} title={chgArrRwy ? `was: ${ofpBase.arrRwy}` : undefined}>RWY {arrRwy}{chgArrRwy ? ' ↑' : ''}</span>
          {approach && <span style={{ color: '#60a5fa', fontWeight: 600 }}>{' | '}APPR {approach}</span>}
        </div>
        {(siGate || siTaxiPath) && (
          <div className="flight-procedures-text" style={{ color: '#34d399' }}>
            {siGate && <span>GATE {siGate}</span>}
            {siGate && siTaxiPath && <span>{' | '}</span>}
            {siTaxiPath && <span>TAXI {siTaxiPath}</span>}
          </div>
        )}
        <div className="flight-route-text">
          {route}
        </div>
        <div className="flight-params-text">
          TOW {flightData.tow}K | BF {flightData.blockFuel}K | AVG WIND {formattedWind} | ISA {isaDisplay}°
        </div>
        {/* Cargo: type name + weight, or waiting message */}
        {noFlight ? (
          <div className="flight-cargo-text" style={{ color: '#fbbf24' }}>⏳ Waiting for OnAir Flight...</div>
        ) : cargoCharter.cargos?.length > 0 ? (
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
    }[profile?.personality?.style] || '#6b7280'

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
            {profile?.personality?.style || 'standard'}
          </div>
          <button className="crew-edit-btn" onClick={() => onEdit(crewId)}>
            Edit
          </button>
        </div>
      </div>
    )
  }

  const CrewDisplay = () => {
    const chevron = crewCollapsed ? '▸' : '▾'

    if (!crew || !crew.members || crew.members.length === 0) {
      return (
        <div className="crew-section">
          <div className="crew-title crew-title-toggle" onClick={() => setCrewCollapsed(v => !v)}>
            <span className="crew-chevron">{chevron}</span> CREW
          </div>
          {!crewCollapsed && (
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
          )}
        </div>
      )
    }

    // Separate crew by role
    const captain = crew.members.find(m => m.role === 'Captain')
    const firstOfficer = crew.members.find(m => m.role === 'First Officer')
    const attendants = crew.members.filter(m => m.role === 'Flight Attendant')

    // SI status badge (clickable if we have debug info)
    const siBadge = siSendStatus === 'applied'
      ? <span onClick={(e) => { e.stopPropagation(); setShowSiDebug(v => !v) }} style={{ marginLeft: '10px', fontSize: '11px', color: '#4ade80', fontWeight: 600, cursor: siDebugInfo ? 'pointer' : 'default', textDecoration: siDebugInfo ? 'underline dotted' : 'none' }}>✓ Active in new session! {siDebugInfo ? '(details)' : ''}</span>
      : siSendStatus === 'sent'
      ? <span onClick={(e) => { e.stopPropagation(); setShowSiDebug(v => !v) }} style={{ marginLeft: '10px', fontSize: '11px', color: '#86efac', fontWeight: 600, cursor: siDebugInfo ? 'pointer' : 'default', textDecoration: siDebugInfo ? 'underline dotted' : 'none' }}>✓ Sent — applies next SI flight {siDebugInfo ? '(details)' : ''}</span>
      : siSendStatus === 'sending'
      ? <span style={{ marginLeft: '10px', fontSize: '11px', color: '#fbbf24', fontWeight: 600 }}>⟳ Sending...</span>
      : siSendStatus === 'waiting'
      ? <span style={{ marginLeft: '10px', fontSize: '11px', color: '#f59e0b', fontWeight: 600 }}>⏳ Waiting for SI...</span>
      : siSendStatus === 'error'
      ? <span onClick={(e) => { e.stopPropagation(); setShowSiDebug(v => !v) }} style={{ marginLeft: '10px', fontSize: '11px', color: '#f87171', fontWeight: 600, cursor: siDebugInfo ? 'pointer' : 'default', textDecoration: siDebugInfo ? 'underline dotted' : 'none' }}>⚠ SI Error {siDebugInfo ? '(details)' : ''}</span>
      : null

    // Collapsed summary: names of crew members
    const crewSummary = crew.members.map(m => {
      const roleAbbr = m.role === 'Captain' ? 'CPT' : m.role === 'First Officer' ? 'F/O' : 'FA'
      return `${roleAbbr}: ${m.name}`
    }).join('  •  ')

    return (
      <div className="crew-section">
        <div className="crew-title crew-title-toggle" style={{ display: 'flex', alignItems: 'center' }} onClick={() => setCrewCollapsed(v => !v)}>
          <span className="crew-chevron">{chevron}</span> CREW {siBadge}
          {crewCollapsed && (
            <span className="crew-collapsed-summary">{crewSummary}</span>
          )}
        </div>
        {!crewCollapsed && (
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
        )}
      </div>
    )
  }

  return (
    <div className="app-minimal" ref={appRootRef}>
      <SIDebugPanel show={showSiDebug} info={siDebugInfo} sendStatus={siSendStatus} onClose={closeSiDebug} />
      <div className="top-bar">
        <TelemetryDisplay />
        <div className="status-indicators">
          <StatusDot status={backendStatus} label="BE" />
          <StatusDot status={onAirStatus} label="OA" />
          <StatusDot status={siStatus} label="SI" />
          <StatusDot status={simConnectStatus} label="SC" />
          <StatusDot status={simBriefStatus} label="SB" />
          <button
            onClick={openVAProfile}
            title="VA Profile — airline identity for SayIntentions.AI"
            style={{
              background: 'none',
              border: '1px solid #374151',
              borderRadius: '4px',
              color: '#9ca3af',
              cursor: 'pointer',
              fontSize: '13px',
              padding: '2px 6px',
              marginLeft: '4px',
              lineHeight: 1
            }}
          >🏢</button>
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
            ? (crew?.members?.find(m => m.isMe) ?? crew?.members?.find(m => m.role === 'Captain'))?.name
            : crew?.members?.find(m => m.id === editingCrewId)?.name
        }
        crewRole={
          editingCrewId === 'my-pilot'
            ? 'Captain'
            : crew?.members?.find(m => m.id === editingCrewId)?.role
        }
        crewHours={
          editingCrewId === 'my-pilot'
            ? ((crew?.members?.find(m => m.isMe) ?? crew?.members?.find(m => m.role === 'Captain'))?.hours || 0)
            : (crew?.members?.find(m => m.id === editingCrewId)?.hours || 0)
        }
        crewFlights={
          editingCrewId === 'my-pilot'
            ? ((crew?.members?.find(m => m.isMe) ?? crew?.members?.find(m => m.role === 'Captain'))?.flights || 0)
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
                  ? ((crew?.members?.find(m => m.isMe) ?? crew?.members?.find(m => m.role === 'Captain'))?.name || 'Captain')
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

      <div className="new-flight-btn-container">
        <button
          className="resend-si-button"
          onClick={() => crew?.members?.length && fireSISend(crew.members)}
          disabled={!crew?.members?.length || siSendStatus === 'sending' || siSendStatus === 'waiting'}
          title={siRunning === false ? 'SayIntentions.AI not detected — will send automatically when SI starts' : 'Resend crew & flight data to SayIntentions.AI'}
        >
          {siSendStatus === 'sending' ? '⏳ SENDING...'
            : siSendStatus === 'waiting' ? '⏳ WAITING FOR SI...'
            : siSendStatus === 'applied' ? '✓ ACTIVE — RESEND?'
            : '↺ RESEND TO SI'}
        </button>
        <button className="new-flight-button" onClick={handleNewFlight} title="Reset for a new flight">
          ✈ NEW FLIGHT
        </button>
      </div>

      {/* VA Profile modal */}
      {showVAProfile && (
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
            maxWidth: '540px',
            maxHeight: '90vh',
            overflowY: 'auto'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
              <h3 style={{ margin: 0, color: '#f9fafb', fontSize: '15px', fontWeight: 600 }}>🏢 VA Profile</h3>
              <button
                onClick={() => setShowVAProfile(false)}
                style={{ background: 'none', border: 'none', color: '#9ca3af', fontSize: '18px', cursor: 'pointer', padding: '0 4px' }}
              >✕</button>
            </div>
            <p style={{ margin: '0 0 20px', color: '#6b7280', fontSize: '12px', lineHeight: 1.5 }}>
              Your virtual airline identity — used by SayIntentions.AI to shape the personality of ATC, crew interactions, and dispatcher briefings.
            </p>

            {/* ── IDENTITY ── */}
            <div style={{ marginBottom: '6px', color: '#6b7280', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Identity</div>
            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', color: '#9ca3af', fontSize: '12px', marginBottom: '4px' }}>Airline Name</label>
              <input
                type="text"
                value={vaForm.name}
                onChange={e => setVAForm(f => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Kahuna Air Industries"
                style={{ width: '100%', backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '4px', color: '#f9fafb', fontSize: '13px', padding: '7px 10px', boxSizing: 'border-box', outline: 'none' }}
              />
            </div>

            {/* ── ABOUT ── */}
            <div style={{ marginBottom: '6px', color: '#6b7280', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>About Your Airline</div>
            <div style={{ marginBottom: '16px' }}>
              <textarea
                value={vaForm.about}
                onChange={e => setVAForm(f => ({ ...f, about: e.target.value }))}
                placeholder="Brief history, mission, and focus area of your virtual airline..."
                rows={3}
                style={{ width: '100%', backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '4px', color: '#f9fafb', fontSize: '13px', padding: '7px 10px', boxSizing: 'border-box', outline: 'none', resize: 'vertical', fontFamily: 'inherit' }}
              />
            </div>

            {/* ── CREW SERVICE STANDARDS ── */}
            <div style={{ marginBottom: '6px', color: '#6b7280', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Crew Service Standards</div>
            <div style={{ marginBottom: '10px' }}>
              <label style={{ display: 'block', color: '#9ca3af', fontSize: '12px', marginBottom: '2px' }}>Passenger Greeting</label>
              <div style={{ color: '#4b5563', fontSize: '11px', marginBottom: '4px' }}>How does your crew greet passengers?</div>
              <input
                type="text"
                value={vaForm.crewGreeting}
                onChange={e => setVAForm(f => ({ ...f, crewGreeting: e.target.value }))}
                placeholder='e.g. "Aloha everyone, welcome aboard Kahuna Air!"'
                style={{ width: '100%', backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '4px', color: '#f9fafb', fontSize: '13px', padding: '7px 10px', boxSizing: 'border-box', outline: 'none' }}
              />
            </div>
            <div style={{ marginBottom: '10px' }}>
              <label style={{ display: 'block', color: '#9ca3af', fontSize: '12px', marginBottom: '2px' }}>Signature Service</label>
              <div style={{ color: '#4b5563', fontSize: '11px', marginBottom: '4px' }}>Signature amenities or in-flight offerings</div>
              <input
                type="text"
                value={vaForm.signatureAmenities}
                onChange={e => setVAForm(f => ({ ...f, signatureAmenities: e.target.value }))}
                placeholder="e.g. complimentary leis on arrival, island cocktails on long-hauls"
                style={{ width: '100%', backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '4px', color: '#f9fafb', fontSize: '13px', padding: '7px 10px', boxSizing: 'border-box', outline: 'none' }}
              />
            </div>
            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', color: '#9ca3af', fontSize: '12px', marginBottom: '2px' }}>Traditions & Rituals</label>
              <div style={{ color: '#4b5563', fontSize: '11px', marginBottom: '4px' }}>Pre-flight rituals, in-flight customs, milestone celebrations</div>
              <textarea
                value={vaForm.traditions}
                onChange={e => setVAForm(f => ({ ...f, traditions: e.target.value }))}
                placeholder="e.g. Captain's pre-flight speech always ends with 'Blue skies ahead'. First 100-hour milestone celebrated with champagne."
                rows={2}
                style={{ width: '100%', backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '4px', color: '#f9fafb', fontSize: '13px', padding: '7px 10px', boxSizing: 'border-box', outline: 'none', resize: 'vertical', fontFamily: 'inherit' }}
              />
            </div>

            {/* ── AIRLINE CULTURE ── */}
            <div style={{ marginBottom: '6px', color: '#6b7280', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Airline Culture</div>
            <div style={{ marginBottom: '10px' }}>
              <label style={{ display: 'block', color: '#9ca3af', fontSize: '12px', marginBottom: '2px' }}>Airline Personality</label>
              <div style={{ color: '#4b5563', fontSize: '11px', marginBottom: '4px' }}>What defines your airline's identity and character?</div>
              <textarea
                value={vaForm.culture}
                onChange={e => setVAForm(f => ({ ...f, culture: e.target.value }))}
                placeholder="e.g. Island hospitality meets professional aviation standards. Warmth, family spirit, and a love of the Pacific."
                rows={2}
                style={{ width: '100%', backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '4px', color: '#f9fafb', fontSize: '13px', padding: '7px 10px', boxSizing: 'border-box', outline: 'none', resize: 'vertical', fontFamily: 'inherit' }}
              />
            </div>
            <div style={{ marginBottom: '10px' }}>
              <label style={{ display: 'block', color: '#9ca3af', fontSize: '12px', marginBottom: '2px' }}>Safety & Policy Quirks</label>
              <div style={{ color: '#4b5563', fontSize: '11px', marginBottom: '4px' }}>Any non-standard safety rules or procedures SI should know about</div>
              <input
                type="text"
                value={vaForm.safetyQuirks}
                onChange={e => setVAForm(f => ({ ...f, safetyQuirks: e.target.value }))}
                placeholder="e.g. All crew must verbally confirm door-check, strict no-phone policy at altitude"
                style={{ width: '100%', backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '4px', color: '#f9fafb', fontSize: '13px', padding: '7px 10px', boxSizing: 'border-box', outline: 'none' }}
              />
            </div>
            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', color: '#9ca3af', fontSize: '12px', marginBottom: '2px' }}>Cabin Tone Policy</label>
              <div style={{ color: '#4b5563', fontSize: '11px', marginBottom: '4px' }}>What's the cabin humor or tone policy?</div>
              <input
                type="text"
                value={vaForm.humorPolicy}
                onChange={e => setVAForm(f => ({ ...f, humorPolicy: e.target.value }))}
                placeholder="e.g. One island-themed pun per flight is permitted; professional otherwise"
                style={{ width: '100%', backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '4px', color: '#f9fafb', fontSize: '13px', padding: '7px 10px', boxSizing: 'border-box', outline: 'none' }}
              />
            </div>

            {/* ── OPERATIONS ── */}
            <div style={{ marginBottom: '6px', color: '#6b7280', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Operations</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '16px' }}>
              <div>
                <label style={{ display: 'block', color: '#9ca3af', fontSize: '12px', marginBottom: '4px' }}>Communication Style</label>
                <select
                  value={vaForm.communicationStyle}
                  onChange={e => setVAForm(f => ({ ...f, communicationStyle: e.target.value }))}
                  style={{ width: '100%', backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '4px', color: '#f9fafb', fontSize: '13px', padding: '7px 10px', boxSizing: 'border-box', outline: 'none' }}
                >
                  <option value="formal, professional, to-the-point">Formal & Professional</option>
                  <option value="professional, friendly">Professional & Friendly</option>
                  <option value="casual, conversational">Casual & Conversational</option>
                  <option value="relaxed, humorous">Relaxed & Humorous</option>
                </select>
              </div>
              <div>
                <label style={{ display: 'block', color: '#9ca3af', fontSize: '12px', marginBottom: '4px' }}>Service Level</label>
                <select
                  value={vaForm.serviceLevel}
                  onChange={e => setVAForm(f => ({ ...f, serviceLevel: e.target.value }))}
                  style={{ width: '100%', backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '4px', color: '#f9fafb', fontSize: '13px', padding: '7px 10px', boxSizing: 'border-box', outline: 'none' }}
                >
                  <option value="standard">Standard</option>
                  <option value="premium">Premium</option>
                  <option value="ultra-premium">Ultra-Premium</option>
                </select>
              </div>
            </div>

            {/* ── DISPATCHER ── */}
            <div style={{ marginBottom: '6px', color: '#6b7280', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Dispatcher</div>
            <div style={{ marginBottom: '10px' }}>
              <label style={{ display: 'block', color: '#9ca3af', fontSize: '12px', marginBottom: '4px' }}>Dispatcher Style</label>
              <input
                type="text"
                value={vaForm.dispatcherStyle}
                onChange={e => setVAForm(f => ({ ...f, dispatcherStyle: e.target.value }))}
                placeholder="e.g. professional and supportive"
                style={{ width: '100%', backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '4px', color: '#f9fafb', fontSize: '13px', padding: '7px 10px', boxSizing: 'border-box', outline: 'none' }}
              />
            </div>
            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', color: '#9ca3af', fontSize: '12px', marginBottom: '2px' }}>Company Policies</label>
              <div style={{ color: '#4b5563', fontSize: '11px', marginBottom: '4px' }}>Operational policies, reporting requirements, company-specific quirks</div>
              <textarea
                value={vaForm.companyPolicies}
                onChange={e => setVAForm(f => ({ ...f, companyPolicies: e.target.value }))}
                placeholder="e.g. All flights must log fuel at T/O and T/D. Delays over 20 min require dispatch notification."
                rows={2}
                style={{ width: '100%', backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '4px', color: '#f9fafb', fontSize: '13px', padding: '7px 10px', boxSizing: 'border-box', outline: 'none', resize: 'vertical', fontFamily: 'inherit' }}
              />
            </div>

            {/* ── ADDITIONAL NOTES ── */}
            <div style={{ marginBottom: '6px', color: '#6b7280', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Additional Notes</div>
            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', color: '#9ca3af', fontSize: '12px', marginBottom: '2px' }}>Custom Notes for SI</label>
              <div style={{ color: '#4b5563', fontSize: '11px', marginBottom: '4px' }}>Anything else you want SayIntentions.AI to know</div>
              <textarea
                value={vaForm.customNotes}
                onChange={e => setVAForm(f => ({ ...f, customNotes: e.target.value }))}
                placeholder="Any special instructions, operational quirks, or context for SayIntentions.AI..."
                rows={3}
                style={{ width: '100%', backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '4px', color: '#f9fafb', fontSize: '13px', padding: '7px 10px', boxSizing: 'border-box', outline: 'none', resize: 'vertical', fontFamily: 'inherit' }}
              />
            </div>

            {vaSaveStatus.startsWith('error') && (
              <div style={{ marginBottom: '12px', color: '#f87171', fontSize: '12px' }}>
                ⚠ {vaSaveStatus.replace(/^error:/, '')}
              </div>
            )}

            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button
                onClick={() => setShowVAProfile(false)}
                style={{ padding: '8px 16px', backgroundColor: 'transparent', border: '1px solid #374151', borderRadius: '5px', color: '#9ca3af', fontSize: '13px', cursor: 'pointer' }}
              >Cancel</button>
              <button
                onClick={saveVAProfile}
                disabled={vaSaveStatus === 'saving'}
                style={{
                  padding: '8px 20px',
                  backgroundColor: vaSaveStatus === 'saved' ? '#065f46' : '#1d4ed8',
                  border: '1px solid ' + (vaSaveStatus === 'saved' ? '#047857' : '#2563eb'),
                  borderRadius: '5px',
                  color: '#f9fafb',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: vaSaveStatus === 'saving' ? 'not-allowed' : 'pointer'
                }}
              >
                {vaSaveStatus === 'saving' ? 'Saving...' : vaSaveStatus === 'saved' ? '✓ Saved' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

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
            {[['siApiKey', 'SI Pilot Key'], ['siVaApiKey', 'SI VA Key']].map(([field, label]) => (
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

            <div style={{ borderTop: '1px solid #1f2937', margin: '16px 0 12px', paddingTop: '12px' }}>
              <button
                onClick={() => { setShowSettings(false); openVAProfile() }}
                style={{ background: 'none', border: 'none', color: '#6b7280', fontSize: '12px', cursor: 'pointer', padding: 0, textDecoration: 'underline' }}
              >🏢 Edit VA Profile</button>
            </div>

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

