const { mkdirSync } = require('node:fs');
const { join } = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');
const { withUniwindConfig } = require('uniwind/metro');

// Uniwind writes declarations but does not create the output directory.
mkdirSync(join(__dirname, '.expo/types'), { recursive: true });

const config = getDefaultConfig(__dirname);
// Drizzle's generated migrations import `.sql` files, which Babel inlines as strings.
config.resolver.sourceExts.push('sql');

module.exports = withUniwindConfig(config, {
  cssEntryFile: './global.css',
  dtsFile: './uniwind-types.d.ts',
});
