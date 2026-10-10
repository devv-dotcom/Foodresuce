'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const nodemailer = require('nodemailer');

const mailPath = require.resolve('../utils/mail');
const controllerPath = require.resolve('../controllers/authController');
const nodemailerPath = require.resolve('nodemailer');
const mailEnvKeys = [
  'NODE_ENV', 'RESEND_API_KEY', 'BREVO_API_KEY', 'MAIL_FROM', 'MAIL_USER',
  'MAIL_PASSWORD', 'MAIL_HOST', 'MAIL_PORT', 'MAIL_SECURE'
];

async function withEnvironment(values, callback) {
  const previous = Object.fromEntries(mailEnvKeys.map(key => [key, process.env[key]]));
  for (const key of mailEnvKeys) {
    if (Object.hasOwn(values, key)) process.env[key] = values[key];
    else delete process.env[key];
  }
  try { return await callback(); }
  finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function loadMailerWithTransport(transport) {
  const priorNodemailer = require.cache[nodemailerPath];
  const priorMail = require.cache[mailPath];
  const sent = [];
  const delivered = [];
  const configurations = [];
  require.cache[nodemailerPath] = {
    id: nodemailerPath,
    filename: nodemailerPath,
    loaded: true,
    exports: {
      createTransport(options) {
        configurations.push(options);
        return {
          sendMail: async message => {
            sent.push(message);
            const result = await transport(message);
            delivered.push(result);
            return result;
          }
        };
      }
    }
  };
  delete require.cache[mailPath];
  const mail = require('../utils/mail');
  return {
    mail,
    sent,
    delivered,
    configurations,
    restore() {
      delete require.cache[mailPath];
      if (priorMail) require.cache[mailPath] = priorMail;
      delete require.cache[nodemailerPath];
      if (priorNodemailer) require.cache[nodemailerPath] = priorNodemailer;
    }
  };
}

function responseHarness() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

test('SMTP fallback sends login and reset OTP messages through Nodemailer', async () => {
  await withEnvironment({
    NODE_ENV: 'development', MAIL_HOST: 'smtp.example.test', MAIL_PORT: '587',
    MAIL_USER: 'sender@example.test', MAIL_PASSWORD: 'test-only-password',
    MAIL_FROM: 'Food Rescue <sender@example.test>'
  }, async () => {
    // Exercise the real installed Nodemailer message composer and sendMail API
    // without opening a socket or contacting an SMTP provider.
    const jsonTransport = nodemailer.createTransport({ jsonTransport: true });
    const harness = loadMailerWithTransport(message => jsonTransport.sendMail(message));
    try {
      await harness.mail.sendLoginOtp({ email: 'recipient@example.test', fullName: 'Recipient', otp: '123456' });
      await harness.mail.sendPasswordOtp({ email: 'recipient@example.test', fullName: 'Recipient', otp: '654321' });

      assert.equal(harness.configurations.length, 1);
      assert.deepEqual(harness.configurations[0], {
        host: 'smtp.example.test', port: 587, secure: false,
        auth: { user: 'sender@example.test', pass: 'test-only-password' }
      });
      assert.equal(harness.sent.length, 2);
      assert.equal(harness.sent[0].to, 'recipient@example.test');
      assert.match(harness.sent[0].text, /123456/);
      assert.match(harness.sent[0].subject, /sign-in code/);
      assert.equal(harness.sent[1].to, 'recipient@example.test');
      assert.match(harness.sent[1].text, /654321/);
      assert.match(harness.sent[1].subject, /password reset code/);
      assert.equal(harness.delivered.length, 2);
      assert.deepEqual(harness.delivered[0].envelope, {
        from: 'sender@example.test', to: ['recipient@example.test']
      });
      assert.deepEqual(harness.delivered[1].envelope, {
        from: 'sender@example.test', to: ['recipient@example.test']
      });
    } finally { harness.restore(); }
  });
});

test('Nodemailer parses display-name sender and recipient addresses', async () => {
  const transporter = nodemailer.createTransport({ jsonTransport: true });
  const result = await transporter.sendMail({
    from: 'Food Rescue <rescue@example.test>',
    to: 'Recipient NGO <ngo@example.test>',
    subject: 'Food Rescue code',
    text: 'One time code'
  });

  assert.deepEqual(result.envelope, { from: 'rescue@example.test', to: ['ngo@example.test'] });
  const message = JSON.parse(result.message.toString());
  assert.deepEqual(message.from, { address: 'rescue@example.test', name: 'Food Rescue' });
  assert.deepEqual(message.to, [{ address: 'ngo@example.test', name: 'Recipient NGO' }]);
});

test('Resend production adapter sends login OTP with its API payload', async () => {
  await withEnvironment({
    NODE_ENV: 'production', RESEND_API_KEY: 'resend-test-key',
    BREVO_API_KEY: 'brevo-test-key', MAIL_FROM: 'Food Rescue <rescue@example.test>'
  }, async () => {
    const originalFetch = global.fetch;
    const requests = [];
    global.fetch = async (url, options) => {
      requests.push({ url, options });
      return { ok: true, status: 200 };
    };
    const harness = loadMailerWithTransport(async () => { throw new Error('SMTP fallback should not run'); });
    try {
      await harness.mail.sendLoginOtp({ email: 'ngo@example.test', fullName: 'NGO', otp: '123456' });
      assert.equal(requests.length, 1);
      assert.equal(requests[0].url, 'https://api.resend.com/emails');
      assert.equal(requests[0].options.method, 'POST');
      assert.equal(requests[0].options.headers.authorization, 'Bearer resend-test-key');
      const body = JSON.parse(requests[0].options.body);
      assert.equal(body.from, 'Food Rescue <rescue@example.test>');
      assert.deepEqual(body.to, ['ngo@example.test']);
      assert.match(body.text, /123456/);
    } finally {
      harness.restore();
      global.fetch = originalFetch;
    }
  });
});

test('Brevo production adapter parses sender and sends password reset OTP', async () => {
  await withEnvironment({
    NODE_ENV: 'production', BREVO_API_KEY: 'brevo-test-key',
    MAIL_FROM: 'Food Rescue <rescue@example.test>'
  }, async () => {
    const originalFetch = global.fetch;
    const requests = [];
    global.fetch = async (url, options) => {
      requests.push({ url, options });
      return { ok: true, status: 200 };
    };
    const harness = loadMailerWithTransport(async () => { throw new Error('SMTP fallback should not run'); });
    try {
      await harness.mail.sendPasswordOtp({ email: 'donor@example.test', fullName: 'Donor', otp: '654321' });
      assert.equal(requests.length, 1);
      assert.equal(requests[0].url, 'https://api.brevo.com/v3/smtp/email');
      assert.equal(requests[0].options.method, 'POST');
      assert.equal(requests[0].options.headers['api-key'], 'brevo-test-key');
      const body = JSON.parse(requests[0].options.body);
      assert.deepEqual(body.sender, { name: 'Food Rescue', email: 'rescue@example.test' });
      assert.deepEqual(body.to, [{ email: 'donor@example.test' }]);
      assert.match(body.textContent, /654321/);
    } finally {
      harness.restore();
      global.fetch = originalFetch;
    }
  });
});

test('forgot-password OTP is delivered, verified, and consumed by the reset flow', async () => {
  const User = require('../models/User');
  const originalUserMethods = {
    findByEmail: User.findByEmail,
    saveOtp: User.saveOtp,
    consumeOtpAndUpdatePassword: User.consumeOtpAndUpdatePassword
  };
  const previousSecret = process.env.JWT_SECRET;
  const priorMail = require.cache[mailPath];
  const priorController = require.cache[controllerPath];
  const deliveries = [];
  let savedOtpHash;
  let otpExpiresAt;
  let passwordResetConsumed = false;
  const mockMail = {
    sendPasswordOtp: async message => { deliveries.push(message); },
    sendLoginOtp: async message => { deliveries.push(message); }
  };
  require.cache[mailPath] = { id: mailPath, filename: mailPath, loaded: true, exports: mockMail };
  delete require.cache[controllerPath];
  const controller = require('../controllers/authController');
  process.env.JWT_SECRET = 'mail-delivery-reset-test-secret';
  User.findByEmail = async email => ({
    id: 73, email, full_name: 'Food Rescue User', otp: savedOtpHash,
    otp_expires_at: otpExpiresAt
  });
  User.saveOtp = async (email, hash, expiresAt) => {
    assert.equal(email, 'donor@example.test');
    savedOtpHash = hash;
    otpExpiresAt = expiresAt;
  };
  User.consumeOtpAndUpdatePassword = async (userId, hash, passwordHash) => {
    assert.equal(userId, 73);
    assert.equal(hash, savedOtpHash);
    assert.match(passwordHash, /^\$2[aby]\$/);
    passwordResetConsumed = true;
    return true;
  };
  try {
    const forgot = responseHarness();
    await controller.forgotPassword({ body: { email: 'donor@example.test' } }, forgot, error => { throw error; });
    assert.equal(forgot.statusCode, 200);
    assert.equal(deliveries.length, 1);
    assert.equal(deliveries[0].email, 'donor@example.test');
    assert.match(deliveries[0].otp, /^\d{6}$/);
    assert.equal(savedOtpHash, crypto.createHash('sha256').update(deliveries[0].otp).digest('hex'));

    const verify = responseHarness();
    await controller.verifyOtp({ body: { email: 'donor@example.test', otp: deliveries[0].otp } }, verify, error => { throw error; });
    assert.equal(verify.statusCode, 200);
    assert.equal(typeof verify.body.resetToken, 'string');

    const reset = responseHarness();
    await controller.resetPassword({ body: { resetToken: verify.body.resetToken, newPassword: 'new-secure-test-password' } }, reset, error => { throw error; });
    assert.equal(reset.statusCode, 200);
    assert.equal(passwordResetConsumed, true);
  } finally {
    Object.assign(User, originalUserMethods);
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
    delete require.cache[controllerPath];
    if (priorController) require.cache[controllerPath] = priorController;
    delete require.cache[mailPath];
    if (priorMail) require.cache[mailPath] = priorMail;
  }
});
