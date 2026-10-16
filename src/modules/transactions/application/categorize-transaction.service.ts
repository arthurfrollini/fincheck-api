import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { metrics, type Counter } from '@opentelemetry/api';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { z } from 'zod';
import { LlmService, type LlmParams } from '@shared/llm/llm.service';
import { PlanGuardService } from '@shared/plan/plan-guard.service';
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

export function categorizationSchema(candidateIds: string[]) {
  return z.object({
    categoryId: z.enum([NO_CATEGORY, ...candidateIds] as [string, ...string[]]),
    confidence: z.number().min(0).max(1),
  });
}

export type CategorizationAnswer = z.infer<
  ReturnType<typeof categorizationSchema>
>;

// The single place that turns a model answer into a write decision. The eval
// runner uses it too, so measured accuracy is production's accuracy.
export function interpretAnswer(answer: CategorizationAnswer): string | null {
  if (answer.categoryId === NO_CATEGORY) return null;
  if (answer.confidence < CATEGORIZATION_MIN_CONFIDENCE) return null;
  return answer.categoryId;
}

export function buildCategorizationRequest(
  transaction: Pick<TransactionEntity, 'name' | 'type' | 'value'>,
  candidates: Pick<CategoryEntity, 'id' | 'name'>[],
  model: LlmModel,
): { params: LlmParams; schema: ReturnType<typeof categorizationSchema> } {
  const ids = candidates.map((c) => c.id);

  const content = [
    'Categories:',
    ...candidates.map((c) => `${c.id}: ${escapeField(c.name)}`),
    '',
    `<transaction_name>${escapeField(transaction.name)}</transaction_name>`,
    `<transaction_type>${transaction.type}</transaction_type>`,
    `<transaction_value>${transaction.value}</transaction_value>`,
  ].join('\n');

  return {
    params: {
      model,
      max_tokens: CATEGORIZATION_MAX_TOKENS,
      system: CATEGORIZATION_SYSTEM_PROMPT,
      output_config: {
        effort: 'low',
        // Hand-built rather than zodOutputFormat: the SDK's transform strips
        // `enum` into a description hint, but the API enforces `enum`, which
        // is what keeps answers inside this user's ids. The API does not
        // support minimum/maximum, so the 0-1 range is checked client-side
        // by categorizationSchema.
        format: {
          type: 'json_schema',
          schema: {
            type: 'object',
            properties: {
              categoryId: { type: 'string', enum: [NO_CATEGORY, ...ids] },
              confidence: {
                type: 'number',
                description: 'From 0 (a guess) to 1 (certain).',
              },
            },
            required: ['categoryId', 'confidence'],
            additionalProperties: false,
          },
        },
      },
      messages: [{ role: 'user', content }],
    },
    schema: categorizationSchema(ids),
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
    private readonly planGuardService: PlanGuardService,
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

    // Daily AI spend ceiling reached: leave the transaction uncategorized
    // rather than fail the job (the write already succeeded).
    if (await this.planGuardService.isAiBudgetExhausted()) return 'skipped';

    const { params, schema } = buildCategorizationRequest(
      transaction,
      candidates,
      model,
    );
    const response = await this.llmService.parse(
      'categorization',
      params,
      schema,
      { transactionId, userId },
    );
    if (
      response.stop_reason === 'refusal' ||
      response.stop_reason === 'max_tokens' ||
      !response.parsed_output
    ) {
      return 'failed';
    }

    const categoryId = interpretAnswer(response.parsed_output);
    if (!categoryId) return 'uncategorized';

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
