// Reads settings from environment variables (a .env file locally, the host's settings in production).
require('dotenv').config({ quiet: true });

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing setting ${name}. Copy .env.example to .env and fill it in.`);
  return value;
}

const storageDriver = process.env.STORAGE_DRIVER || 'cloudinary'; // 'memory' only for tests
const mailDriver = process.env.MAIL_DRIVER || (process.env.SMTP_USER ? 'smtp' : 'console');

const config = {
  port: Number(process.env.PORT || 3000),
  mongoUri: process.env.MONGODB_URI || '',
  jwtSecret: required('JWT_SECRET'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  storageDriver,
  cloudinary: storageDriver === 'cloudinary'
    ? {
        cloudName: required('CLOUDINARY_CLOUD_NAME'),
        apiKey: required('CLOUDINARY_API_KEY'),
        apiSecret: required('CLOUDINARY_API_SECRET'),
        folder: process.env.CLOUDINARY_FOLDER || 'faceguard/faces',
      }
    : null,
  mailDriver,
  smtp: mailDriver === 'smtp'
    ? {
        host: process.env.SMTP_HOST || 'smtp.gmail.com',
        port: Number(process.env.SMTP_PORT || 465),
        user: required('SMTP_USER'),
        pass: required('SMTP_PASS'),
        from: process.env.MAIL_FROM || `FaceGuard <${process.env.SMTP_USER}>`,
      }
    : null,
  faceUrlSeconds: 60 * 60,          // face photo links expire after 1 hour
  maxFaceBytes: 2 * 1024 * 1024,    // 2 MB
  maxLoginAttempts: 5,
  lockSeconds: 30,
  otpMinutes: 10,
  maxOtpAttempts: 5,
};

if (config.jwtSecret.length < 32) throw new Error('JWT_SECRET must be at least 32 characters long.');

module.exports = config;
