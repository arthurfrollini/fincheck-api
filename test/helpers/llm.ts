import type Anthropic from '@anthropic-ai/sdk';
import * as fs from 'fs';
import type { LlmResult } from '../../src/shared/llm/llm.service';

// Typed builders for Claude API responses, shared by unit and e2e tests.

export function usage(fields: Partial<Anthropic.Usage> = {}): Anthropic.Usage {
  return {
    cache_creation: null,
    cache_creation_input_tokens: null,
    cache_read_input_tokens: null,
    inference_geo: null,
    input_tokens: 300,
    output_tokens: 50,
    output_tokens_details: null,
    server_tool_use: null,
    service_tier: null,
    speed: null,
    ...fields,
  };
}

export function message(
  fields: Partial<Anthropic.Message> = {},
): Anthropic.Message {
  return {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: 'claude-haiku-5-5',
    container: null,
    content: [],
    diagnostics: null,
    stop_reason: 'end_turn',
    stop_sequence: null,
    stop_details: null,
    usage: usage(),
    ...fields,
  };
}

export function textBlock(text: string): Anthropic.TextBlock {
  return { type: 'text', text, citations: null };
}

export function parsedResult<T>(
  parsedOutput: T | null,
  fields: Partial<Anthropic.Message> = {},
): LlmResult<T> {
  return { ...message(fields), parsed_output: parsedOutput };
}

function isMessage(value: unknown): value is Anthropic.Message {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    value.type === 'message' &&
    'content' in value &&
    Array.isArray(value.content)
  );
}

// Recorded API responses under test/fixtures/llm.
export function loadMessageFixture(file: string): Anthropic.Message {
  const value: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!isMessage(value)) throw new Error(`${file} is not a Claude message`);
  return value;
}

export function toolUseBlock(
  id: string,
  name: string,
  input: unknown,
): Anthropic.ToolUseBlock {
  return { type: 'tool_use', id, name, input, caller: { type: 'direct' } };
}

function isParsedResult(value: unknown): value is LlmResult<unknown> {
  return isMessage(value) && 'parsed_output' in value;
}

// Recorded structured-output responses (LlmService.parse results).
export function loadParsedFixture(file: string): LlmResult<unknown> {
  const value: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!isParsedResult(value)) throw new Error(`${file} is not a parse result`);
  return value;
}
