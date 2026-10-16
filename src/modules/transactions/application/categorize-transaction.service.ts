import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { metrics, type Counter } from '@opentelemetry/api';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { z } from 'zod';
import { LlmService } from '@shared/llm/llm.service';
import { type LlmModel } from '@shared/llm/llm-pricing';
import { CategoriesRepository } from '@modules/categories/domain/repositories/categories.repository';
import { ValidateCategoryOwnershipService } from '@modules/categories/application/validate-category-ownership.service';
import { type CategoryEntity } from '@modules/categories/entities/Category';
import { TransactionsRepository } from '../domain/repositories/transactions.repository';
import {
  type TransactionEntity,
  type TransactionType,
} from '../entities/Transaction';
import {
  CATEGORIZATION_MAX_TOKENS,
  CATEGORIZATION_MIN_CONFIDENCE,
  CATEGORIZATION_MODEL,
  CATEGORIZATION_SYSTEM_PROMPT,
  NO_CATEGORY,
} from './categorization.constants';

export type CategorizationResult =
  'categorized' | 'uncategorized' | 'skipped' | 'rejected' | 'failed';

const PRISMA_FOREIGN_KEY_VIOLATION = 'P2003';

function escapeField(value: string): string {
  return value.replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

export function buildCategorizationRequest(
  transaction: Pick<TransactionEntity, 'name' | 'type' | 'value'>,
  candidates: Pick<CategoryEntity, 'id' | 'name'>[],
  model: LlmModel,
) {
  const ids = candidates.map((c) => c.id);
  const schema = z.object({
    categoryId: z.enum([...ids, NO_CATEGORY] as [string, ...string[]]),
    confidence: z.number().min(0).max(1),
  });

  const content = [
    'Categories:',
    ...candidates.map((c) => `${c.id}: ${escapeField(c.name)}`),
    '',
    `<transaction_name>${escapeField(transaction.name)}</transaction_name>`,
    `<transaction_type>${transaction.type}</transaction_type>`,
    `<transaction_value>${transaction.value}</transaction_value>`,
  ].join('\n');

  return {
    model,
    max_tokens: CATEGORIZATION_MAX_TOKENS,
    system: CATEGORIZATION_SYSTEM_PROMPT,
    output_config: { effort: 'low' as const, format: zodOutputFormat(schema) },
    messages: [{ role: 'user' as const, content }],
  };
}

@Injectable()
export class CategorizeTransactionService {
  private readonly results: Counter;

  constructor(
    private readonly llmService: LlmService,
    private readonly transactionsRepository: TransactionsRepository,
    private readonly categoriesRepository: CategoriesRepository,
    private readonly validateCategoryOwnershipService: ValidateCategoryOwnershipService,
    @InjectPinoLogger(CategorizeTransactionService.name)
    private readonly logger: PinoLogger,
  ) {
    this.results = metrics
      .getMeter('fincheck-api')
      .createCounter('fincheck_categorization_results', {
        description: 'Transaction categorization attempts, by result',
      });
  }

  // SDK errors propagate unchanged; the queue processor decides whether
  // they are worth retrying. Only completed attempts are counted.
  async categorize(
    userId: string,
    transactionId: string,
    model: LlmModel = CATEGORIZATION_MODEL,
  ): Promise<CategorizationResult> {
    const result = await this.run(userId, transactionId, model);
    this.results.add(1, { result });
    return result;
  }

  private async run(
    userId: string,
    transactionId: string,
    model: LlmModel,
  ): Promise<CategorizationResult> {
    const transaction = await this.transactionsRepository.findFirst(
      transactionId,
      userId,
    );
    if (!transaction || transaction.categoryId) return 'skipped';

    const candidates = await this.categoriesRepository.findAllByUserIdAndType(
      userId,
      transaction.type,
    );
    if (candidates.length === 0) return 'skipped';

    const response = await this.llmService.parse(
      'categorization',
      buildCategorizationRequest(transaction, candidates, model),
      { transactionId },
    );
    if (
      response.stop_reason === 'refusal' ||
      response.stop_reason === 'max_tokens' ||
      !response.parsed_output
    ) {
      return 'failed';
    }

    const { categoryId, confidence } = response.parsed_output;
    if (
      categoryId === NO_CATEGORY ||
      confidence < CATEGORIZATION_MIN_CONFIDENCE
    ) {
      return 'uncategorized';
    }

    // The schema enum already limits answers to this user's ids. This check
    // is the authorization layer and must not rely on the schema.
    if (!(await this.isAllowed(userId, categoryId, transaction.type))) {
      this.logger.warn(
        { transactionId, categoryId },
        'Model returned a category that is not this user’s or not this type',
      );
      return 'rejected';
    }

    try {
      const written = await this.transactionsRepository.setCategoryIfUnset(
        transactionId,
        userId,
        categoryId,
      );
      return written ? 'categorized' : 'skipped';
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === PRISMA_FOREIGN_KEY_VIOLATION
      ) {
        this.logger.warn(
          { transactionId, categoryId },
          'Category was deleted before the categorization could be saved',
        );
        return 'rejected';
      }
      throw err;
    }
  }

  private async isAllowed(
    userId: string,
    categoryId: string,
    type: TransactionType,
  ): Promise<boolean> {
    try {
      const category = await this.validateCategoryOwnershipService.validate(
        userId,
        categoryId,
      );
      return category.type === type;
    } catch (err) {
      if (err instanceof NotFoundException) return false;
      throw err;
    }
  }
}
