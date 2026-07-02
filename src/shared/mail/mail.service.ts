import { Injectable } from '@nestjs/common';
import { Resend } from 'resend';
import { env } from '../config/env';

@Injectable()
export class MailService {
  private resend = new Resend(env.resendApiKey);

  async sendEmailChangeConfirmation(to: string, token: string) {
    const confirmUrl = `http://localhost:3000/users/confirm-email?token=${token}`;

    await this.resend.emails.send({
      from: env.resendFromEmail,
      to,
      subject: 'Confirme a alteração do seu e-mail',
      html: `
        <h1>Solicitação de alteração de e-mail</h1>
        <p>Clique no link abaixo para confirmar a alteração do seu e-mail no Fincheck:</p>
        <a href="${confirmUrl}">Confirmar alteração</a>
        <p>O link expira em 1 hora. Se você não solicitou essa alteração, ignore este e-mail.</p>
      `,
    });
  }

  async sendWelcome(to: string, name: string) {
    await this.resend.emails.send({
      from: env.resendFromEmail,
      to,
      subject: 'Bem-vindo ao Fincheck!',
      html: `
        <h1>Olá, ${name}!</h1>
        <p>Sua conta foi criada com sucesso. Seja bem-vindo ao Fincheck.</p>
        <p>Comece agora a organizar suas finanças.</p>
      `,
    });
  }
}
