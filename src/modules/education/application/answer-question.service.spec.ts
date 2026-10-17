import * as path from 'path';
import Anthropic from '@anthropic-ai/sdk';
import { ServiceUnavailableException } from '@nestjs/common';
import { type Counter, type Meter, metrics } from '@opentelemetry/api';
import { mock, type MockProxy } from 'jest-mock-extended';
import { PlanGuardService } from '@shared/plan/plan-guard.service';
import { loadMessageFixture } from '../../../../test/helpers/llm';
import { LlmService } from '@shared/llm/llm.service';
import { type ScoredKnowledgeChunk } from '../entities/KnowledgeChunk';
import { EmbeddingProvider } from '../domain/embedding-provider';
import { KnowledgeChunksRepository } from '../domain/repositories/knowledge-chunks.repository';
import { AnswerQuestionService } from './answer-question.service';
import {
  NOT_COVERED_ANSWER,
  RAG_MIN_SIMILARITY,
  RAG_SYSTEM_PROMPT,
  RAG_TOP_K,
  REFUSAL_ANSWER,
} from './rag.constants';

const FIXTURES = path.resolve(__dirname, '../../../../test/fixtures/llm/rag');
const fixture = (name: string) =>
  loadMessageFixture(path.join(FIXTURES, `${name}.json`));

const chunk = (
  id: string,
  page: number,
  similarity: number,
): ScoredKnowledgeChunk => ({
  id,
  documentSha: 'sha',
  chunkIndex: page,
  page,
  text: `texto do chunk ${id}`,
  similarity,
});

