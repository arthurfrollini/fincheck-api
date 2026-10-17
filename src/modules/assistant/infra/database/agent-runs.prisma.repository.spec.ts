import { type DeepMockProxy, mockDeep } from 'jest-mock-extended';
import { agentRunRow } from '../../../../../test/helpers/prisma-rows';
import { anyInstance } from '../../../../../test/helpers/match';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@shared/database/prisma.service';
import { AgentRunsPrismaRepository } from './agent-runs.prisma.repository';

const p2002 = new Prisma.PrismaClientKnownRequestError('dup', {
  code: 'P2002',
  clientVersion: '6.19.3',
});

const run = agentRunRow({ userId: 'u1', question: 'q', idempotencyKey: 'k' });

describe('AgentRunsPrismaRepository', () => {
  let prisma: DeepMockProxy<PrismaService>;
  let repository: AgentRunsPrismaRepository;

  beforeEach(() => {
    prisma = mockDeep<PrismaService>();
    prisma.agentRun.create.mockResolvedValue(run);
    prisma.agentRun.findUnique.mockResolvedValue(run);
    prisma.agentRun.findFirst.mockResolvedValue(run);
    prisma.agentRun.update.mockResolvedValue(run);
    repository = new AgentRunsPrismaRepository(prisma);
  });

  it('creates a queued run with the idempotency key', async () => {
    await expect(repository.register('u1', 'q', 'k')).resolves.toEqual({
      run,
      created: true,
    });
    expect(prisma.agentRun.create).toHaveBeenCalledWith({
      data: {
        userId: 'u1',
        question: 'q',
        idempotencyKey: 'k',
        status: 'QUEUED',
      },
    });
  });

  it('returns the existing run when the same key was already used (unique violation)', async () => {
    prisma.agentRun.create.mockRejectedValueOnce(p2002);

    await expect(repository.register('u1', 'q', 'k')).resolves.toEqual({
      run,
      created: false,
    });
    expect(prisma.agentRun.findUnique).toHaveBeenCalledWith({
      where: { userId_idempotencyKey: { userId: 'u1', idempotencyKey: 'k' } },
    });
  });

  it('always creates when no key is given', async () => {
    await repository.register('u1', 'q');
    expect(prisma.agentRun.create).toHaveBeenCalledWith({
      data: {
        userId: 'u1',
        question: 'q',
        idempotencyKey: null,
        status: 'QUEUED',
      },
    });
  });

  it('rethrows other database errors', async () => {
    const error = new Error('db down');
    prisma.agentRun.create.mockRejectedValueOnce(error);
    await expect(repository.register('u1', 'q', 'k')).rejects.toBe(error);
  });

  it('scopes reads by user', async () => {
    await repository.findForUser('u1', 'run-1');
    expect(prisma.agentRun.findFirst).toHaveBeenCalledWith({
      where: { id: 'run-1', userId: 'u1' },
    });
  });

  it('markRunning resets the step count, so a retried run starts clean', async () => {
    await repository.markRunning('run-1');
    expect(prisma.agentRun.update).toHaveBeenCalledWith({
      where: { id: 'run-1' },
      data: { status: 'RUNNING', steps: 0 },
    });
  });

  it('finish records status, answer, steps and completion time', async () => {
    await repository.finish('run-1', {
      status: 'COMPLETED',
      answer: 'a',
      steps: 2,
    });
    expect(prisma.agentRun.update).toHaveBeenCalledWith({
      where: { id: 'run-1' },
      data: {
        status: 'COMPLETED',
        answer: 'a',
        steps: 2,
        completedAt: anyInstance(Date),
      },
    });
  });
});

describe('AgentRunsPrismaRepository.findByIdempotencyKey', () => {
  it('looks the run up by (userId, key)', async () => {
    const prisma = mockDeep<PrismaService>();
    prisma.agentRun.findUnique.mockResolvedValue(null);
    const repository = new AgentRunsPrismaRepository(prisma);

    await repository.findByIdempotencyKey('u1', 'k');

    expect(prisma.agentRun.findUnique).toHaveBeenCalledWith({
      where: { userId_idempotencyKey: { userId: 'u1', idempotencyKey: 'k' } },
    });
  });
});
