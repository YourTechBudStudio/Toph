export { TimelineAssembler, type TimelineAssemblerPolicy } from './segmentation/timeline-assembler';
export { LiveBatchPlanner, type LiveBatchPlanningPolicy } from './segmentation/live-batch-planner';
export type {
  BatchSourceRangeReason,
  PlannedBatchSourceRange,
  PlannedTranscriptionBatch,
  SpeechProbabilityFrame,
  TimelineRegionDraft,
  TimelineRegionKind,
} from './segmentation/types';

export { createSessionTranscriptionCoordinator } from './transcription/session-transcription-coordinator';
export type {
  BatchSkipReason,
  BatchTranscriptRecord,
  SessionTranscriptionCoordinator,
  SessionTranscriptionOutcome,
  TranscriptionBatchRecord,
  TranscriptionBatchStatus,
  TranscriptionCoordinatorEvent,
  TranscriptionStore,
} from './transcription/session-transcription-coordinator';
export {
  isTransientTranscriptionProviderError,
  TransientTranscriptionProviderError,
} from './transcription/transcription-client';
export type {
  TranscriptionClient,
  TranscriptionClientResult,
} from './transcription/transcription-client';
export { assembleRawTranscriptText } from './transcription/raw-transcript';

export {
  createOpenAiTranscriptionClient,
  type OpenAiTranscriptionClientContext,
} from './providers/openai/transcription-client';
export {
  endpointFromCredentials,
  isOfficialOpenAiEndpoint,
  isRetryableStatus,
  normalizeBaseUrl,
  readRequestId,
  readResponseBody,
  type OpenAiEndpoint,
} from './providers/openai/http';

export { toProviderUsageEvent } from './usage/provider-usage';
export type {
  ProviderUsageDetails,
  ProviderUsageEventRecord,
  ProviderUsageOperationKind,
  ProviderUsageRelatedEntityKind,
} from './usage/provider-usage';
export type {
  AudioDurationUsage,
  CostEstimateInput,
  CostEstimator,
  CostSource,
  PricingUsage,
  TokenUsage,
  UsageCostEstimate,
} from './usage/pricing';

export {
  createDefaultAppSettings,
  normalizeAppSettings,
  parseAppSettingsFile,
} from './settings/app-settings-schema';
export type {
  AppSettingsFile,
  ProviderDeclaration,
  ProviderSettingsDeclarations,
} from './settings/app-settings-schema';
