const VAProfileService = require('../VAProfileService');
const fs = require('fs');
const path = require('path');

describe('VAProfileService', () => {
  const testVAId = 'b5756657-1ef9-40c5-8d1f-bfd3a0e33f19';
  const testVAData = {
    name: 'Test VA',
    callsign: 'TST',
    airlineCode: 'TS',
    description: 'Test virtual airline'
  };

  beforeEach(() => {
    // Clean up test files before each test
    const testFile = path.join(__dirname, '../data/va-profiles/kahuna-air.json');
    if (fs.existsSync(testFile)) {
      fs.unlinkSync(testFile);
    }
  });

  test('profileExists returns false for non-existent profile', () => {
    const exists = VAProfileService.profileExists(testVAId);
    expect(exists).toBe(false);
  });

  test('createDefaultProfile creates profile from template', () => {
    const profile = VAProfileService.createDefaultProfile(testVAId, testVAData);

    expect(profile).toBeDefined();
    expect(profile.vaId).toBe(testVAId);
    expect(profile.name).toBe(testVAData.name);
    expect(profile.callsign).toBe(testVAData.callsign);
    expect(profile.profile).toBeDefined();
    expect(profile.operationalPolicy).toBeDefined();
  });

  test('createDefaultProfile saves to disk', () => {
    VAProfileService.createDefaultProfile(testVAId, testVAData);

    const exists = VAProfileService.profileExists(testVAId);
    expect(exists).toBe(true);
  });

  test('loadProfile returns null for non-existent profile', () => {
    const profile = VAProfileService.loadProfile(testVAId);
    expect(profile).toBeNull();
  });

  test('loadProfile retrieves saved profile', () => {
    // Create
    const created = VAProfileService.createDefaultProfile(testVAId, testVAData);

    // Load
    const loaded = VAProfileService.loadProfile(testVAId);

    expect(loaded).toBeDefined();
    expect(loaded.vaId).toBe(created.vaId);
    expect(loaded.name).toBe(created.name);
  });

  test('saveProfile updates existing profile', () => {
    // Create initial
    VAProfileService.createDefaultProfile(testVAId, testVAData);

    // Load and modify
    const profile = VAProfileService.loadProfile(testVAId);
    profile.customNotes = 'Modified notes';
    VAProfileService.saveProfile(testVAId, profile);

    // Verify modification
    const updated = VAProfileService.loadProfile(testVAId);
    expect(updated.customNotes).toBe('Modified notes');
  });

  test('getOrCreateProfile returns existing profile', () => {
    VAProfileService.createDefaultProfile(testVAId, testVAData);

    const profile = VAProfileService.getOrCreateProfile(testVAId, {});
    expect(profile.vaId).toBe(testVAId);
  });

  test('getOrCreateProfile creates profile if missing', () => {
    const profile = VAProfileService.getOrCreateProfile(testVAId, testVAData);

    expect(profile).toBeDefined();
    expect(profile.name).toBe(testVAData.name);
  });

  afterEach(() => {
    const testFile = path.join(__dirname, '../data/va-profiles/kahuna-air.json');
    if (fs.existsSync(testFile)) {
      fs.unlinkSync(testFile);
    }
  });
});
