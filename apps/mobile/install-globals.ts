import { randomUUID } from 'expo-crypto';

// The shared core mints ids with the web global `crypto.randomUUID`, which neither React Native
// nor Expo provides (packages/dictation-core/src/ids.ts). The keyboard's headless task (story #8)
// starts from this same entry, so it gets the global too.
const host = globalThis as { crypto?: { randomUUID?: () => string } };
host.crypto ??= {};
host.crypto.randomUUID ??= randomUUID;
