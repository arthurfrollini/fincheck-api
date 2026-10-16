import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { metrics, type Counter } from '@opentelemetry/api';
import { LlmService } from '@shared/llm/llm.service';
import { EmbeddingProvider } from '../domain/embedding-provider';
import { KnowledgeChunksRepository } from '../domain/repositories/knowledge-chunks.repository';
import { type ScoredKnowledgeChunk } from '../entities/KnowledgeChunk';
import {
  CORPUS_TITLE,
  NOT_COVERED_ANSWER,
  RAG_MAX_TOKENS,
  RAG_MIN_SIMILARITY,
  RAG_MODEL,
  RAG_SYSTEM_PROMPT,
  RAG_TOP_K,
  REFUSAL_ANSWER,
} from './rag.constants';

export type RagResult = 'answered' | 'uncited' | 'not_covered' | 'refusal';

export interface RagAnswer {
  answer: string;
  citations: { citedText: string; page: number; chunkId: string }[];
  model: string;
  result: RagResult;
}

export function buildRagRequest(
  question: string,
  chunks: ScoredKnowledgeChunk[],
): Anthropic.MessageCreateParamsNonStreaming & { model: typeof RAG_MODEL } {
  return {
    model: RAG_MODEL,
    max_tokens: RAG_MAX_TOKENS,
    system: RAG_SYSTEM_PROMPT,
    // No output_config.format: the API rejects it alongside citations.
    output_config: { effort: 'medium' },
    messages: [
      {
        role: 'user',
        content: [
          ...chunks.map((c): Anthropic.DocumentBlockParam => ({
            type: 'document',
            source: { type: 'text', media_type: 'text/plain', data: c.text },
            title: `${CORPUS_TITLE}, p. ${c.page}`,
            citations: { enabled: true },
          })),
          { type: 'text', text: question },
        ],
      },
    ],
  };
}

@Injectable()
export class AnswerQuestionService {
  private readonly results: Counter;

  constructor(
    private readonly embeddingProvider: EmbeddingProvider,
    private readonly knowledgeChunksRepository: KnowledgeChunksRepository,
    private readonly llmService: LlmService,
  ) {
    this.results = metrics
      .getMeter('fincheck-api')
      .createCounter('fincheck_rag_results', {
        description: 'Education questions answered, by result',
      });
  }

  async answer(userId: string, question: string): Promise<RagAnswer> {
    const answer = await this.run(userId, question);
    this.results.add(1, { result: answer.result });
    return answer;
  }

  private async run(userId: string, question: string): Promise<RagAnswer> {
    if ((await this.knowledgeChunksRepository.count()) === 0) {
      throw new ServiceUnavailableException('Knowledge base not ingested.');
    }

    const embedding = await this.embeddingProvider.embedQuery(question);
    const chunks = await this.knowledgeChunksRepository.searchSimilar(
      embedding,
      RAG_TOP_K,
    );

    // Nothing close enough: answering anyway would mean answering from the
    // model's general knowledge, which is what this feature exists to avoid.
    if (chunks.length === 0 || chunks[0].similarity < RAG_MIN_SIMILARITY) {
      return fixed(NOT_COVERED_ANSWER, 'not_covered');
    }

    let message: Anthropic.Message;
    try {
      message = await this.llmService.complete(
        'rag',
        buildRagRequest(question, chunks),
        { userId },
      );
    } catch (err) {
      if (err instanceof Anthropic.AnthropicError) {
        throw new ServiceUnavailableException(
          'Could not answer right now, try again.',
        );
      }
      throw err;
    }

    if (message.stop_reason === 'refusal') {
      return fixed(REFUSAL_ANSWER, 'refusal');
    }

    const textBlocks = message.content.filter(
      (b): b is Anthropic.TextBlock => b.type === 'text',
    );
    const citations = textBlocks
      .flatMap((b) => b.citations ?? [])
      .filter(
        (c): c is Anthropic.CitationCharLocation =>
          c.type === 'char_location' && chunks[c.document_index] !== undefined,
      )
      .map((c) => ({
        citedText: c.cited_text,
        page: chunks[c.document_index].page,
        chunkId: chunks[c.document_index].id,
      }));

    return {
      answer: textBlocks.map((b) => b.text).join(''),
      citations,
      model: RAG_MODEL,
      result: citations.length > 0 ? 'answered' : 'uncited',
    };
  }
}

function fixed(answer: string, result: RagResult): RagAnswer {
  return { answer, citations: [], model: RAG_MODEL, result };
}
