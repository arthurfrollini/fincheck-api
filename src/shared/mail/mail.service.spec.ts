import { MailService } from './mail.service';

// Mock env to avoid validation errors during tests
jest.mock('@shared/config/env', () => ({
  env: {
    resendApiKey: 'test-resend-api-key',
    resendFromEmail: 'noreply@fincheck.test',
  },
}));

// Mock the Resend SDK before importing MailService
const sendMock = jest.fn().mockResolvedValue({ data: {}, error: null });

jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({
    emails: { send: sendMock },
  })),
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
        expect.objectContaining({
          from: 'noreply@fincheck.test',
          to: 'user@example.com',
          subject: 'Confirme a alteração do seu e-mail',
          html: expect.stringContaining(
            'http://localhost:3000/users/confirm-email?token=abc-token-123',
          ),
        }),
        { signal: expect.any(AbortSignal) },
      );
    });
  });

  describe('sendWelcome', () => {
    it('sends welcome email containing the user name', async () => {
      await service.sendWelcome('user@example.com', 'Arthur');

      expect(sendMock).toHaveBeenCalledTimes(1);
      expect(sendMock).toHaveBeenCalledWith(
        expect.objectContaining({
          from: 'noreply@fincheck.test',
          to: 'user@example.com',
          subject: 'Bem-vindo ao Fincheck!',
          html: expect.stringContaining('Olá, Arthur!'),
        }),
        { signal: expect.any(AbortSignal) },
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
        expect.objectContaining({
          from: 'noreply@fincheck.test',
          to: 'user@example.com',
          subject: 'Seu plano Fincheck foi alterado',
          html: expect.stringContaining('Olá, Arthur!'),
        }),
        { signal: expect.any(AbortSignal) },
      );
      expect(sendMock).toHaveBeenCalledWith(
        expect.objectContaining({
          html: expect.stringContaining('<strong>FREE</strong>'),
        }),
        { signal: expect.any(AbortSignal) },
      );
    });
  });

  describe('sendSubscriptionCancelled', () => {
    it('sends cancellation email containing the user name', async () => {
      await service.sendSubscriptionCancelled('user@example.com', 'Arthur');

      expect(sendMock).toHaveBeenCalledTimes(1);
      expect(sendMock).toHaveBeenCalledWith(
        expect.objectContaining({
          from: 'noreply@fincheck.test',
          to: 'user@example.com',
          subject: 'Sua assinatura Fincheck foi cancelada',
          html: expect.stringContaining('Olá, Arthur!'),
        }),
        { signal: expect.any(AbortSignal) },
      );
    });
  });

  describe('error handling', () => {
    it('throws when Resend returns an error (so the job fails and retries)', async () => {
      sendMock.mockResolvedValueOnce({
        data: null,
        error: { name: 'application_error', message: 'boom' },
      });

      await expect(
        service.sendWelcome('user@example.com', 'Arthur'),
      ).rejects.toThrow(/Resend failed to send email/);
    });
  });
});
