import { AiThrottle } from '@shared/security/throttle';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { type Response } from 'express';
import { ActiveUserId } from '@shared/decorators/active-user-id.decorator';
import { AssistantService } from '../../application/assistant.service';
import { AskAssistantDto } from './dto/ask-assistant.dto';

const MAX_IDEMPOTENCY_KEY_LENGTH = 200;

@ApiTags('assistant')
@ApiBearerAuth()
@Controller('assistant')
export class AssistantController {
  constructor(private readonly assistantService: AssistantService) {}

  @Post('questions')
  @AiThrottle()
  @ApiOperation({
    summary: '/assistant/questions',
    description:
      'Ask a question about your own transactions. Answered asynchronously by an agent: poll GET /assistant/runs/:runId.',
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description: 'Repeat a request safely: the same key returns the same run',
  })
  @ApiResponse({ status: 202, description: 'Run created and queued' })
  @ApiResponse({
    status: 200,
    description: 'Existing run for this Idempotency-Key',
  })
  @ApiResponse({
    status: 400,
    description: 'Empty or too long question or key',
  })
  @ApiResponse({ status: 401, description: 'Missing or invalid token' })
  async ask(
    @ActiveUserId() userId: string,
    @Body() { question }: AskAssistantDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (
      idempotencyKey !== undefined &&
      (idempotencyKey.length === 0 ||
        idempotencyKey.length > MAX_IDEMPOTENCY_KEY_LENGTH)
    ) {
      throw new BadRequestException(
        `Idempotency-Key must be 1-${MAX_IDEMPOTENCY_KEY_LENGTH} characters.`,
      );
    }
    const { run, created } = await this.assistantService.ask(
      userId,
      question,
      idempotencyKey,
    );
    res.status(created ? HttpStatus.ACCEPTED : HttpStatus.OK);
    return { runId: run.id, status: run.status };
  }

  @Get('runs/:runId')
  @ApiOperation({
    summary: '/assistant/runs/:runId',
    description: 'Status and answer of one of your agent runs',
  })
  @ApiResponse({
    status: 200,
    description: 'Run status, answer when finished, steps used',
  })
  @ApiResponse({ status: 404, description: 'No such run for this user' })
  async findRun(
    @ActiveUserId() userId: string,
    @Param('runId', ParseUUIDPipe) runId: string,
  ) {
    const { status, answer, steps } = await this.assistantService.findRun(
      userId,
      runId,
    );
    return { status, answer, steps };
  }
}
