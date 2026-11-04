import { vi } from 'vitest';

// The agent reads macOS screen-recording and accessibility permissions through Electron's
// systemPreferences, which only exists on a Mac and is not in the tests' electron mocks. Answer as
// on Windows and Linux (nothing to check), so the agent tests behave the same on every runner.
// The permission rules themselves are tested in permissions.test.ts.
vi.mock('../src/main/services/permissions', () => ({ macPermissions: () => null }));
