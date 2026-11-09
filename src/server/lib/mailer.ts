import nodemailer from "nodemailer";

const SMTP_HOST = process.env.SMTP_HOST || "";
const SMTP_PORT = parseInt(process.env.SMTP_PORT || "587");
const SMTP_USER = process.env.SMTP_USER || "";
const SMTP_PASS = process.env.SMTP_PASS || "";
const SMTP_FROM = process.env.SMTP_FROM || "Collabsuite <no-reply@collabsuite.local>";

const isConfigured = Boolean(SMTP_HOST);

const transporter = isConfigured
  ? nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465,
      auth: SMTP_USER ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
    })
  : null;

if (!isConfigured) {
  console.warn("[mailer] SMTP_HOST não configurado — notificações por e-mail estão desativadas.");
}

export function isMailerConfigured(): boolean {
  return isConfigured;
}

/** Best-effort — a failure here is logged and swallowed, it must never block the
 *  notification's other channels (in-app row, push). */
export async function sendEmail(opts: { to: string; subject: string; html: string }): Promise<boolean> {
  if (!transporter) return false;

  try {
    await transporter.sendMail({
      from: SMTP_FROM,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
    });
    return true;
  } catch (err: any) {
    console.error("[mailer] Falha ao enviar e-mail:", err?.message || err);
    return false;
  }
}
