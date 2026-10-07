const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit').rateLimit;

const config = require('./config');
const User = require('./models/User');
const storage = require('./storage');
const mail = require('./mail');
const { issueToken, requireAuth } = require('./auth');

const router = express.Router();

// ------------------------------------------------------------------ helpers

const EMAIL = /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i;
const PHONE = /^[6-9]\d{9}$/;
const GENDERS = ['Female', 'Male', 'Prefer not to say'];
const ALREADY_EMAIL = 'An account with this email already exists. Please Sign In.';
const ALREADY_PHONE = 'An account with this phone number already exists. Please Sign In.';

const normEmail = (v) => String(v || '').trim().toLowerCase();
const normPhone = (v) => String(v || '').replace(/\D/g, '').slice(-10);

function passwordProblem(p) {
  if (typeof p !== 'string' || p.length < 8) return 'Password must be at least 8 characters.';
  if (p.length > 128) return 'Password is too long.';
  if (!/[A-Za-z]/.test(p) || !/\d/.test(p)) return 'Password must contain letters and numbers.';
  return null;
}

/** JPEG or PNG, checked by the file's first bytes (not just its name). */
function isImage(buf) {
  if (!buf || buf.length < 4) return false;
  const jpeg = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  const png = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
  return jpeg || png;
}

const otpHash = (email, code) => crypto.createHmac('sha256', config.jwtSecret).update(`${email}:${code}`).digest('hex');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxFaceBytes, files: 1, fields: 10 },
});

// Rate limits per IP: generous enough for real use, tight enough to stop password guessing.
const limiter = (limit, minutes) =>
  rateLimit({
    windowMs: minutes * 60 * 1000,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Too many requests. Please wait a few minutes and try again.' },
    skip: () => process.env.NODE_ENV === 'test',
  });

// ------------------------------------------------------------------ routes

router.get('/health', (req, res) => res.json({ ok: true, service: 'faceguard-api' }));

/** Sign Up page: is this email / phone already registered? */
router.post('/auth/check', limiter(30, 15), async (req, res) => {
  const email = normEmail(req.body.email);
  const phone = normPhone(req.body.phone);
  const [emailUser, phoneUser] = await Promise.all([
    email ? User.exists({ email }) : null,
    phone ? User.exists({ phone }) : null,
  ]);
  res.json({ emailExists: !!emailUser, phoneExists: !!phoneUser });
});

/** Register Face: profile fields + the face photo (multipart field "faceImage"). */
router.post('/auth/signup', limiter(10, 15), upload.single('faceImage'), async (req, res) => {
  const fullName = String(req.body.fullName || '').trim().replace(/\s+/g, ' ');
  const email = normEmail(req.body.email);
  const phone = normPhone(req.body.phone);
  const gender = String(req.body.gender || '');
  const password = req.body.password;

  const problem =
    fullName.length < 2 || fullName.length > 60 ? 'Please enter your full name.' :
    !PHONE.test(phone) ? 'Enter a valid 10-digit mobile number.' :
    !EMAIL.test(email) ? 'Enter a valid email address.' :
    !GENDERS.includes(gender) ? 'Please select your gender.' :
    passwordProblem(password) ||
    (!req.file ? 'The face photo is missing.' : !isImage(req.file.buffer) ? 'The face photo must be a JPEG or PNG image.' : null);
  if (problem) return res.status(400).json({ error: problem });

  if (await User.exists({ email })) return res.status(409).json({ error: ALREADY_EMAIL, field: 'email' });
  if (await User.exists({ phone })) return res.status(409).json({ error: ALREADY_PHONE, field: 'phone' });

  const passwordHash = await bcrypt.hash(password, 12);
  let user;
  try {
    user = await User.create({ fullName, email, phone, gender, passwordHash });
  } catch (e) {
    if (e && e.code === 11000) {
      const field = Object.keys(e.keyPattern || {})[0] === 'phone' ? 'phone' : 'email';
      return res.status(409).json({ error: field === 'phone' ? ALREADY_PHONE : ALREADY_EMAIL, field });
    }
    throw e;
  }

  try {
    user.face = await storage.upload(req.file.buffer, user._id.toString());
    await user.save();
  } catch (e) {
    console.error('[signup] face upload failed:', e.message);
    await User.deleteOne({ _id: user._id }); // no half-made accounts
    return res.status(502).json({ error: 'Could not save the face photo. Please try again.' });
  }

  res.status(201).json({ message: 'Account created. Please Sign In.', user: user.publicProfile(storage.url(user.face)) });
});

