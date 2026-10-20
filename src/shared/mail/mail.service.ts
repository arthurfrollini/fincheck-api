import { Injectable, Logger } from '@nestjs/common';
import { CreateEmailOptions, Resend } from 'resend';
import { env } from '../config/env';

const RESEND_TIMEOUT_MS = 10000;

// Resend spreads these options into fetch(), so `signal` works at runtime
// even though the SDK's type doesn't declare it.
type SendOptions = NonNullable<Parameters<Resend['emails']['send']>[1]> &
  Pick<RequestInit, 'signal'>;

@Injectable()
export class MailService {
  private resend = new Resend(env.resendApiKey);
  private readonly logger = new Logger(MailService.name);

  private async send(payload: CreateEmailOptions): Promise<void> {
    // Production runs with mail off until Resend has a verified domain:
    // without one, sends to anyone but the account owner fail and would be
    // retried for a day.
    if (process.env.MAIL_ENABLED === 'false') {
      this.logger.log(
        `Mail disabled (MAIL_ENABLED=false): "${payload.subject}" not sent`,
      );
      return;
    }
    // Local dev points every email at one inbox instead of real addresses.
    const to = process.env.MAIL_REDIRECT_TO || payload.to;
    const options: SendOptions = {
      signal: AbortSignal.timeout(RESEND_TIMEOUT_MS),
    };
    const { error } = await this.resend.emails.send(
      { ...payload, to },
      options,
    );

    if (error) {
      // Resend's SDK never throws — it returns { error } (including on our
      // AbortSignal timeout). Throw so the mail-queue worker job fails and
      // BullMQ retries it, instead of silently dropping the email.
      throw new Error(`Resend failed to send email: ${JSON.stringify(error)}`);
    }
  }

  async sendEmailChangeConfirmation(to: string, token: string) {
    const confirmUrl = `http://localhost:3000/users/confirm-email?token=${token}`;

    await this.send({
      from: env.resendFromEmail,
      to,
      subject: 'Confirme a alteração do seu e-mail',
      html: `
        <h1>Solicitação de alteração de e-mail</h1>
        <p>Clique no link abaixo para confirmar a alteração do seu e-mail no Finwise:</p>
        <a href="${confirmUrl}">Confirmar alteração</a>
        <p>O link expira em 1 hora. Se você não solicitou essa alteração, ignore este e-mail.</p>
      `,
    });
  }

  async sendWelcome(to: string, name: string) {
    await this.send({
      from: env.resendFromEmail,
      to,
      subject: 'Bem-vindo ao Finwise!',
      html: `
        <h1>Olá, ${name}!</h1>
        <p>Sua conta foi criada com sucesso. Seja bem-vindo ao Finwise.</p>
        <p>Comece agora a organizar suas finanças.</p>
      `,
    });
  }

  async sendDowngradeNotification(
    to: string,
    name: string,
    newPlan: string,
  ): Promise<void> {
    await this.send({
      from: env.resendFromEmail,
      to,
      subject: 'Seu plano Finwise foi alterado',
      html: `
        <h1>Olá, ${name}!</h1>
        <p>Seu plano foi alterado para <strong>${newPlan}</strong> no início do novo ciclo de cobrança.</p>
        <p>Contas bancárias que excedem o limite do seu novo plano estão agora em modo somente leitura. Acesse o Finwise para verificar quais contas foram afetadas.</p>
        <p>Para reativar todas as contas, faça upgrade do seu plano.</p>
      `,
    });
  }

  async sendSubscriptionCancelled(to: string, name: string): Promise<void> {
    await this.send({
      from: env.resendFromEmail,
      to,
      subject: 'Sua assinatura Finwise foi cancelada',
      html: `
        <h1>Olá, ${name}!</h1>
        <p>Sua assinatura foi cancelada após falha no pagamento. Seu plano voltou para <strong>FREE</strong>.</p>
        <p>Contas bancárias e transações anteriores continuam disponíveis, mas algumas funcionalidades foram limitadas.</p>
        <p>Para reativar, acesse o Finwise e escolha um novo plano.</p>
      `,
    });
  }
}
