const mongoose = require('mongoose');
const config = require('./config');
const { createApp } = require('./app');
const User = require('./models/User');
const storage = require('./storage');
const face = require('./face');

/** Accounts made before "Sign in with Face" existed: work out their face descriptor from the stored photo. */
async function addMissingFaceDescriptors() {
  const users = await User.find({ 'face.publicId': { $exists: true }, 'faceDescriptor.0': { $exists: false } });
  for (const user of users) {
    try {
      const res = await fetch(storage.url(user.face), { signal: AbortSignal.timeout(20000) });
      if (!res.ok) throw new Error(`photo download ${res.status}`);
      const descriptor = await face.describe(Buffer.from(await res.arrayBuffer()));
      if (!descriptor) {
        console.log(`[face] no face found in the photo of ${user._id}; face sign-in stays off for this account`);
        continue;
      }
      await User.updateOne({ _id: user._id }, { $set: { faceDescriptor: descriptor } });
      console.log(`[face] face sign-in enabled for ${user._id}`);
    } catch (e) {
      console.error(`[face] could not prepare ${user._id}:`, e.message);
    }
  }
}

async function main() {
  if (!config.mongoUri) throw new Error('Missing setting MONGODB_URI. Copy .env.example to .env and fill it in.');
  await mongoose.connect(config.mongoUri);
  console.log('[db] connected to MongoDB');

  createApp().listen(config.port, '0.0.0.0', () => {
    console.log(`[api] FaceGuard API listening on port ${config.port}`);
    console.log(`[api] storage: ${config.storageDriver}, mail: ${config.mailDriver}`);
    // Load the face models now (not on the first face sign-in), then fill in older accounts.
    face.init().then(addMissingFaceDescriptors).catch((e) => console.error('[face] startup:', e.message));
  });
}

main().catch((e) => {
  console.error('[startup]', e.message);
  process.exit(1);
});
