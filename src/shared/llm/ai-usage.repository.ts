import { type LlmFeature } from './llm.types';

export interface AiUsageRow {
  userId: string;
  feature: LlmFeature;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

// DI token. "Today" is the UTC day, the same boundary as the daily
// transaction limit.
export abstract class AiUsageRepository {
  abstract record(row: AiUsageRow): Promise<void>;
  abstract countForUserToday(
    userId: string,
    feature: LlmFeature,
  ): Promise<number>;
  abstract spendToday(): Promise<number>;
}
