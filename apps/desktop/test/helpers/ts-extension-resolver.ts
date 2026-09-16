import { registerHooks } from 'node:module';

/**
 * Let the node test runner load main-process modules that import their siblings without a file
 * extension, which is how the source tree is written for the bundler.
 *
 * Call this before dynamically importing the module under test; a static import would be evaluated
 * before the hook is registered.
 */
export function registerTsExtensionResolver() {
  registerHooks({
    resolve(specifier, context, nextResolve) {
      try {
        return nextResolve(specifier, context);
      } catch (error) {
        if (specifier.startsWith('.') && !specifier.match(/\.[cm]?[jt]sx?$/)) {
          return nextResolve(`${specifier}.ts`, context);
        }
        throw error;
      }
    },
  });
}
