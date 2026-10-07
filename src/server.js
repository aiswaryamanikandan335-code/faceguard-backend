const mongoose = require('mongoose');
const config = require('./config');
const { createApp } = require('./app');

async function main() {
  if (!config.mongoUri) throw new Error('Missing setting MONGODB_URI. Copy .env.example to .env and fill it in.');
  await mongoose.connect(config.mongoUri);
  console.log('[db] connected to MongoDB');

  createApp().listen(config.port, '0.0.0.0', () => {
    console.log(`[api] FaceGuard API listening on port ${config.port}`);
    console.log(`[api] storage: ${config.storageDriver}, mail: ${config.mailDriver}`);
  });
}

main().catch((e) => {
  console.error('[startup]', e.message);
  process.exit(1);
});