/** Sign In with email (or phone number) + password. Returns a login token and the profile. */
router.post('/auth/login', limiter(20, 15), async (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  if (!username || !password) return res.status(400).json({ error: 'Please enter your username and password.' });

  const query = username.includes('@') ? { email: normEmail(username) } : { phone: normPhone(username) };
  const user = await User.findOne(query);
  // The same message for "no such account" and "wrong password", so accounts can't be probed by password guessing.
  if (!user) return res.status(401).json({ error: 'Incorrect username or password.' });

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    const seconds = Math.ceil((user.lockedUntil - Date.now()) / 1000);
    return res.status(423).json({ error: `Too many failed attempts. Try again in ${seconds} seconds.`, retryAfter: seconds });
  }

  if (!(await bcrypt.compare(password, user.passwordHash))) {
    user.failedLogins += 1;
    let left = config.maxLoginAttempts - user.failedLogins;
    if (left <= 0) {
      user.failedLogins = 0;
      user.lockedUntil = new Date(Date.now() + config.lockSeconds * 1000);
      left = 0;
    }
    await user.save();
    return res.status(401).json({
      error: left > 0
        ? `Incorrect username or password. ${left} attempt${left === 1 ? '' : 's'} left.`
        : `Too many failed attempts. Try again in ${config.lockSeconds} seconds.`,
    });
  }

  user.failedLogins = 0;
  user.lockedUntil = undefined;
  await user.save();
  res.json({ token: issueToken(user), user: user.publicProfile(storage.url(user.face)) });
});

/** Dashboard: the signed-in user's profile with a fresh (1-hour) face photo link. */
router.get('/profile', requireAuth, (req, res) => {
  res.json({ user: req.user.publicProfile(storage.url(req.user.face)) });
});

/** Forgot password, step 1: email a 6-digit code. Always answers the same, so emails can't be probed. */
router.post('/auth/forgot', limiter(5, 15), async (req, res) => {
  const email = normEmail(req.body.email);
  if (!EMAIL.test(email)) return res.status(400).json({ error: 'Enter a valid email address.' });

  const user = await User.findOne({ email });
  if (user) {
    const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
    user.resetOtpHash = otpHash(email, code);
    user.resetOtpExpires = new Date(Date.now() + config.otpMinutes * 60 * 1000);
    user.resetOtpAttempts = 0;
    await user.save();
    try {
      await mail.sendResetCode(email, user.fullName, code);
    } catch (e) {
      console.error('[forgot] email failed:', e.message);
      return res.status(502).json({ error: 'Could not send the email. Please try again later.' });
    }
  }
  res.json({ message: `If ${email} has an account, a 6-digit code has been sent to it.` });
});

/** Forgot password, step 2: code + new password. */
router.post('/auth/reset', limiter(10, 15), async (req, res) => {
  const email = normEmail(req.body.email);
  const code = String(req.body.code || '').trim();
  const problem = passwordProblem(req.body.newPassword);
  if (!/^\d{6}$/.test(code)) return res.status(400).json({ error: 'Enter the 6-digit code from the email.' });
  if (problem) return res.status(400).json({ error: problem });

  const user = await User.findOne({ email });
  const invalid = () => res.status(400).json({ error: 'The code is wrong or has expired. Request a new one.' });
  if (!user || !user.resetOtpHash || !user.resetOtpExpires || user.resetOtpExpires < new Date()) return invalid();

  if (user.resetOtpAttempts >= config.maxOtpAttempts) return invalid();
  const ok = crypto.timingSafeEqual(Buffer.from(user.resetOtpHash, 'hex'), Buffer.from(otpHash(email, code), 'hex'));
  if (!ok) {
    user.resetOtpAttempts += 1;
    await user.save();
    return invalid();
  }

  user.passwordHash = await bcrypt.hash(req.body.newPassword, 12);
  user.resetOtpHash = undefined;
  user.resetOtpExpires = undefined;
  user.resetOtpAttempts = 0;
  user.failedLogins = 0;
  user.lockedUntil = undefined;
  user.tokenVersion += 1; // sign out every device that used the old password
  await user.save();
  res.json({ message: 'Password changed. Please Sign In with your new password.' });
});

module.exports = router;
