import { Injectable } from '@nestjs/common';
import { Resend } from 'resend';
import { env } from '../config/env';

const RESEND_TIMEOUT_MS = 10000;

@Injectable()
export class MailService {
  private resend = new Resend(env.resendApiKey);

  async sendEmailChangeConfirmation(to: string, token: string) {
    const confirmUrl = `http://localhost:3000/users/confirm-email?token=${token}`;

    await (this.resend.emails.send as any)(
      {
        from: env.resendFromEmail,
        to,
        subject: 'Confirme a alteração do seu e-mail',
        html: `
        <h1>Solicitação de alteração de e-mail</h1>
        <p>Clique no link abaixo para confirmar a alteração do seu e-mail no Fincheck:</p>
        <a href="${confirmUrl}">Confirmar alteração</a>
        <p>O link expira em 1 hora. Se você não solicitou essa alteração, ignore este e-mail.</p>
      `,
      },
      { signal: AbortSignal.timeout(RESEND_TIMEOUT_MS) },
    );
  }

  async sendWelcome(to: string, name: string) {
    await (this.resend.emails.send as any)(
      {
        from: env.resendFromEmail,
        to,
        subject: 'Bem-vindo ao Fincheck!',
        html: `
        <h1>Olá, ${name}!</h1>
        <p>Sua conta foi criada com sucesso. Seja bem-vindo ao Fincheck.</p>
        <p>Comece agora a organizar suas finanças.</p>
      `,
      },
      { signal: AbortSignal.timeout(RESEND_TIMEOUT_MS) },
    );
  }

  async sendDowngradeNotification(
    to: string,
    name: string,
    newPlan: string,
  ): Promise<void> {
    await (this.resend.emails.send as any)(
      {
        from: env.resendFromEmail,
        to,
        subject: 'Seu plano Fincheck foi alterado',
        html: `
        <h1>Olá, ${name}!</h1>
        <p>Seu plano foi alterado para <strong>${newPlan}</strong> no início do novo ciclo de cobrança.</p>
        <p>Contas bancárias que excedem o limite do seu novo plano estão agora em modo somente leitura. Acesse o Fincheck para verificar quais contas foram afetadas.</p>
        <p>Para reativar todas as contas, faça upgrade do seu plano.</p>
      `,
      },
      { signal: AbortSignal.timeout(RESEND_TIMEOUT_MS) },
    );
  }

  async sendSubscriptionCancelled(to: string, name: string): Promise<void> {
    await (this.resend.emails.send as any)(
      {
        from: env.resendFromEmail,
        to,
        subject: 'Sua assinatura Fincheck foi cancelada',
        html: `
        <h1>Olá, ${name}!</h1>
        <p>Sua assinatura foi cancelada após falha no pagamento. Seu plano voltou para <strong>FREE</strong>.</p>
        <p>Contas bancárias e transações anteriores continuam disponíveis, mas algumas funcionalidades foram limitadas.</p>
        <p>Para reativar, acesse o Fincheck e escolha um novo plano.</p>
      `,
      },
      { signal: AbortSignal.timeout(RESEND_TIMEOUT_MS) },
    );
  }
}
