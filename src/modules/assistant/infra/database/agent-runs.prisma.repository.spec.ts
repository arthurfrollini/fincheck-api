import { Prisma } from '@prisma/client';
import { PrismaService } from '@shared/database/prisma.service';
import { AgentRunsPrismaRepository } from './agent-runs.prisma.repository';

const p2002 = new Prisma.PrismaClientKnownRequestError('dup', {
  code: 'P2002',
  clientVersion: '6.19.3',
});

const run = {
  id: 'run-1',
  userId: 'u1',
  question: 'q',
  status: 'QUEUED',
  idempotencyKey: 'k',
  answer: null,
  steps: 0,
};

describe('AgentRunsPrismaRepository', () => {
  let agentRun: Record<string, jest.Mock>;
  let repository: AgentRunsPrismaRepository;

  beforeEach(() => {
    agentRun = {
      create: jest.fn().mockResolvedValue(run),
      findUnique: jest.fn().mockResolvedValue(run),
      findFirst: jest.fn().mockResolvedValue(run),
      update: jest.fn().mockResolvedValue(run),
    };
    repository = new AgentRunsPrismaRepository({
      agentRun,
    } as unknown as PrismaService);
  });

  it('creates a queued run with the idempotency key', async () => {
    await expect(repository.register('u1', 'q', 'k')).resolves.toEqual({
      run,
      created: true,
    });
    expect(agentRun.create).toHaveBeenCalledWith({
      data: {
        userId: 'u1',
        question: 'q',
        idempotencyKey: 'k',
        status: 'QUEUED',
      },
    });
  });

  it('returns the existing run when the same key was already used (unique violation)', async () => {
    agentRun.create.mockRejectedValueOnce(p2002);

    await expect(repository.register('u1', 'q', 'k')).resolves.toEqual({
      run,
      created: false,
    });
    expect(agentRun.findUnique).toHaveBeenCalledWith({
      where: { userId_idempotencyKey: { userId: 'u1', idempotencyKey: 'k' } },
    });
  });

  it('always creates when no key is given', async () => {
    await repository.register('u1', 'q');
    expect(agentRun.create).toHaveBeenCalledWith({
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
    agentRun.create.mockRejectedValueOnce(error);
    await expect(repository.register('u1', 'q', 'k')).rejects.toBe(error);
  });

  it('scopes reads by user', async () => {
    await repository.findForUser('u1', 'run-1');
    expect(agentRun.findFirst).toHaveBeenCalledWith({
      where: { id: 'run-1', userId: 'u1' },
    });
  });

  it('markRunning resets the step count, so a retried run starts clean', async () => {
    await repository.markRunning('run-1');
    expect(agentRun.update).toHaveBeenCalledWith({
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
    expect(agentRun.update).toHaveBeenCalledWith({
      where: { id: 'run-1' },
      data: {
        status: 'COMPLETED',
        answer: 'a',
        steps: 2,
        completedAt: expect.any(Date),
      },
    });
  });
});

describe('AgentRunsPrismaRepository.findByIdempotencyKey', () => {
  it('looks the run up by (userId, key)', async () => {
    const findUnique = jest.fn().mockResolvedValue(null);
    const repository = new AgentRunsPrismaRepository({
      agentRun: { findUnique },
    } as unknown as PrismaService);

    await repository.findByIdempotencyKey('u1', 'k');

    expect(findUnique).toHaveBeenCalledWith({
      where: { userId_idempotencyKey: { userId: 'u1', idempotencyKey: 'k' } },
    });
  });
});
