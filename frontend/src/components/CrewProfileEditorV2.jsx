import React, { useState, useEffect, useCallback } from 'react'

// =============================================================================
// Crew Profile Editor V2
// Full-screen modal for editing/randomizing a crew member's personality profile.
// =============================================================================

// ---- Pool Definitions -------------------------------------------------------

const CAPTAIN_SPECIALTIES = [
  'Long-haul international operations',
  'Multi-engine turboprop transitions',
  'High-altitude mountain flying',
  'Oceanic / ETOPS certified',
  'Cargo and freight operations',
  'Corporate charter and VIP transport',
  'Low-visibility CAT III approaches',
  'Island and short-field operations',
  'Heavy widebody aircraft transitions',
  'Regional jet operations',
  'Military transport conversion',
  'Medevac and air ambulance',
  'Aerial survey and special missions',
  'Check airman and line training',
  'Simulator instructor qualification',
  'Cold weather and arctic operations',
  'Overwater emergency procedures specialist',
  'Reduced vertical separation minimum (RVSM) operations',
  'Advanced avionics (glass cockpit) specialist',
  'Commuter / high-frequency short-sector operations',
  'Low-level tactical flying background',
  'Ferry and delivery flights (international)',
  'Fire suppression air tanker background',
  'Maritime patrol adaptation',
  'Selective calling (SELCAL) and HF communications specialist'
]

const CAPTAIN_PROCEDURE_STYLES = [
  'By the book — strict SOP adherence',
  'Methodical — thorough, no shortcuts',
  'Efficient — SOP-compliant but time-aware',
  'Old school — technique-based, high manual-flying preference',
  'Glass-pit native — automation-forward',
  'Crew-centric — heavy CRM emphasis',
  'Data-driven — cross-checks everything',
  'Safety-first — conservative decision margins',
  'Adaptive — adjusts style to conditions',
  'Mentoring style — explains decisions to FO',
  'Quiet professional — minimal verbosity, maximum precision',
  'Proactive briefer — front-loads all information',
  'Checklist guardian — never skips, never rushes',
  'Situational awareness focused — always ahead of the aircraft',
  'Communication-heavy — keeps crew well informed',
  'Minimalist — only says what\'s needed',
  'Risk-manager — explicit go/no-go criteria',
  'High-autonomy — trusts FO, delegates fully',
  'Assertive — takes control early in abnormals',
  'Collaborative — consensus-based decision making'
]

const CAPTAIN_PERSONALITY_STYLES = [
  'Professional and composed',
  'Warm but authoritative',
  'Direct and no-nonsense',
  'Thoughtful and deliberate',
  'Quietly confident',
  'Personable and approachable',
  'Firm but fair',
  'Reserved and focused',
  'Inspirational — leads by example',
  'Deadpan humor, dry wit',
  'Formal — strictly professional',
  'Energetic and enthusiastic',
  'Steady and reassuring',
  'Stoic under pressure',
  'Analytical — processes before speaking',
  'Naturally curious — asks good questions',
  'Experienced storyteller — uses examples from career',
  'Tactical — always focused on the next step',
  'Patient mentor',
  'Efficient communicator — brief and clear',
  'Slightly old-fashioned — prefers manual flying',
  'Optimist — always finds a path forward',
  'Detail-oriented perfectionist',
  'Protective of the crew',
  'Humble — credits the team'
]

const COMMUNICATION_PREFERENCES = [
  'Formal standard phraseology',
  'Structured with clear callouts',
  'Concise, information-dense',
  'Warm but precise',
  'Military-influenced, clipped',
  'Conversational in cruise, formal on approach',
  'Narrative-style briefings',
  'Bullet-point style, no rambling',
  'Check-in and acknowledge style',
  'Prefers written/ACARS for non-urgent items',
  'Proactive — announces intentions early',
  'Collaborative — invites FO input',
  'Decisive — no ambiguity in callouts',
  'Safety-focused phrasing',
  'Standardized across all phases of flight',
  'Adapts tone to workload level',
  'Calm monotone, professional',
  'Assertive in high-workload, relaxed in cruise',
  'Clear and deliberate — never rushed',
  'Minimal chatter — conserves radio time'
]

