import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@shared/database/prisma.service';
import { AgentRunsRepository } from '../../domain/repositories/agent-runs.repository';
import { type AgentRun, type FinishedStatus } from '../../entities/AgentRun';

const UNIQUE_VIOLATION = 'P2002';

@Injectable()
export class AgentRunsPrismaRepository implements AgentRunsRepository {
  constructor(private readonly prismaService: PrismaService) {}

  async register(
    userId: string,
    question: string,
    idempotencyKey?: string,
  ): Promise<{ run: AgentRun; created: boolean }> {
    try {
      const run = await this.prismaService.agentRun.create({
        data: {
          userId,
          question,
          idempotencyKey: idempotencyKey ?? null,
          status: 'QUEUED',
        },
      });
      return { run, created: true };
    } catch (err) {
      if (
        idempotencyKey &&
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === UNIQUE_VIOLATION
      ) {
        const run = await this.prismaService.agentRun.findUnique({
          where: { userId_idempotencyKey: { userId, idempotencyKey } },
        });
        if (run) return { run, created: false };
      }
      throw err;
    }
  }

  findForUser(userId: string, id: string): Promise<AgentRun | null> {
    return this.prismaService.agentRun.findFirst({ where: { id, userId } });
  }

  findByIdempotencyKey(
    userId: string,
    idempotencyKey: string,
  ): Promise<AgentRun | null> {
    return this.prismaService.agentRun.findUnique({
      where: { userId_idempotencyKey: { userId, idempotencyKey } },
    });
  }

  findById(id: string): Promise<AgentRun | null> {
    return this.prismaService.agentRun.findUnique({ where: { id } });
  }

  async markRunning(id: string): Promise<void> {
    await this.prismaService.agentRun.update({
      where: { id },
      data: { status: 'RUNNING', steps: 0 },
    });
  }

  async finish(
    id: string,
    result: { status: FinishedStatus; answer: string; steps: number },
  ): Promise<void> {
    await this.prismaService.agentRun.update({
      where: { id },
      data: { ...result, completedAt: new Date() },
    });
  }
}
