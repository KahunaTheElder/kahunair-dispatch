const Validator = require('../DispatchValidator');

describe('DispatchValidator', () => {
  const validVAProfile = {
    vaId: 'va-123',
    name: 'KahunaAir',
    operationalPolicy: {
      crewProfessionalism: 'professional',
      communicationStyle: 'formal'
    },
    dispatcherPersonality: {
      style: 'professional'
    },
    profile: {
      culture: 'Professional'
    }
  };

  const validCrewProfile = {
    peopleId: 'crew-1',
    name: 'Captain Test',
    role: 'Captain',
    background: {
      flightHours: 5000,
      experienceLevel: 'Senior'
    },
    personality: {
      style: 'professional',
      communicationPreference: 'formal'
    }
  };

  const validSessionData = {
    vaProfile: validVAProfile,
    crewProfiles: [validCrewProfile]
  };

  test('validateCrewRole validates role format', () => {
    const crew = { name: 'Test', role: 'Captain' };
    const result = Validator.validateCrewRole(crew);

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  test('validateCrewRole rejects invalid role', () => {
    const crew = { name: 'Test', role: 'InvalidRole' };
    const result = Validator.validateCrewRole(crew);

    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  test('validateCrewRole rejects missing role', () => {
    const crew = { name: 'Test' };
    const result = Validator.validateCrewRole(crew);

    expect(result.valid).toBe(false);
  });

  test('validateCrewProfile validates complete profile', () => {
    const result = Validator.validateCrewProfile(validCrewProfile);

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  test('validateCrewProfile detects missing required fields', () => {
    const crew = { name: 'Test' };
    const result = Validator.validateCrewProfile(crew);

    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  test('validateVAProfile validates complete profile', () => {
    const result = Validator.validateVAProfile(validVAProfile);

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  test('validateVAProfile detects missing fields', () => {
    const va = { name: 'Test' };
    const result = Validator.validateVAProfile(va);

    expect(result.valid).toBe(false);
  });

  test('validatePayload validates correct structure', () => {
    const payload = {
      crew_data: 'Valid crew context',
      dispatcher_data: 'Valid dispatcher context',
      copilot_data: 'Valid copilot context'
    };

    const result = Validator.validatePayload(payload);

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  test('validatePayload rejects missing crew_data', () => {
    const payload = {
      dispatcher_data: 'Valid'
    };

    const result = Validator.validatePayload(payload);

    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('crew_data'))).toBe(true);
  });

  test('validatePayload rejects empty strings', () => {
    const payload = {
      crew_data: '',
      dispatcher_data: 'Valid'
    };

    const result = Validator.validatePayload(payload);

    expect(result.valid).toBe(false);
  });

  test('validateReadiness validates complete session', () => {
    const result = Validator.validateReadiness(validSessionData);

    expect(result.ready).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.details).toBeDefined();
  });

  test('validateReadiness detects null session', () => {
    const result = Validator.validateReadiness(null);

    expect(result.ready).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  test('validateReadiness checks crew profiles', () => {
    const session = {
      vaProfile: validVAProfile,
      crewProfiles: [
        validCrewProfile,
        { ...validCrewProfile, peopleId: 'crew-2', role: 'InvalidRole' }
      ]
    };

    const result = Validator.validateReadiness(session);

    expect(result.ready).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  test('validateCrewProfilesExist checks all crew exist', () => {
    const crew = [
      { peopleId: 'crew-1', name: 'Test1', role: 'Captain' },
      { peopleId: 'crew-2', name: 'Test2', role: 'First Officer' }
    ];

    const checkExists = (id) => id === 'crew-1'; // Only crew-1 exists

    const result = Validator.validateCrewProfilesExist(crew, checkExists);

    expect(result.allExist).toBe(false);
    expect(result.missing.length).toBe(1);
    expect(result.count.missing).toBe(1);
  });

  test('getSummary returns ready message', () => {
    const validation = { ready: true, errors: [], warnings: [], details: { crew: [1, 2] } };
    const summary = Validator.getSummary(validation);

    expect(summary).toContain('✅');
    expect(summary).toContain('Ready');
  });

  test('getSummary returns not ready message', () => {
    const validation = {
      ready: false,
      errors: ['Error 1', 'Error 2'],
      warnings: ['Warning 1']
    };
    const summary = Validator.getSummary(validation);

    expect(summary).toContain('❌');
    expect(summary).toContain('2 error(s)');
    expect(summary).toContain('1 warning(s)');
  });
});