const CAPTAIN_CREW_INTERACTIONS = [
  'Empowers FO with full authority on normal operations',
  'Encourages open communication — speaks up early',
  'Clear on role boundaries; collaborative in grey areas',
  'Runs tight briefs; expects FO to be fully prepared',
  'Calm under pressure; models composure for crew',
  'Welcomes challenge and alternate viewpoints',
  'Builds team rapport in cruise, formal on approach',
  'Delegates non-critical tasks freely to FO',
  'Maintains clear CRM structure from boarding to parking',
  'High situation-sharing; verbalizes intentions proactively'
]

const FO_PERSONALITY_STYLES = [
  'Eager and detail-focused',
  'Quietly competent',
  'Proactive on callouts',
  'Reserved but reliable',
  'By-the-book, consistent',
  'Friendly — easy rapport with captain',
  'Slightly deferential by rank, confident in knowledge',
  'Technically sharp — systems expert',
  'Dry humor during cruise',
  'Asks good clarifying questions',
  'New to the type — extra careful',
  'Experienced — confident contributor',
  'Trivia buff — shares facts during cruise',
  'Weather-focused — always checks conditions',
  'Fuel monitor — tracks consumption carefully',
  'Checklist-first mentality',
  'Conversational and warm in cruise',
  'Formal and precise during procedures',
  'Situationally aware — catches things early',
  'Team player — backs up captain fully',
  'Safety advocate — willing to speak up',
  'Efficient — keeps things moving',
  'Methodical — no step skipped',
  'Diplomatic — handles disagreements well',
  'Enthusiastic about aviation history and aircraft'
]

const FO_SPECIALTIES = [
  'Regional jet background',
  'Turboprop multi-engine',
  'General aviation cross-country',
  'Instructing background — PPL/IR',
  'Military flight school',
  'Desert/hot-and-high operations',
  'Coastal and overwater',
  'Freight and cargo operation',
  'Sim-heavy training, low flight hours',
  'Corporate/charter transitions',
  'Island and remote strip operations',
  'High-density traffic environment (major hub)',
  'International oceanic sectors',
  'Night freight specialist',
  'Mountain and terrain awareness',
  'Instrument flight only — low VFR experience',
  'Emergency procedures specialist',
  'CRM facilitator background',
  'Fuel planning and dispatch cross-trained',
  'Weather avoidance specialist',
  'Long-haul fatigue management trained',
  'Type rating just completed — new to line',
  'Accelerated upgrade program graduate',
  'Airline cadet program direct entry',
  'University aviation degree — systems focus'
]

const FA_SERVICE_STYLES = [
  'Premium cabin — formal and attentive',
  'Warm and welcoming — hospitality-first',
  'Efficient — fast service, minimal fuss',
  'Safety-first — procedures before service',
  'Luxury-trained — anticipates every need',
  'Island hospitality style — relaxed and friendly',
  'Corporate charter — VIP service standard',
  'High-energy — upbeat and positive',
  'Calm and reassuring — particularly good with nervous flyers',
  'Professional minimalist — visible only when needed',
  'Storytelling style — engages passengers with context',
  'Children-friendly — warm with families',
  'Medically trained — calm in emergencies',
  'Multilingual service — adapts to passenger language',
  'High-frequency shuttle style — fast turnaround cadence',
  'Formal airline tradition — structured announcements',
  'Modern casual — approachable and genuine',
  'Galley-focused — strong on food service quality',
  'Safety-briefing perfectionist — every word right',
  'Passenger advocate — goes above and beyond',
  'Silent service — reads the cabin, responds proactively',
  'Experienced charters — handles unusual requests smoothly',
  'Military background — precise and dependable',
  'Customer relations trained — handles complaints gracefully',
  'Long-haul specialist — manages fatigue and service cadence'
]

