// Runs the real API against a throw-away MongoDB, with in-memory photo storage and console email.
process.env.NODE_ENV = 'test';
process.env.STORAGE_DRIVER = 'memory';
process.env.MAIL_DRIVER = 'console';
process.env.JWT_SECRET = 'test-secret-that-is-long-enough-1234567890';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const { createApp } = require('../src/app');
const storage = require('../src/storage');
const mail = require('../src/mail');
const User = require('../src/models/User');

let mongo, app;
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]);

before(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await User.init(); // build the unique indexes
  app = createApp();
});

after(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

const signup = (fields = {}, photo = JPEG) => {
  const f = { fullName: 'Aiswarya', email: 'aiswarya@gmail.com', phone: '9876543210', gender: 'Female', password: 'secret123', ...fields };
  let r = request(app).post('/api/auth/signup');
  for (const [k, v] of Object.entries(f)) r = r.field(k, v);
  return photo ? r.attach('faceImage', photo, { filename: 'face.jpg', contentType: 'image/jpeg' }) : r;
};

test('health', async () => {
  const r = await request(app).get('/api/health');
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
});

test('sign up saves the profile in MongoDB and the photo in storage, never the password', async () => {
  const r = await signup();
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const u = await User.findOne({ email: 'aiswarya@gmail.com' }).lean();
  assert.equal(u.fullName, 'Aiswarya');
  assert.equal(u.phone, '9876543210');
  assert.equal(u.gender, 'Female');
  assert.ok(u.createdAt instanceof Date);
  assert.notEqual(u.passwordHash, 'secret123');
  assert.match(u.passwordHash, /^\$2[aby]\$12\$/);
  assert.equal(u.face.publicId, `faceguard/faces/${u._id}`);
  assert.ok(storage.files.has(u.face.publicId));
  assert.equal(r.body.user.passwordHash, undefined);
});

test('duplicate email and phone are refused with "already exists"', async () => {
  const sameEmail = await signup({ phone: '9123456780' });
  assert.equal(sameEmail.status, 409);
  assert.match(sameEmail.body.error, /email already exists/);
  const samePhone = await signup({ email: 'other@gmail.com' });
  assert.equal(samePhone.status, 409);
  assert.match(samePhone.body.error, /phone number already exists/);

  const check = await request(app).post('/api/auth/check').send({ email: 'AISWARYA@gmail.com', phone: '9000000000' });
  assert.deepEqual(check.body, { emailExists: true, phoneExists: false });
});

test('sign up rejects bad input and non-image files', async () => {
  assert.equal((await signup({ email: 'x@y.com', phone: '9111111111', password: 'short' })).status, 400);
  assert.equal((await signup({ email: 'x@y.com', phone: '1234567890' })).status, 400);
  assert.equal((await signup({ email: 'x@y.com', phone: '9111111111', gender: 'Robot' })).status, 400);
  assert.equal((await signup({ email: 'x@y.com', phone: '9111111111' }, null)).status, 400);
  const notImage = await signup({ email: 'x@y.com', phone: '9111111111' }, Buffer.from('not a picture'));
  assert.equal(notImage.status, 400);
  assert.match(notImage.body.error, /JPEG or PNG/);
  assert.equal(await User.exists({ email: 'x@y.com' }), null);
});

test('login by email or phone returns a token; profile needs that token', async () => {
  const byEmail = await request(app).post('/api/auth/login').send({ username: 'Aiswarya@Gmail.com', password: 'secret123' });
  assert.equal(byEmail.status, 200, JSON.stringify(byEmail.body));
  assert.ok(byEmail.body.token);
  assert.equal(byEmail.body.user.phone, '9876543210');

  const byPhone = await request(app).post('/api/auth/login').send({ username: '+91 98765 43210', password: 'secret123' });
  assert.equal(byPhone.status, 200);

  assert.equal((await request(app).get('/api/profile')).status, 401);
  const p = await request(app).get('/api/profile').set('Authorization', `Bearer ${byEmail.body.token}`);
  assert.equal(p.status, 200);
  assert.equal(p.body.user.fullName, 'Aiswarya');
  assert.equal(p.body.user.gender, 'Female');
  assert.match(p.body.user.faceUrl, /^memory:\/\/faceguard\/faces\//);
});

test('wrong password: same message as unknown user, then a lock after 5 tries', async () => {
  const unknown = await request(app).post('/api/auth/login').send({ username: 'nobody@gmail.com', password: 'secret123' });
  assert.equal(unknown.status, 401);
  assert.match(unknown.body.error, /Incorrect username or password/);

  for (let i = 1; i <= 4; i++) {
    const r = await request(app).post('/api/auth/login').send({ username: 'aiswarya@gmail.com', password: 'wrong999' });
    assert.match(r.body.error, new RegExp(`${5 - i} attempt`));
  }
  const fifth = await request(app).post('/api/auth/login').send({ username: 'aiswarya@gmail.com', password: 'wrong999' });
  assert.match(fifth.body.error, /Too many failed attempts/);
  const locked = await request(app).post('/api/auth/login').send({ username: 'aiswarya@gmail.com', password: 'secret123' });
  assert.equal(locked.status, 423);
  await User.updateOne({ email: 'aiswarya@gmail.com' }, { $unset: { lockedUntil: 1 } });
});

test('forgot password: 6-digit code by email, wrong code refused, reset signs out old tokens', async () => {
  const login = await request(app).post('/api/auth/login').send({ username: 'aiswarya@gmail.com', password: 'secret123' });
  const oldToken = login.body.token;

  const unknown = await request(app).post('/api/auth/forgot').send({ email: 'nobody@gmail.com' });
  const known = await request(app).post('/api/auth/forgot').send({ email: 'aiswarya@gmail.com' });
  assert.equal(unknown.status, 200);
  assert.equal(known.status, 200);
  assert.equal(unknown.body.message.replace('nobody', 'X'), known.body.message.replace('aiswarya', 'X')); // can't tell them apart

  const code = mail.sent.at(-1).code;
  assert.match(code, /^\d{6}$/);
  const stored = await User.findOne({ email: 'aiswarya@gmail.com' }).lean();
  assert.notEqual(stored.resetOtpHash, code); // only a hash is stored

  const wrong = code === '000000' ? '111111' : '000000';
  const bad = await request(app).post('/api/auth/reset').send({ email: 'aiswarya@gmail.com', code: wrong, newPassword: 'newpass123' });
  assert.equal(bad.status, 400);

  const good = await request(app).post('/api/auth/reset').send({ email: 'aiswarya@gmail.com', code, newPassword: 'newpass123' });
  assert.equal(good.status, 200, JSON.stringify(good.body));
  const reuse = await request(app).post('/api/auth/reset').send({ email: 'aiswarya@gmail.com', code, newPassword: 'another123' });
  assert.equal(reuse.status, 400); // a code works once

  assert.equal((await request(app).get('/api/profile').set('Authorization', `Bearer ${oldToken}`)).status, 401);
  assert.equal((await request(app).post('/api/auth/login').send({ username: 'aiswarya@gmail.com', password: 'secret123' })).status, 401);
  assert.equal((await request(app).post('/api/auth/login').send({ username: 'aiswarya@gmail.com', password: 'newpass123' })).status, 200);
});

test('too many wrong codes kills the code', async () => {
  await request(app).post('/api/auth/forgot').send({ email: 'aiswarya@gmail.com' });
  const code = mail.sent.at(-1).code;
  const wrong = code === '000000' ? '111111' : '000000';
  for (let i = 0; i < 5; i++)
    await request(app).post('/api/auth/reset').send({ email: 'aiswarya@gmail.com', code: wrong, newPassword: 'newpass456' });
  const late = await request(app).post('/api/auth/reset').send({ email: 'aiswarya@gmail.com', code, newPassword: 'newpass456' });
  assert.equal(late.status, 400);
});
