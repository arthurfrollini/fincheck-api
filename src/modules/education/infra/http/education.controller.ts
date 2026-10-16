import { AiThrottle } from '@shared/security/throttle';
import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AnswerQuestionService } from '../../application/answer-question.service';
import { ActiveUserId } from '@shared/decorators/active-user-id.decorator';
import { AskQuestionDto } from './dto/ask-question.dto';

@ApiTags('education')
@ApiBearerAuth()
@Controller('education')
export class EducationController {
  constructor(private readonly answerQuestionService: AnswerQuestionService) {}

  @Post('questions')
  @AiThrottle()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '/education/questions',
    description:
      "Answer a personal finance question from Banco Central do Brasil's Caderno de Educação Financeira, citing the passages and pages used",
  })
  @ApiResponse({ status: 200, description: 'Answer with citations' })
  @ApiResponse({ status: 400, description: 'Empty or too long question' })
  @ApiResponse({ status: 401, description: 'Missing or invalid token' })
  @ApiResponse({
    status: 503,
    description: 'Knowledge base not ingested, or the model is unavailable',
  })
  async ask(
    @ActiveUserId() userId: string,
    @Body() { question }: AskQuestionDto,
  ) {
    const { result: _result, ...answer } =
      await this.answerQuestionService.answer(userId, question);
    return answer;
  }
}
