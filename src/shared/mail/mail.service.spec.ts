import type { Resend } from 'resend';
import { MailService } from './mail.service';
import {
  anyInstance,
  objectContaining,
  stringContaining,
} from '../../../test/helpers/match';

// Mock env to avoid validation errors during tests
jest.mock('@shared/config/env', () => ({
  env: {
    resendApiKey: 'test-resend-api-key',
    resendFromEmail: 'noreply@fincheck.test',
  },
}));

// Mock the Resend SDK before importing MailService
const sendMock = jest
  .fn<
    ReturnType<Resend['emails']['send']>,
    Parameters<Resend['emails']['send']>
  >()
  .mockResolvedValue({ data: { id: 'email_1' }, error: null, headers: null });

jest.mock('resend', () => ({
  Resend: jest.fn(() => ({ emails: { send: sendMock } })),
}));

describe('MailService', () => {
  let service: MailService;

  beforeEach(() => {
    sendMock.mockClear();
    service = new MailService();
  });

  describe('sendEmailChangeConfirmation', () => {
    it('sends confirmation email with confirm url containing token', async () => {
      await service.sendEmailChangeConfirmation(
        'user@example.com',
        'abc-token-123',
      );

      expect(sendMock).toHaveBeenCalledTimes(1);
      expect(sendMock).toHaveBeenCalledWith(
        objectContaining({
          from: 'noreply@fincheck.test',
          to: 'user@example.com',
          subject: 'Confirme a alteração do seu e-mail',
          html: stringContaining(
            'http://localhost:3000/users/confirm-email?token=abc-token-123',
          ),
        }),
        { signal: anyInstance(AbortSignal) },
      );
    });
  });

  describe('sendWelcome', () => {
    it('sends welcome email containing the user name', async () => {
      await service.sendWelcome('user@example.com', 'Arthur');

      expect(sendMock).toHaveBeenCalledTimes(1);
      expect(sendMock).toHaveBeenCalledWith(
        objectContaining({
          from: 'noreply@fincheck.test',
          to: 'user@example.com',
          subject: 'Bem-vindo ao Fincheck!',
          html: stringContaining('Olá, Arthur!'),
        }),
        { signal: anyInstance(AbortSignal) },
      );
    });
  });

  describe('sendDowngradeNotification', () => {
    it('sends downgrade email containing name and new plan', async () => {
      await service.sendDowngradeNotification(
        'user@example.com',
        'Arthur',
        'FREE',
      );

      expect(sendMock).toHaveBeenCalledTimes(1);
      expect(sendMock).toHaveBeenCalledWith(
        objectContaining({
          from: 'noreply@fincheck.test',
          to: 'user@example.com',
          subject: 'Seu plano Fincheck foi alterado',
          html: stringContaining('Olá, Arthur!'),
        }),
        { signal: anyInstance(AbortSignal) },
      );
      expect(sendMock).toHaveBeenCalledWith(
        objectContaining({
          html: stringContaining('<strong>FREE</strong>'),
        }),
        { signal: anyInstance(AbortSignal) },
      );
    });
  });

  describe('sendSubscriptionCancelled', () => {
    it('sends cancellation email containing the user name', async () => {
      await service.sendSubscriptionCancelled('user@example.com', 'Arthur');

      expect(sendMock).toHaveBeenCalledTimes(1);
      expect(sendMock).toHaveBeenCalledWith(
        objectContaining({
          from: 'noreply@fincheck.test',
          to: 'user@example.com',
          subject: 'Sua assinatura Fincheck foi cancelada',
          html: stringContaining('Olá, Arthur!'),
        }),
        { signal: anyInstance(AbortSignal) },
      );
    });
  });

  describe('error handling', () => {
    it('throws when Resend returns an error (so the job fails and retries)', async () => {
      sendMock.mockResolvedValueOnce({
        data: null,
        error: { name: 'application_error', message: 'boom', statusCode: 500 },
        headers: null,
      });

      await expect(
        service.sendWelcome('user@example.com', 'Arthur'),
      ).rejects.toThrow(/Resend failed to send email/);
    });
  });
});

describe('MailService delivery config', () => {
  let service: MailService;
  const saved = { ...process.env };

  beforeEach(() => {
    sendMock.mockClear();
    service = new MailService();
  });
  afterEach(() => {
    process.env.MAIL_REDIRECT_TO = saved.MAIL_REDIRECT_TO;
    process.env.MAIL_ENABLED = saved.MAIL_ENABLED;
    if (saved.MAIL_REDIRECT_TO === undefined)
      delete process.env.MAIL_REDIRECT_TO;
    if (saved.MAIL_ENABLED === undefined) delete process.env.MAIL_ENABLED;
  });

  it('sends to the real recipient by default', async () => {
    delete process.env.MAIL_REDIRECT_TO;
    await service.sendWelcome('user@example.com', 'Ana');
    expect(sendMock).toHaveBeenCalledWith(
      objectContaining({ to: 'user@example.com' }),
      expect.anything(),
    );
  });

  it('redirects every email to MAIL_REDIRECT_TO when set (local dev)', async () => {
    process.env.MAIL_REDIRECT_TO = 'owner@example.com';
    await service.sendWelcome('user@example.com', 'Ana');
    expect(sendMock).toHaveBeenCalledWith(
      objectContaining({ to: 'owner@example.com' }),
      expect.anything(),
    );
  });

  it('does not call Resend when MAIL_ENABLED=false', async () => {
    process.env.MAIL_ENABLED = 'false';
    await expect(
      service.sendWelcome('user@example.com', 'Ana'),
    ).resolves.toBeUndefined();
    expect(sendMock).not.toHaveBeenCalled();
  });
});

describe('no hard-coded recipients', () => {
  it('keeps personal email addresses out of the source', () => {
    const fs = jest.requireActual<typeof import('fs')>('fs');
    const path = jest.requireActual<typeof import('path')>('path');
    const root = path.resolve(__dirname, '../..');
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full);
        else if (
          full.endsWith('.ts') &&
          !full.endsWith('.spec.ts') &&
          /@gmail\.com/.test(fs.readFileSync(full, 'utf8'))
        )
          offenders.push(full);
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });
});
