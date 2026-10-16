export type LlmFeature = 'categorization' | 'rag' | 'judge' | 'agent';

export type LlmOutcome = 'ok' | 'refusal' | 'max_tokens' | 'unparsed' | 'error';

export const ANTHROPIC_CLIENT = Symbol('ANTHROPIC_CLIENT');