const FA_SPECIALTIES = [
  'International service, premium cabin management',
  'Galley operations and beverage service',
  'Passenger relations and conflict resolution',
  'Emergency procedures and first aid',
  'Special needs passenger assistance',
  'Children and unaccompanied minor care',
  'VIP and charter service',
  'Safety demonstration and compliance',
  'Crew coordination and communication',
  'Medical in-flight response',
  'Long-haul fatigue management',
  'Cultural and language diversity',
  'Food service and dietary accommodation',
  'Security screening awareness',
  'Boarding and deplaning efficiency',
  'Dangerous goods awareness',
  'Fire suppression and evacuation procedures',
  'CRM and crew communication',
  'Island route hospitality culture',
  'High-density cabin management'
]

const PILOT_CERTIFICATIONS = [
  'ATPL (Airline Transport Pilot License)',
  'CPL (Commercial Pilot License)',
  'Instrument Rating (IR) current',
  'Multi-engine rating (ME)',
  'Type rating — Boeing 737 family',
  'Type rating — Airbus A320 family',
  'Type rating — Bombardier CRJ series',
  'Type rating — ATR 72',
  'Type rating — Beech 1900 / King Air',
  'LOFT (Line-Oriented Flight Training) current',
  'CRM (Crew Resource Management) current',
  'Extended Operations (ETOPS/EROPS) qualified',
  'RVSM (Reduced Vertical Separation) qualified',
  'CAT III (Low Visibility Operations) current',
  'Oceanic procedures qualified',
  'MNPS (Minimum Navigation Performance Specifications)',
  'Mountain and high-altitude endorsement',
  'Night rating (NR)',
  'Upset Prevention and Recovery Training (UPRT)',
  'Dangerous goods awareness trained',
  'EFB (Electronic Flight Bag) qualified',
  'Check airman authorized',
  'Simulator instructor (SIM-I) qualified',
  'Line check airman',
  'ACAS/TCAS resolution advisory trained'
]

const FA_CERTIFICATIONS = [
  'CRM trained',
  'Safety demonstration current',
  'First aid / CPR certified',
  'Dangerous goods awareness (IATA)',
  'Emergency procedures qualified',
  'Defibrillator (AED) trained',
  'Special assistance (reduced mobility) trained',
  'Galley safety certified',
  'Security awareness training',
  'Fire and smoke procedures qualified',
  'Evacuation drill current',
  'Child seat installation certified',
  'Unaccompanied minor escort trained',
  'Crowd management certified',
  'In-flight medical response trained'
]

// ---- Utility ----------------------------------------------------------------

function pickOne(pool) {
  return pool[Math.floor(Math.random() * pool.length)]
}

function pickN(pool, n) {
  const shuffled = [...pool].sort(() => Math.random() - 0.5)
  return shuffled.slice(0, Math.min(n, pool.length))
}

function hoursToExperienceLevel(hours, role) {
  if (role === 'Flight Attendant') {
    if (hours < 500) return 'Junior Flight Attendant'
    if (hours < 2000) return 'Flight Attendant'
    if (hours < 5000) return 'Senior Flight Attendant'
    return 'Lead Cabin Crew'
  }
  if (hours < 100) return 'New Hire'
  if (hours < 500) return 'Junior First Officer'
  if (hours < 1500) return 'First Officer'
  if (hours < 3000) return 'Senior First Officer'
  if (hours < 5000) return 'Line Captain'
  if (hours < 8000) return 'Captain'
  if (hours < 12000) return 'Senior Captain'
  return 'Chief Pilot / Senior Check Captain'
}

function getSpecialtyPool(role) {
  if (role === 'Flight Attendant') return FA_SPECIALTIES
  if (role === 'First Officer') return FO_SPECIALTIES
  return CAPTAIN_SPECIALTIES
}

function getPersonalityPool(role) {
  if (role === 'First Officer') return FO_PERSONALITY_STYLES
  return CAPTAIN_PERSONALITY_STYLES
}

function getCertPool(role) {
  return role === 'Flight Attendant' ? FA_CERTIFICATIONS : PILOT_CERTIFICATIONS
}

function getCertCount(role) {
  return role === 'Flight Attendant' ? 2 : 3
}

