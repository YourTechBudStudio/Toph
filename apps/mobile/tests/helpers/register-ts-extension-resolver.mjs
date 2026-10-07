import { registerHooks } from 'node:module';

/**
 * Mirrors the core's `packages/dictation-core/test/helpers/register-ts-extension-resolver.ts`.
 *
 * Lets the node test runner load the shared core's source, which imports its siblings without a
 * file extension, as the engine tests do through the engine files. The `test` script preloads this
 * file with `--import`, so the hook is in place before any suite statically imports a module.
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
