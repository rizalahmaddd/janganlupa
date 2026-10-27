import type { Env } from "../env";

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export async function sendMail(env: Env, mail: Mail): Promise<void> {
  if (env.EMAIL_PROVIDER === "resend") {
    if (!env.RESEND_API_KEY) throw new Error("RESEND_API_KEY belum di-set");
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ from: env.EMAIL_FROM, to: [mail.to], subject: mail.subject, text: mail.text, html: mail.html }),
    });
    if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return;
  }
  if (env.EMAIL_PROVIDER === "cloudflare") {
    if (!env.EMAIL) throw new Error("Binding EMAIL belum dikonfigurasi");
    await env.EMAIL.send({ to: mail.to, from: env.EMAIL_FROM, subject: mail.subject, text: mail.text, html: mail.html });
    return;
  }
  console.log(`[mail] to=${mail.to} subject=${mail.subject}\n${mail.text}`);
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function layout(env: Env, heading: string, bodyHtml: string): string {
  return `<!doctype html><html><body style="margin:0;background:#f4f2ee;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1d1b18">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" style="max-width:480px;background:#ffffff;border-radius:12px;border:1px solid #e4e0d8" cellpadding="0" cellspacing="0">
<tr><td style="padding:28px 28px 8px;font-size:15px;font-weight:700;color:#0f6b5c">${esc(env.APP_NAME)}</td></tr>
<tr><td style="padding:8px 28px 4px;font-size:20px;font-weight:700">${esc(heading)}</td></tr>
<tr><td style="padding:8px 28px 28px;font-size:15px;line-height:1.55">${bodyHtml}</td></tr>
</table></td></tr></table></body></html>`;
}

export function button(href: string, label: string): string {
  return `<a href="${esc(href)}" style="display:inline-block;background:#0f6b5c;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600">${esc(label)}</a>`;
}

export { esc };
