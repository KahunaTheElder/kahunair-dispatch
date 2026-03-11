const FlightSessionManager = require('../FlightSessionManager');

describe('FlightSessionManager', () => {
  const testFlightData = {
    id: 'flight-123',
    departureAirport: { code: 'EBLG' },
    arrivalAirport: { code: 'LIPZ' },
    aircraft: { name: 'BAe 146-300' },
    flightNumber: '728D'
  };

  const testVAProfile = {
    vaId: 'va-123',
    name: 'KahunaAir',
    callsign: 'KHA'
  };

  const testCrewProfiles = [
    {
      peopleId: 'crew-1',
      name: 'Captain Kahuna',
      role: 'Captain'
    },
    {
      peopleId: 'crew-2',
      name: 'First Officer',
      role: 'First Officer'
    }
  ];

  afterEach(() => {
    // Clear session after each test
    FlightSessionManager.clearSession();
  });

  test('initializeSession creates active session', () => {
    const session = FlightSessionManager.initializeSession(testFlightData, testVAProfile, testCrewProfiles);

    expect(session).toBeDefined();
    expect(session.active).toBe(true);
    expect(session.departure).toBe('EBLG');
    expect(session.arrival).toBe('LIPZ');
    expect(session.crewProfiles.length).toBe(2);
  });

  test('getSessionData returns active session', () => {
    FlightSessionManager.initializeSession(testFlightData, testVAProfile, testCrewProfiles);

    const session = FlightSessionManager.getSessionData();
    expect(session).toBeDefined();
    expect(session.active).toBe(true);
  });

  test('getSessionData returns null when no session', () => {
    const session = FlightSessionManager.getSessionData();
    expect(session).toBeNull();
  });

  test('isActive returns true for active session', () => {
    FlightSessionManager.initializeSession(testFlightData, testVAProfile, testCrewProfiles);

    expect(FlightSessionManager.isActive()).toBe(true);
  });

  test('isActive returns false when no session', () => {
    expect(FlightSessionManager.isActive()).toBe(false);
  });

  test('addCrewToSession adds new crew', () => {
    FlightSessionManager.initializeSession(testFlightData, testVAProfile, testCrewProfiles);

    const newCrew = { peopleId: 'crew-3', name: 'New Crew', role: 'Flight Attendant' };
    const result = FlightSessionManager.addCrewToSession('crew-3', newCrew);

    expect(result).toBe(true);

    const session = FlightSessionManager.getSessionData();
    expect(session.crewProfiles.length).toBe(3);
    expect(session.crewProfiles[2].peopleId).toBe('crew-3');
  });

  test('addCrewToSession updates existing crew', () => {
    FlightSessionManager.initializeSession(testFlightData, testVAProfile, testCrewProfiles);

    const updated = { ...testCrewProfiles[0], name: 'Updated Name' };
    FlightSessionManager.addCrewToSession('crew-1', updated);

    const session = FlightSessionManager.getSessionData();
    const crew = session.crewProfiles.find(c => c.peopleId === 'crew-1');
    expect(crew.name).toBe('Updated Name');
  });

  test('updateVAProfile updates VA in session', () => {
    FlightSessionManager.initializeSession(testFlightData, testVAProfile, testCrewProfiles);

    const updatedVA = { ...testVAProfile, name: 'Updated VA' };
    FlightSessionManager.updateVAProfile(updatedVA);

    const session = FlightSessionManager.getSessionData();
    expect(session.vaProfile.name).toBe('Updated VA');
  });

  test('getCrewProfile returns crew by peopleId', () => {
    FlightSessionManager.initializeSession(testFlightData, testVAProfile, testCrewProfiles);

    const crew = FlightSessionManager.getCrewProfile('crew-1');
    expect(crew).toBeDefined();
    expect(crew.name).toBe('Captain Kahuna');
  });

  test('getCrewProfile returns null for non-existent crew', () => {
    FlightSessionManager.initializeSession(testFlightData, testVAProfile, testCrewProfiles);

    const crew = FlightSessionManager.getCrewProfile('crew-999');
    expect(crew).toBeNull();
  });

  test('getAllCrew returns all crew profiles', () => {
    FlightSessionManager.initializeSession(testFlightData, testVAProfile, testCrewProfiles);

    const crew = FlightSessionManager.getAllCrew();
    expect(crew.length).toBe(2);
    expect(crew[0].peopleId).toBe('crew-1');
  });

  test('getSessionSummary returns summary', () => {
    FlightSessionManager.initializeSession(testFlightData, testVAProfile, testCrewProfiles);

    const summary = FlightSessionManager.getSessionSummary();
    expect(summary).toBeDefined();
    expect(summary.flight).toBe('EBLG -> LIPZ');
    expect(summary.crew).toBe(2);
    expect(summary.va).toBe('KahunaAir');
  });

  test('clearSession deactivates session', () => {
    FlightSessionManager.initializeSession(testFlightData, testVAProfile, testCrewProfiles);

    expect(FlightSessionManager.isActive()).toBe(true);

    const result = FlightSessionManager.clearSession();

    expect(result).toBe(true);
    expect(FlightSessionManager.isActive()).toBe(false);
    expect(FlightSessionManager.getSessionData()).toBeNull();
  });

  test('exportForDispatch returns callable format', () => {
    FlightSessionManager.initializeSession(testFlightData, testVAProfile, testCrewProfiles);

    const data = FlightSessionManager.exportForDispatch();

    expect(data).toBeDefined();
    expect(data.va).toBeDefined();
    expect(data.flight).toBeDefined();
    expect(data.crew).toBeDefined();
    expect(data.flight.departure).toBe('EBLG');
    expect(data.crew.length).toBe(2);
  });

  test('exportForDispatch throws when no session', () => {
    expect(() => {
      FlightSessionManager.exportForDispatch();
    }).toThrow();
  });
});
