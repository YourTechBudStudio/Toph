const { mkdirSync } = require('node:fs');
const { join } = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');
const { withUniwindConfig } = require('uniwind/metro');

// Uniwind writes declarations but does not create the output directory.
mkdirSync(join(__dirname, '.expo/types'), { recursive: true });

module.exports = withUniwindConfig(getDefaultConfig(__dirname), {
  cssEntryFile: './global.css',
  dtsFile: './uniwind-types.d.ts',
});
