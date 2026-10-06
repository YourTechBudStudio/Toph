import { registerHooks } from 'node:module';

/**
 * Mirrors desktop's `apps/desktop/test/helpers/ts-extension-resolver.ts`.
 *
 * Lets the node test runner load core modules that import their siblings without a file extension,
 * which is how the source tree is written for the bundler. The `test` script preloads this file
 * with `--import`, so the hook is in place before any suite statically imports a module under test.
 */
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