function buildRandomFormData(role, hours) {
  const experLevel = hoursToExperienceLevel(hours, role)
  if (role === 'Flight Attendant') {
    return {
      serviceStyle: pickOne(FA_SERVICE_STYLES),
      specialty: pickOne(FA_SPECIALTIES),
      experienceLevel: experLevel,
      certifications: pickN(FA_CERTIFICATIONS, 2)
    }
  }
  const base = {
    specialty: pickOne(getSpecialtyPool(role)),
    experienceLevel: experLevel,
    personalityStyle: pickOne(getPersonalityPool(role)),
    communicationPreference: pickOne(COMMUNICATION_PREFERENCES),
    certifications: pickN(getCertPool(role), 3)
  }
  if (role === 'Captain') {
    base.procedureStyle = pickOne(CAPTAIN_PROCEDURE_STYLES)
    base.crewInteraction = pickOne(CAPTAIN_CREW_INTERACTIONS)
  }
  return base
}

function buildEmptyFormData(role, hours) {
  const experLevel = hoursToExperienceLevel(hours, role)
  if (role === 'Flight Attendant') {
    return { serviceStyle: '', specialty: '', experienceLevel: experLevel, certifications: [] }
  }
  const base = {
    specialty: '',
    experienceLevel: experLevel,
    personalityStyle: '',
    communicationPreference: '',
    certifications: []
  }
  if (role === 'Captain') {
    base.procedureStyle = ''
    base.crewInteraction = ''
  }
  return base
}

function formDataToProfile(formData, crewId, crewName, crewRole, hours, flights) {
  const now = new Date().toISOString()
  const base = {
    peopleId: crewId,
    name: crewName,
    role: crewRole,
    isUserProfile: crewId === 'my-pilot',
    oa: { hours, flights },
    customNotes: formData.customNotes || '',
    siApiKey: null,
    lastUpdated: now,
    createdAt: now
  }

  if (crewRole === 'Flight Attendant') {
    return {
      ...base,
      background: {
        flightHours: hours,
        experienceLevel: formData.experienceLevel,
        specialty: formData.specialty,
        certifications: formData.certifications || []
      },
      cabinManagementPreferences: {
        serviceStyle: formData.serviceStyle,
        passengerAnnouncements: 'Standard safety announcements with warm delivery'
      }
    }
  }

  const profile = {
    ...base,
    background: {
      flightHours: hours,
      experienceLevel: formData.experienceLevel,
      specialty: formData.specialty,
      certifications: formData.certifications || []
    },
    personality: {
      style: formData.personalityStyle,
      communicationPreference: formData.communicationPreference
    },
    operationalPreferences: {
      crewInteraction: formData.crewInteraction || ''
    }
  }

  if (crewRole === 'Captain') {
    profile.operationalPreferences.procedureStyle = formData.procedureStyle || ''
  }

  return profile
}

// ---- Sub-components ---------------------------------------------------------

function RoleBadge({ role }) {
  const colors = {
    Captain: { bg: '#fbbf24', text: '#0f1117' },
    'First Officer': { bg: '#60a5fa', text: '#0f1117' },
    'Flight Attendant': { bg: '#34d399', text: '#0f1117' }
  }
  const style = colors[role] || { bg: '#6b7280', text: '#fff' }
  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 10px',
      borderRadius: '12px',
      fontSize: '11px',
      fontWeight: 700,
      letterSpacing: '0.05em',
      backgroundColor: style.bg,
      color: style.text,
      textTransform: 'uppercase'
    }}>
      {role}
    </span>
  )
}

function FieldSelect({ label, value, options, onChange, onReroll, disabled }) {
  return (
    <div style={{ marginBottom: '12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
        <label style={{ fontSize: '11px', fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          {label}
        </label>
        {onReroll && (
          <button
            onClick={onReroll}
            disabled={disabled}
            title="Re-roll this field"
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: '#6b7280',
              fontSize: '14px',
              padding: '0 4px',
              lineHeight: 1
            }}
          >
            ⚄
          </button>
        )}
      </div>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        disabled={disabled}
        style={{
          width: '100%',
          padding: '7px 10px',
          backgroundColor: '#1e2330',
          color: '#e5e7eb',
          border: '1px solid #374151',
          borderRadius: '4px',
          fontSize: '13px',
          outline: 'none'
        }}
      >
        {value === '' && <option value="">— Select —</option>}
        {options.map(opt => (
          <option key={opt} value={opt}>{opt}</option>
        ))}
      </select>
    </div>
  )
}

function FieldInput({ label, value, onChange, placeholder }) {
  return (
    <div style={{ marginBottom: '12px' }}>
      <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>
        {label}
      </label>
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          width: '100%',
          padding: '7px 10px',
          backgroundColor: '#1e2330',
          color: '#e5e7eb',
          border: '1px solid #374151',
          borderRadius: '4px',
          fontSize: '13px',
          outline: 'none',
          boxSizing: 'border-box'
        }}
      />
    </div>
  )
}

