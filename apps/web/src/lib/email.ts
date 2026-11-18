import { Resend } from "resend";
import { env } from "@workspace/env/server";
import { Logger } from "@workspace/logger";

const logger = new Logger("EmailService");

const resend = env.RESEND_API_KEY ? new Resend(env.RESEND_API_KEY) : null;

type SendVerificationEmailParams = {
  email: string;
  verificationUrl: string;
};

/**
 * Resolves the "From" address for Resend.
 * Resend free tier/test accounts reject unverified domains (such as @gmail.com)
 * with a 403 error, requiring either `onboarding@resend.dev` or a custom verified domain.
 */
function resolveFromEmail(): string {
  const configured = env.NEWSLETTER_FROM_EMAIL?.trim();
  if (!configured || configured.toLowerCase().endsWith("@gmail.com")) {
    return "onboarding@resend.dev";
  }
  return configured;
}

export async function sendVerificationEmail({
  email,
  verificationUrl,
}: SendVerificationEmailParams) {
  if (!resend) {
    logger.warn("RESEND_API_KEY not configured. Verification email delivery skipped (simulated).", {
      email,
      verificationUrl,
    });
    return { id: "simulated" };
  }

  const fromEmail = resolveFromEmail();

  try {
    const { data, error } = await resend.emails.send({
      from: `Newsletter <${fromEmail}>`,
      to: [email],
      subject: "Confirm your newsletter subscription",
      html: getVerificationEmailHtml(verificationUrl),
      text: getVerificationEmailText(verificationUrl),
    });

    if (error) {
      logger.error("Resend email delivery failed", {
        error: error.message,
        name: error.name,
        email,
      });
      throw new Error(`Email delivery failed: ${error.message}`);
    }

    logger.info("Verification email sent successfully", {
      email,
      messageId: data?.id,
    });

    return data;
  } catch (error) {
    logger.error("Failed to send verification email", {
      error: error instanceof Error ? error.message : "Unknown error",
      email,
    });
    throw error;
  }
}

function getVerificationEmailHtml(url: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Confirm your subscription</title>
</head>
<body style="
  margin: 0;
  padding: 0;
  background-color: #f4f5f7;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
">
  <table width="100%" cellpadding="0" cellspacing="0"
    role="presentation" style="padding: 40px 16px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0"
          role="presentation"
          style="
            max-width: 560px;
            background: #ffffff;
            border-radius: 12px;
            overflow: hidden;
            box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -2px rgba(0, 0, 0, 0.1);
          ">

          <tr>
            <td style="padding: 32px 36px 20px; text-align: center; border-bottom: 1px solid #f0f0f0;">
              <h2 style="
                margin: 0;
                color: #111827;
                font-size: 20px;
                font-weight: 700;
                letter-spacing: -0.02em;
              ">
                Roboto Newsletter
              </h2>
            </td>
          </tr>

          <tr>
            <td style="padding: 32px 36px 36px;">
              <h1 style="
                color: #111827;
                font-size: 24px;
                line-height: 1.3;
                margin: 0 0 16px;
                font-weight: 600;
              ">
                Confirm your subscription
              </h1>

              <p style="
                color: #4b5563;
                font-size: 15px;
                line-height: 1.7;
                margin: 0 0 16px;
              ">
                Hello,
              </p>

              <p style="
                color: #4b5563;
                font-size: 15px;
                line-height: 1.7;
                margin: 0 0 28px;
              ">
                Thanks for subscribing to our newsletter! Please click the button below to confirm your email address and activate your subscription.
              </p>

              <table role="presentation" cellpadding="0"
                cellspacing="0" style="margin: 28px 0;">
                <tr>
                  <td align="center" bgcolor="#111827"
                    style="border-radius: 8px;">
                    <a href="${url}" style="
                      display: inline-block;
                      padding: 14px 28px;
                      color: #ffffff;
                      font-size: 15px;
                      font-weight: 600;
                      text-decoration: none;
                      border-radius: 8px;
                    ">
                      Confirm my email address
                    </a>
                  </td>
                </tr>
              </table>

              <p style="
                color: #6b7280;
                font-size: 13px;
                line-height: 1.6;
                margin: 28px 0 8px;
              ">
                This verification link expires in <strong>15 minutes</strong>. If the button doesn't work, copy and paste this URL into your browser:
              </p>

              <p style="
                color: #2563eb;
                font-size: 12px;
                line-height: 1.6;
                word-break: break-all;
                margin: 0 0 24px;
              ">
                <a href="${url}" style="color: #2563eb; text-decoration: underline;">${url}</a>
              </p>

              <p style="
                color: #9ca3af;
                font-size: 12px;
                line-height: 1.5;
                margin: 24px 0 0;
                border-top: 1px solid #f3f4f6;
                padding-top: 16px;
              ">
                If you didn't request this subscription, you can safely ignore this email. No subscription will be activated without confirmation.
              </p>
            </td>
          </tr>

          <tr>
            <td style="
              background: #f9fafb;
              padding: 20px 36px;
              text-align: center;
              border-top: 1px solid #f0f0f0;
            ">
              <p style="
                color: #9ca3af;
                font-size: 12px;
                margin: 0;
              ">
                © ${new Date().getFullYear()} Roboto. All rights reserved.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function getVerificationEmailText(url: string): string {
  return `Confirm your newsletter subscription

Hello,

Thanks for signing up for the Roboto newsletter! Please confirm your email address by opening the following link in your browser:

${url}

This verification link expires in 15 minutes.

If you didn't request this subscription, you can safely ignore this email.

— Roboto Team
`;
}
