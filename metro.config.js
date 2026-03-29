const { getDefaultConfig } = require('expo/metro-config');
const { withUniwindConfig } = require('uniwind/metro'); 

const config = getDefaultConfig(__dirname);

// your metro modifications
config.resolver.unstable_enablePackageExports = true;

module.exports = withUniwindConfig(config, {  
  // relative path to your global.css file (from previous step)
  cssEntryFile: './globals.css',
  // (optional) path where we gonna auto-generate typings
  // defaults to project's root
  dtsFile: './app/uniwind-types.d.ts'
});
