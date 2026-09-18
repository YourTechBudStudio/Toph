import {
  PROVIDER_IDS,
  PROVIDER_SETTINGS_GROUPS,
  type ProviderId,
  type ProviderRole,
} from '@toph/desktop-contracts';

import type { ProviderDefinition } from './provider-definition';

export interface ProviderRegistry {
  get: (id: string) => ProviderDefinition | null;
  list: () => ProviderDefinition[];
  listForRole: (role: ProviderRole) => ProviderDefinition[];
}

class ProviderRegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderRegistryError';
  }
}

const roleClientFactories = {
  transcription: 'createTranscriptionClient',
  inference: 'createInferenceClient',
} as const satisfies Record<ProviderRole, keyof ProviderDefinition>;

/**
 * Validates the conventions every other module then relies on, so nothing downstream has to defend
 * against a provider that declares a role it cannot serve or a role without a model to send.
 */
function assertDefinition(definition: ProviderDefinition, seen: Set<ProviderId>) {
  const name = `Provider "${definition.id}"`;
  if (!PROVIDER_IDS.includes(definition.id)) {
    throw new ProviderRegistryError(`${name} is not a known provider id.`);
  }
  if (seen.has(definition.id)) {
    throw new ProviderRegistryError(`${name} is registered more than once.`);
  }

  for (const group of PROVIDER_SETTINGS_GROUPS) {
    const keys = definition.settingsFields[group].map((field) => field.key);
    const duplicate = keys.find((key, index) => keys.indexOf(key) !== index);
    if (duplicate) {
      throw new ProviderRegistryError(
        `${name} declares the setting "${duplicate}" more than once in the "${group}" group.`,
      );
    }
  }

  // Connection form values travel as `Record<string, string>` through IPC and are stored as strings,
  // so a select or toggle here could not survive the round trip. Rejecting it at construction keeps
  // that constraint at the declaration rather than at a silent coercion in the connect path.
  if (definition.auth.kind === 'form') {
    const unsupported = definition.auth.fields.find((field) => field.kind !== 'text');
    if (unsupported) {
      throw new ProviderRegistryError(
        `${name} declares a "${unsupported.kind}" connection field ("${unsupported.key}"); connection forms support text fields only.`,
      );
    }
  }

  for (const role of definition.roles) {
    if (definition[roleClientFactories[role]] === undefined) {
      throw new ProviderRegistryError(
        `${name} serves the "${role}" role but declares no ${roleClientFactories[role]}.`,
      );
    }

    const model = definition.settingsFields[role].find((field) => field.key === 'model');
    if (!model || model.kind !== 'text' || model.required !== true) {
      throw new ProviderRegistryError(
        `${name} serves the "${role}" role but does not declare a required "model" text setting in that group.`,
      );
    }
  }
}

export function createProviderRegistry(definitions: ProviderDefinition[]): ProviderRegistry {
  const byId = new Map<ProviderId, ProviderDefinition>();
  for (const definition of definitions) {
    assertDefinition(definition, new Set(byId.keys()));
    byId.set(definition.id, definition);
  }

  // Registry order follows PROVIDER_IDS rather than construction order, so every surface that lists
  // providers presents them in the same order.
  const ordered = PROVIDER_IDS.map((id) => byId.get(id)).filter(
    (definition) => definition !== undefined,
  );

  return {
    get(id) {
      return byId.get(id as ProviderId) ?? null;
    },

    list() {
      return [...ordered];
    },

    listForRole(role) {
      return ordered.filter((definition) => definition.roles.includes(role));
    },
  };
}
