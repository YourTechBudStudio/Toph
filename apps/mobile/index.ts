// install-globals must run before anything imports the shared core.
import './install-globals';
import 'expo-router/entry';
import { registerKeyboardDictation } from './src/modules/keyboard';

// The voice keyboard can start JS without opening the app, so its task is registered at bundle load.
registerKeyboardDictation();