describe('AnswerQuestionService', () => {
  let embeddings: MockProxy<EmbeddingProvider>;
  let repo: MockProxy<KnowledgeChunksRepository>;
  let llm: MockProxy<LlmService>;
  let results: MockProxy<Counter>;
  let planGuard: MockProxy<PlanGuardService>;
  let service: AnswerQuestionService;

  // Retrieved in this order; the fixture cites document_index 1 then 0.
  const retrieved = [
    chunk('chunk-a', 12, RAG_MIN_SIMILARITY + 0.05),
    chunk('chunk-b', 40, RAG_MIN_SIMILARITY + 0.03),
  ];

  beforeEach(() => {
    results = mock<Counter>();
    const meter = mock<Meter>();
    meter.createCounter.mockReturnValue(results);
    jest.spyOn(metrics, 'getMeter').mockReturnValue(meter);
    embeddings = mock<EmbeddingProvider>();
    embeddings.embedQuery.mockResolvedValue([0.1, 0.2]);
    repo = mock<KnowledgeChunksRepository>();
    repo.count.mockResolvedValue(173);
    repo.searchSimilar.mockResolvedValue(retrieved);
    llm = mock<LlmService>();
    llm.complete.mockResolvedValue(fixture('cited'));
    planGuard = mock<PlanGuardService>();
    planGuard.validateGlobalAiBudget.mockResolvedValue(undefined);
    planGuard.validateDailyAiQuota.mockResolvedValue(undefined);
    service = new AnswerQuestionService(embeddings, repo, llm, planGuard);
  });

  afterEach(() => jest.restoreAllMocks());

  it('answers with citations mapped to the chunk at each document_index', async () => {
    const result = await service.answer('u1', 'quanto guardar por mês?');

    expect(result.result).toBe('answered');
    expect(result.answer).toBe(
      'Segundo o material do Banco Central, a reserva financeira deve cobrir de 3 a 6 meses de despesas, e o ideal é poupar todo mês antes de gastar.',
    );
    expect(result.citations).toEqual([
      {
        citedText: 'reserva financeira deve cobrir de 3 a 6 meses de despesas',
        page: 40,
        chunkId: 'chunk-b',
      },
      {
        citedText: 'poupar todo mês antes de gastar',
        page: 12,
        chunkId: 'chunk-a',
      },
    ]);
    expect(results.add).toHaveBeenCalledWith(1, { result: 'answered' });
  });

  it('sends one cited document block per chunk, in retrieval order, then the question', async () => {
    await service.answer('u1', 'quanto guardar por mês?');

    expect(embeddings.embedQuery).toHaveBeenCalledWith(
      'quanto guardar por mês?',
    );
    expect(repo.searchSimilar).toHaveBeenCalledWith([0.1, 0.2], RAG_TOP_K);
    const [feature, params, context] = llm.complete.mock.calls[0];
    expect(feature).toBe('rag');
    expect(context).toEqual({ userId: 'u1' });
    expect(params.model).toBe('claude-sonnet-5-5');
    expect(params.system).toBe(RAG_SYSTEM_PROMPT);
    expect(params).not.toHaveProperty('output_config.format');
    const { content } = params.messages[0];
    expect(content).toEqual([
      {
        type: 'document',
        source: {
          type: 'text',
          media_type: 'text/plain',
          data: 'texto do chunk chunk-a',
        },
        title: 'Caderno de Educação Financeira (BCB), p. 12',
        citations: { enabled: true },
      },
      expect.objectContaining({
        type: 'document',
        title: 'Caderno de Educação Financeira (BCB), p. 40',
      }),
      { type: 'text', text: 'quanto guardar por mês?' },
    ]);
  });

  it('does not call the model when the best match is below the similarity floor', async () => {
    repo.searchSimilar.mockResolvedValueOnce([
      chunk('chunk-x', 5, RAG_MIN_SIMILARITY - 0.01),
    ]);

    const result = await service.answer('u1', 'receita de bolo de cenoura');

    expect(llm.complete).not.toHaveBeenCalled();
    expect(result).toEqual({
      answer: NOT_COVERED_ANSWER,
      citations: [],
      model: 'claude-sonnet-5-5',
      result: 'not_covered',
    });
  });

  it('returns 503 when nothing has been ingested', async () => {
    repo.count.mockResolvedValueOnce(0);

    await expect(service.answer('u1', 'x')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(embeddings.embedQuery).not.toHaveBeenCalled();
  });

  it('returns a fixed answer on refusal', async () => {
    llm.complete.mockResolvedValueOnce(fixture('refusal'));

    const result = await service.answer('u1', 'x');

    expect(result).toEqual(
      expect.objectContaining({
        answer: REFUSAL_ANSWER,
        citations: [],
        result: 'refusal',
      }),
    );
  });

  it('flags an answer with no citations as uncited', async () => {
    llm.complete.mockResolvedValueOnce(fixture('uncited'));

    const result = await service.answer('u1', 'x');

    expect(result.result).toBe('uncited');
    expect(result.answer).toBe('Guarde o que puder.');
  });

  it('drops a citation whose document_index points past the retrieved chunks', async () => {
    const message = fixture('cited');
    const block = message.content.find(
      (b): b is Anthropic.TextBlock => b.type === 'text' && !!b.citations,
    );
    const citation = block?.citations?.[0];
    if (!citation || !('document_index' in citation))
      throw new Error('fixture has no document citation');
    citation.document_index = 99;
    llm.complete.mockResolvedValueOnce(message);

    const result = await service.answer('u1', 'x');

    expect(result.citations.every((c) => c.chunkId !== undefined)).toBe(true);
    expect(result.citations).toHaveLength(1);
  });

  it('turns Claude API errors into 503 without counting a result', async () => {
    llm.complete.mockRejectedValueOnce(
      new Anthropic.RateLimitError(429, undefined, 'x', new Headers()),
    );

    await expect(service.answer('u1', 'x')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(results.add).not.toHaveBeenCalled();
  });

  it('rethrows non-API errors unchanged', async () => {
    const error = new Error('db down');
    repo.searchSimilar.mockRejectedValueOnce(error);

    await expect(service.answer('u1', 'x')).rejects.toBe(error);
  });

  it("checks the global budget, then the user's RAG quota, before doing any work", async () => {
    await service.answer('u1', 'x');
    expect(planGuard.validateGlobalAiBudget).toHaveBeenCalled();
    expect(planGuard.validateDailyAiQuota).toHaveBeenCalledWith('u1', 'rag');
  });

  it('refuses over quota without embedding, searching or calling the model', async () => {
    const { ForbiddenException } =
      jest.requireActual<typeof import('@nestjs/common')>('@nestjs/common');
    planGuard.validateDailyAiQuota.mockRejectedValueOnce(
      new ForbiddenException('quota'),
    );

    await expect(service.answer('u1', 'x')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(embeddings.embedQuery).not.toHaveBeenCalled();
    expect(llm.complete).not.toHaveBeenCalled();
    expect(results.add).not.toHaveBeenCalled();
  });
});
