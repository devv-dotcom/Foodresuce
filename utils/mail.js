const nodemailer = require('nodemailer');

// Prefer Resend when configured. Both providers use HTTPS so they work on
// hosts that block outbound SMTP, including Render's free web services.
const usingResend = Boolean(process.env.RESEND_API_KEY);
const usingBrevo = !usingResend && Boolean(process.env.BREVO_API_KEY);

// Resend requires MAIL_FROM to belong to a domain verified in its dashboard.
// Brevo also validates the sender; Gmail normalization applies to SMTP only.
const fromAddress = usingResend
  ? process.env.MAIL_FROM
  : usingBrevo
    ? (process.env.MAIL_FROM || process.env.MAIL_USER)
    : (process.env.MAIL_HOST?.toLowerCase() === 'smtp.gmail.com' && process.env.MAIL_USER
      ? `Food Rescue <${process.env.MAIL_USER}>`
      : (process.env.MAIL_FROM || process.env.MAIL_USER));

const transporter = nodemailer.createTransport({
  host: process.env.MAIL_HOST,
  port: Number(process.env.MAIL_PORT || 587),
  secure: process.env.MAIL_SECURE === 'true',
  auth: { user: process.env.MAIL_USER, pass: process.env.MAIL_PASSWORD }
});

const senderValue = String(fromAddress || '').trim();
const senderMatch = senderValue.match(/^(.*?)\s*<([^>]+)>$/);
const looseEmailMatch = senderValue.match(/([\w.+-]+@[\w.-]+\.[A-Za-z]{2,})/);
const brevoSender = senderMatch
  ? { name: senderMatch[1].trim(), email: senderMatch[2].trim() }
  : looseEmailMatch
    ? { name: senderValue.replace(looseEmailMatch[1], '').trim(), email: looseEmailMatch[1] }
    : { email: senderValue };

async function deliver(message) {
  if (usingResend) {
    if (!fromAddress) {
      const error = new Error('MAIL_FROM must be set to an address on a verified Resend domain.');
      error.code = 'RESEND_MAIL_FROM_MISSING';
      throw error;
    }

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        from: fromAddress,
        to: [message.to],
        subject: message.subject,
        text: message.text,
        html: message.html
      })
    });

    if (!response.ok) {
      let detail = '';
      try {
        const body = await response.json();
        detail = body.message || body.error || body.name || '';
      } catch (_) { /* Keep provider errors bounded and safe for logs. */ }
      const error = new Error(`Resend email request failed (${response.status}): ${detail}`);
      error.code = `RESEND_HTTP_${response.status}`;
      error.statusCode = response.status;
      error.provider = 'resend';
      throw error;
    }
    return;
  }

  if (!usingBrevo) {
    if (process.env.NODE_ENV !== 'production') return transporter.sendMail(message);
    const error = new Error('No transactional email API key is configured for this host.');
    error.code = 'EMAIL_PROVIDER_MISSING';
    throw error;
  }

  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'api-key': process.env.BREVO_API_KEY,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      sender: brevoSender,
      to: [{ email: message.to }],
      subject: message.subject,
      textContent: message.text,
      htmlContent: message.html
    })
  });

  if (!response.ok) {
    const detail = await response.text();
    const error = new Error(`Brevo email request failed (${response.status}): ${detail}`);
    error.code = `BREVO_HTTP_${response.status}`;
    error.statusCode = response.status;
    throw error;
  }
}

async function sendPasswordOtp({ email, fullName, otp }) {
  await deliver({
    from: fromAddress,
    to: email,
    subject: 'Your Food Rescue password reset code',
    text: `Hello ${fullName}, your Food Rescue password reset code is ${otp}. It expires in 10 minutes.`,
    html: `<p>Hello ${fullName},</p><p>Your Food Rescue password reset code is:</p><h1 style="letter-spacing:6px">${otp}</h1><p>This code expires in 10 minutes. If you did not request this, you can ignore this email.</p>`
  });
}

async function sendLoginOtp({ email, fullName, otp }) {
  await deliver({
    from: fromAddress,
    to: email,
    subject: 'Your Food Rescue sign-in code',
    text: `Hello ${fullName}, your Food Rescue sign-in code is ${otp}. It expires in 10 minutes. If you did not try to sign in, you can ignore this email.`,
    html: `<p>Hello ${fullName},</p><p>Your Food Rescue sign-in code is:</p><h1 style="letter-spacing:6px">${otp}</h1><p>This code expires in 10 minutes. If you did not try to sign in, you can ignore this email.</p>`
  });
}

module.exports = { sendPasswordOtp, sendLoginOtp };
