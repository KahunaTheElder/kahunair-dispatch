const CrewProfileService = require('../CrewProfileService');
const fs = require('fs');
const path = require('path');

describe('CrewProfileService', () => {
  const testCrewId = 'crew-12345';
  const testCrewData = {
    name: 'Kahuna Captain',
    role: 'Captain',
    roleNumber: 0,
    flightHours: 5000
  };

  beforeEach(() => {
    // Clean up test files before each test
    const testFile = path.join(__dirname, '../data/crew-profiles', `${testCrewId}.json`);
    if (fs.existsSync(testFile)) {
      fs.unlinkSync(testFile);
    }
  });

  test('mapRoleFromOnAir maps 0 to Captain', () => {
    const role = CrewProfileService.mapRoleFromOnAir(0);
    expect(role).toBe('Captain');
  });

  test('mapRoleFromOnAir maps 1 to First Officer', () => {
    const role = CrewProfileService.mapRoleFromOnAir(1);
    expect(role).toBe('First Officer');
  });

  test('mapRoleFromOnAir maps 2+ to Flight Attendant', () => {
    const role = CrewProfileService.mapRoleFromOnAir(2);
    expect(role).toBe('Flight Attendant');
  });

  test('getTemplateFilename returns correct template for Captain', () => {
    const filename = CrewProfileService.getTemplateFilename('Captain');
    expect(filename).toBe('crew-template-captain.json');
  });

  test('getTemplateFilename returns correct template for First Officer', () => {
    const filename = CrewProfileService.getTemplateFilename('First Officer');
    expect(filename).toBe('crew-template-fo.json');
  });

  test('getTemplateFilename returns correct template for Flight Attendant', () => {
    const filename = CrewProfileService.getTemplateFilename('Flight Attendant');
    expect(filename).toBe('crew-template-fa.json');
  });

  test('loadByPeopleId returns null for non-existent crew', () => {
    const profile = CrewProfileService.loadByPeopleId(testCrewId);
    expect(profile).toBeNull();
  });

  test('create creates crew profile from template', () => {
    const profile = CrewProfileService.create(testCrewId, testCrewData);

    expect(profile).toBeDefined();
    expect(profile.peopleId).toBe(testCrewId);
    expect(profile.name).toBe(testCrewData.name);
    expect(profile.role).toBe('Captain');
  });

  test('create saves to disk', () => {
    CrewProfileService.create(testCrewId, testCrewData);

    const loaded = CrewProfileService.loadByPeopleId(testCrewId);
    expect(loaded).toBeDefined();
    expect(loaded.peopleId).toBe(testCrewId);
  });

  test('getOrCreateProfile returns existing profile', () => {
    CrewProfileService.create(testCrewId, testCrewData);

    const profile = CrewProfileService.getOrCreateProfile(testCrewId, {});
    expect(profile.peopleId).toBe(testCrewId);
  });

  test('getOrCreateProfile creates profile if missing', () => {
    const profile = CrewProfileService.getOrCreateProfile(testCrewId, testCrewData);

    expect(profile).toBeDefined();
    expect(profile.name).toBe(testCrewData.name);
  });

  test('validateAllExist checks all crew profiles', () => {
    // Create one profile
    CrewProfileService.create(testCrewId, testCrewData);

    const crewArray = [
      { peopleId: testCrewId, name: 'Kahuna Captain', role: 'Captain' },
      { peopleId: 'crew-missing', name: 'Missing Crew', role: 'First Officer' }
    ];

    const result = CrewProfileService.validateAllExist(crewArray);

    expect(result.valid).toBe(false);
    expect(result.existing.length).toBe(1);
    expect(result.missing.length).toBe(1);
    expect(result.missing[0].peopleId).toBe('crew-missing');
  });

  test('updateRoleIfChanged updates role when different', () => {
    CrewProfileService.create(testCrewId, testCrewData);

    // Change role from Captain (0) to First Officer (1)
    const updated = CrewProfileService.updateRoleIfChanged(testCrewId, 1);

    expect(updated).toBe(true);

    const profile = CrewProfileService.loadByPeopleId(testCrewId);
    expect(profile.role).toBe('First Officer');
  });

  test('updateRoleIfChanged returns false when role unchanged', () => {
    CrewProfileService.create(testCrewId, testCrewData);

    // Same role (Captain = 0)
    const updated = CrewProfileService.updateRoleIfChanged(testCrewId, 0);

    expect(updated).toBe(false);
  });

  test('save updates existing profile', () => {
    CrewProfileService.create(testCrewId, testCrewData);

    const profile = CrewProfileService.loadByPeopleId(testCrewId);
    profile.customNotes = 'Updated notes';
    CrewProfileService.save(testCrewId, profile);

    const updated = CrewProfileService.loadByPeopleId(testCrewId);
    expect(updated.customNotes).toBe('Updated notes');
  });

  afterEach(() => {
    const testFile = path.join(__dirname, '../data/crew-profiles', `${testCrewId}.json`);
    if (fs.existsSync(testFile)) {
      fs.unlinkSync(testFile);
    }
  });
});
