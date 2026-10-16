export type LlmFeature = 'categorization';

export type LlmOutcome = 'ok' | 'refusal' | 'max_tokens' | 'unparsed' | 'error';

export const ANTHROPIC_CLIENT = Symbol('ANTHROPIC_CLIENT');