function CertChips({ certifications, pool, onAdd, onRemove, onReroll, isRandomize }) {
  const [addMode, setAddMode] = useState(false)
  const unused = pool.filter(c => !certifications.includes(c))

  return (
    <div style={{ marginBottom: '12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
        <label style={{ fontSize: '11px', fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Certifications
        </label>
        <div style={{ display: 'flex', gap: '6px' }}>
          {isRandomize && onReroll && (
            <button onClick={onReroll} title="Re-roll certifications" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280', fontSize: '14px', padding: '0 4px' }}>
              ⚄
            </button>
          )}
          {!isRandomize && (
            <button
              onClick={() => setAddMode(v => !v)}
              style={{ background: 'none', border: '1px solid #374151', cursor: 'pointer', color: '#9ca3af', fontSize: '11px', padding: '2px 8px', borderRadius: '4px' }}
            >
              + Add
            </button>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: addMode ? '8px' : 0 }}>
        {certifications.map(cert => (
          <span key={cert} style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '4px',
            padding: '3px 8px',
            backgroundColor: '#1e3a5f',
            color: '#93c5fd',
            borderRadius: '12px',
            fontSize: '11px'
          }}>
            {cert}
            <button
              onClick={() => onRemove(cert)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#60a5fa', fontSize: '12px', padding: 0, lineHeight: 1 }}
            >
              ×
            </button>
          </span>
        ))}
        {certifications.length === 0 && (
          <span style={{ color: '#4b5563', fontSize: '12px', fontStyle: 'italic' }}>None selected</span>
        )}
      </div>

      {addMode && unused.length > 0 && (
        <select
          defaultValue=""
          onChange={e => { if (e.target.value) { onAdd(e.target.value); e.target.value = '' } }}
          style={{
            width: '100%',
            padding: '7px 10px',
            backgroundColor: '#1e2330',
            color: '#e5e7eb',
            border: '1px solid #374151',
            borderRadius: '4px',
            fontSize: '12px'
          }}
        >
          <option value="">— Select certification to add —</option>
          {unused.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      )}
    </div>
  )
}

// ---- Main Component ---------------------------------------------------------

/**
 * CrewProfileEditorV2
 * Props:
 *   crewId       - Crew ID (UUID or 'my-pilot'); null = hidden
 *   crewName     - Display name
 *   crewRole     - 'Captain' | 'First Officer' | 'Flight Attendant'
 *   crewHours    - OA flight hours (number)
 *   crewFlights  - OA total flights/landings (number)
 *   profile      - Existing profile object (or null if new)
 *   onSave       - (crewId, profileData) => void
 *   onSkip       - (crewId) => void
 */
export default function CrewProfileEditorV2({
  crewId,
  crewName,
  crewRole,
  crewHours = 0,
  crewFlights = 0,
  profile,
  onSave,
  onSkip
}) {
  const [mode, setMode] = useState('randomize')
  const [formData, setFormData] = useState(null)

  // Initialize form when crewId changes
  useEffect(() => {
    if (!crewId) return

    if (profile && profile.background) {
      // Load from existing profile
      const isFA = crewRole === 'Flight Attendant'
      const existing = isFA
        ? {
            serviceStyle: profile.cabinManagementPreferences?.serviceStyle || '',
            specialty: profile.background?.specialty || '',
            experienceLevel: profile.background?.experienceLevel || hoursToExperienceLevel(crewHours, crewRole),
            certifications: profile.background?.certifications || [],
            customNotes: profile.customNotes || ''
          }
        : {
            specialty: profile.background?.specialty || '',
            experienceLevel: profile.background?.experienceLevel || hoursToExperienceLevel(crewHours, crewRole),
            personalityStyle: profile.personality?.style || '',
            communicationPreference: profile.personality?.communicationPreference || '',
            procedureStyle: profile.operationalPreferences?.procedureStyle || '',
            crewInteraction: profile.operationalPreferences?.crewInteraction || '',
            certifications: profile.background?.certifications || [],
            customNotes: profile.customNotes || ''
          }
      setFormData(existing)
      setMode('randomize')
    } else {
      // New profile — auto-randomize
      const randomized = buildRandomFormData(crewRole, crewHours)
      randomized.customNotes = ''
      setFormData(randomized)
      setMode('randomize')
    }
  }, [crewId, crewRole, crewHours])

  const handleRerollAll = useCallback(() => {
    const randomized = buildRandomFormData(crewRole, crewHours)
    randomized.customNotes = formData?.customNotes || ''
    setFormData(randomized)
  }, [crewRole, crewHours, formData])

  const handleRerollField = useCallback((fieldName, pool) => {
    setFormData(prev => ({ ...prev, [fieldName]: pickOne(pool) }))
  }, [])

  const handleRerollCerts = useCallback(() => {
    const pool = getCertPool(crewRole)
    const count = getCertCount(crewRole)
    setFormData(prev => ({ ...prev, certifications: pickN(pool, count) }))
  }, [crewRole])

  const handleSwitchToManual = () => {
    if (mode === 'manual') return
    // Keep current values but switch to manual editing
    setMode('manual')
    if (!formData || !formData.specialty) {
      setFormData(buildEmptyFormData(crewRole, crewHours))
    }
  }

  const handleSwitchToRandomize = () => {
    if (mode === 'randomize') return
    setMode('randomize')
    if (!formData || !formData.specialty) {
      const randomized = buildRandomFormData(crewRole, crewHours)
      randomized.customNotes = formData?.customNotes || ''
      setFormData(randomized)
    }
  }

  const handleSave = () => {
    if (!formData) return
    const profileData = formDataToProfile(formData, crewId, crewName, crewRole, crewHours, crewFlights)
    onSave(crewId, profileData)
  }

  const handleSkip = () => {
    if (onSkip) onSkip(crewId)
  }

  // Hidden when no crewId
  if (!crewId || !formData) return null

  const isFA = crewRole === 'Flight Attendant'
  const isRandomize = mode === 'randomize'
  const specialtyPool = getSpecialtyPool(crewRole)
  const personalityPool = getPersonalityPool(crewRole)
  const certPool = getCertPool(crewRole)
  const isCaptain = crewRole === 'Captain'
  const isUserProfile = crewId === 'my-pilot'

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.85)',
      zIndex: 9999,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '16px'
    }}>
      <div style={{
        backgroundColor: '#0f1117',
        border: '1px solid #374151',
        borderRadius: '8px',
        width: '100%',
        maxWidth: '560px',
        maxHeight: '90vh',
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column'
      }}>
        {/* Header */}
        <div style={{
          padding: '16px 20px',
          borderBottom: '1px solid #1f2937',
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: '12px'
        }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' }}>
              <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#f9fafb' }}>
                {isUserProfile ? 'My Pilot Profile' : crewName || '—'}
              </h2>
              <RoleBadge role={crewRole} />
            </div>
            <div style={{ fontSize: '12px', color: '#6b7280' }}>
              {crewHours.toLocaleString()} hrs &nbsp;·&nbsp; {crewFlights.toLocaleString()} flights
              &nbsp;·&nbsp; <span style={{ color: '#9ca3af' }}>{hoursToExperienceLevel(crewHours, crewRole)}</span>
            </div>
          </div>

          {/* Mode Toggle */}
          <div style={{
            display: 'flex',
            border: '1px solid #374151',
            borderRadius: '6px',
            overflow: 'hidden',
            flexShrink: 0
          }}>
            <button
              onClick={handleSwitchToRandomize}
              style={{
                padding: '6px 12px',
                fontSize: '12px',
                fontWeight: 600,
                border: 'none',
                cursor: 'pointer',
                backgroundColor: isRandomize ? '#1e3a5f' : 'transparent',
                color: isRandomize ? '#60a5fa' : '#6b7280',
                transition: 'all 0.15s'
              }}
            >
              ⚄ Randomize
            </button>
            <button
              onClick={handleSwitchToManual}
              style={{
                padding: '6px 12px',
                fontSize: '12px',
                fontWeight: 600,
                border: 'none',
                borderLeft: '1px solid #374151',
                cursor: 'pointer',
                backgroundColor: !isRandomize ? '#1e3a5f' : 'transparent',
                color: !isRandomize ? '#60a5fa' : '#6b7280',
                transition: 'all 0.15s'
              }}
            >
              ✏ Manual
            </button>
          </div>
        </div>

        {/* Body */}
        <div style={{ padding: '16px 20px', flex: 1 }}>
          {isRandomize && (
            <button
              onClick={handleRerollAll}
              style={{
                width: '100%',
                padding: '8px',
                marginBottom: '16px',
                backgroundColor: '#1e2330',
                border: '1px solid #4b5563',
                borderRadius: '6px',
                color: '#9ca3af',
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer',
                letterSpacing: '0.05em'
              }}
            >
              ⚄ Re-roll All Fields
            </button>
          )}

          {/* FA fields */}
          {isFA ? (
            <>
              {isRandomize ? (
                <FieldSelect
                  label="Service Style"
                  value={formData.serviceStyle}
                  options={FA_SERVICE_STYLES}
                  onChange={v => setFormData(p => ({ ...p, serviceStyle: v }))}
                  onReroll={() => handleRerollField('serviceStyle', FA_SERVICE_STYLES)}
                />
              ) : (
                <FieldInput
                  label="Service Style"
                  value={formData.serviceStyle}
                  onChange={v => setFormData(p => ({ ...p, serviceStyle: v }))}
                  placeholder="e.g. Warm and welcoming — hospitality-first"
                />
              )}

              {isRandomize ? (
                <FieldSelect
                  label="Specialty"
                  value={formData.specialty}
                  options={FA_SPECIALTIES}
                  onChange={v => setFormData(p => ({ ...p, specialty: v }))}
                  onReroll={() => handleRerollField('specialty', FA_SPECIALTIES)}
                />
              ) : (
                <FieldInput
                  label="Specialty"
                  value={formData.specialty}
                  onChange={v => setFormData(p => ({ ...p, specialty: v }))}
                  placeholder="e.g. Emergency procedures and first aid"
                />
              )}
            </>
          ) : (
            <>
              {/* Pilot fields (Captain / FO) */}
              {isRandomize ? (
                <FieldSelect
                  label="Background Specialty"
                  value={formData.specialty}
                  options={specialtyPool}
                  onChange={v => setFormData(p => ({ ...p, specialty: v }))}
                  onReroll={() => handleRerollField('specialty', specialtyPool)}
                />
              ) : (
                <FieldInput
                  label="Background Specialty"
                  value={formData.specialty}
                  onChange={v => setFormData(p => ({ ...p, specialty: v }))}
                  placeholder="e.g. Long-haul international operations"
                />
              )}

              {isRandomize ? (
                <FieldSelect
                  label="Personality Style"
                  value={formData.personalityStyle}
                  options={personalityPool}
                  onChange={v => setFormData(p => ({ ...p, personalityStyle: v }))}
                  onReroll={() => handleRerollField('personalityStyle', personalityPool)}
                />
              ) : (
                <FieldInput
                  label="Personality Style"
                  value={formData.personalityStyle}
                  onChange={v => setFormData(p => ({ ...p, personalityStyle: v }))}
                  placeholder="e.g. Warm but authoritative"
                />
              )}

              {isRandomize ? (
                <FieldSelect
                  label="Communication Preference"
                  value={formData.communicationPreference}
                  options={COMMUNICATION_PREFERENCES}
                  onChange={v => setFormData(p => ({ ...p, communicationPreference: v }))}
                  onReroll={() => handleRerollField('communicationPreference', COMMUNICATION_PREFERENCES)}
                />
              ) : (
                <FieldInput
                  label="Communication Preference"
                  value={formData.communicationPreference}
                  onChange={v => setFormData(p => ({ ...p, communicationPreference: v }))}
                  placeholder="e.g. Formal standard phraseology"
                />
              )}

              {isCaptain && (
                <>
                  {isRandomize ? (
                    <FieldSelect
                      label="Procedure Style"
                      value={formData.procedureStyle}
                      options={CAPTAIN_PROCEDURE_STYLES}
                      onChange={v => setFormData(p => ({ ...p, procedureStyle: v }))}
                      onReroll={() => handleRerollField('procedureStyle', CAPTAIN_PROCEDURE_STYLES)}
                    />
                  ) : (
                    <FieldInput
                      label="Procedure Style"
                      value={formData.procedureStyle}
                      onChange={v => setFormData(p => ({ ...p, procedureStyle: v }))}
                      placeholder="e.g. By the book — strict SOP adherence"
                    />
                  )}

                  {isRandomize ? (
                    <FieldSelect
                      label="Crew Interaction"
                      value={formData.crewInteraction}
                      options={CAPTAIN_CREW_INTERACTIONS}
                      onChange={v => setFormData(p => ({ ...p, crewInteraction: v }))}
                      onReroll={() => handleRerollField('crewInteraction', CAPTAIN_CREW_INTERACTIONS)}
                    />
                  ) : (
                    <FieldInput
                      label="Crew Interaction"
                      value={formData.crewInteraction}
                      onChange={v => setFormData(p => ({ ...p, crewInteraction: v }))}
                      placeholder="e.g. Empowers FO with full authority on normal operations"
                    />
                  )}
                </>
              )}
            </>
          )}

          {/* Experience Level (derived, read-only) */}
          <div style={{ marginBottom: '12px' }}>
            <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>
              Experience Level
            </label>
            <div style={{
              padding: '7px 10px',
              backgroundColor: '#151820',
              border: '1px solid #1f2937',
              borderRadius: '4px',
              color: '#d1d5db',
              fontSize: '13px'
            }}>
              {formData.experienceLevel || hoursToExperienceLevel(crewHours, crewRole)}
            </div>
          </div>

          {/* Certifications */}
          <CertChips
            certifications={formData.certifications || []}
            pool={certPool}
            onAdd={cert => setFormData(p => ({ ...p, certifications: [...(p.certifications || []), cert] }))}
            onRemove={cert => setFormData(p => ({ ...p, certifications: (p.certifications || []).filter(c => c !== cert) }))}
            onReroll={handleRerollCerts}
            isRandomize={isRandomize}
          />

          {/* Custom notes */}
          <div style={{ marginBottom: '12px' }}>
            <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>
              Custom Notes
            </label>
            <textarea
              value={formData.customNotes || ''}
              onChange={e => setFormData(p => ({ ...p, customNotes: e.target.value }))}
              placeholder="Optional — any additional context for SI..."
              rows={2}
              style={{
                width: '100%',
                padding: '7px 10px',
                backgroundColor: '#1e2330',
                color: '#e5e7eb',
                border: '1px solid #374151',
                borderRadius: '4px',
                fontSize: '12px',
                resize: 'vertical',
                outline: 'none',
                boxSizing: 'border-box'
              }}
            />
          </div>
        </div>

        {/* Footer */}
        <div style={{
          padding: '14px 20px',
          borderTop: '1px solid #1f2937',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '10px'
        }}>
          <button
            onClick={handleSkip}
            style={{
              padding: '8px 16px',
              backgroundColor: 'transparent',
              border: '1px solid #374151',
              borderRadius: '5px',
              color: '#6b7280',
              fontSize: '13px',
              cursor: 'pointer',
              fontWeight: 500
            }}
          >
            Skip
          </button>
          <button
            onClick={handleSave}
            disabled={!formData}
            style={{
              padding: '8px 24px',
              backgroundColor: '#1d4ed8',
              border: 'none',
              borderRadius: '5px',
              color: '#fff',
              fontSize: '13px',
              fontWeight: 700,
              cursor: 'pointer',
              letterSpacing: '0.025em'
            }}
          >
            Save Profile
          </button>
        </div>
      </div>
    </div>
  )
}

