import type { CostEstimator } from '@toph/dictation-core';

/** Mobile records no usage or cost (story #9 scope), so every provider client gets this estimator. */
export const noCost: CostEstimator = {
  estimateCost: () => ({
    costUsdMicros: 0,
    costSource: 'none',
    pricingCatalogProviderId: null,
    pricingCatalogModelId: null,
  }),
};
