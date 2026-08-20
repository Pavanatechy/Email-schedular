import nodemailer from 'nodemailer';
import { Sender } from '@prisma/client';

export class SmtpService {
  /**
   * Creates a Nodemailer transporter for the given Sender configuration.
   */
  static createTransporter(sender: Sender) {
    return nodemailer.createTransport({
      host: sender.smtpHost,
      port: sender.smtpPort,
      secure: sender.smtpPort === 465, // true for 465, false for 587 or 25
      auth: {
        user: sender.smtpUser,
        pass: sender.smtpPassword,
      },
      // Timeout configurations to prevent hanging socket connections
      connectionTimeout: 10000,
      socketTimeout: 10000,
    });
  }

  /**
   * Dispatches a single mail merge email using the sender's SMTP transport.
   * Extracts tracking metadata (messageId, previewUrl for Ethereal).
   */
  static async sendEmail(
    sender: Sender,
    to: string,
    subject: string,
    body: string,
    emailId: string
  ): Promise<{ messageId: string; previewUrl?: string }> {
    const transporter = this.createTransporter(sender);
    const deterministicMessageId = `email-${emailId}@email-scheduler.local`;

    const info = await transporter.sendMail({
      from: `"${sender.name}" <${sender.email}>`,
      to,
      subject,
      text: body,
      html: `<div style="font-family: sans-serif; font-size: 15px; color: #1e293b; line-height: 1.6;">${body.replace(/\n/g, '<br>')}</div>`,
      messageId: deterministicMessageId,
    });

    // If Ethereal SMTP is used, retrieve the message preview URL
    const previewUrl = nodemailer.getTestMessageUrl(info) || undefined;

    return {
      messageId: info.messageId || deterministicMessageId,
      previewUrl,
    };
  }
}
