// Local server for testing on this PC with NO cloud accounts: a MongoDB that saves to .devdata/db, face photos
// saved as files in .devdata/faces, and reset codes printed here instead of emailed. Data survives restarts.
// Run: npm run dev:local     View the saved users: http://localhost:3000/admin
const path = require('path');
const fs = require('fs');

const dataDir = path.resolve(__dirname, '..', '.devdata');
process.env.STORAGE_DRIVER = 'disk';
process.env.DISK_DIR = path.join(dataDir, 'faces');
process.env.MAIL_DRIVER = 'console';
process.env.ADMIN_OPEN = '1';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'local-dev-secret-only-for-testing-0123456789';

const mongoose = require('mongoose');
const express = require('express');
const { MongoMemoryServer } = require('mongodb-memory-server');

(async () => {
  const dbPath = path.join(dataDir, 'db');
  fs.mkdirSync(dbPath, { recursive: true });
  const mongo = await MongoMemoryServer.create({ instance: { dbPath, storageEngine: 'wiredTiger', port: 27117 } });
  await mongoose.connect(mongo.getUri('faceguard'));

  const { createApp } = require('./app');
  const storage = require('./storage');
  const port = Number(process.env.PORT || 3000);

  const outer = express();
  // Face photos for the Unity Editor and the /admin page: GET /dev/face/<publicId>.jpg
  outer.get(/^\/dev\/face\/([\w/]+)\.jpg$/, (req, res) => {
    const file = storage.fileOf(req.params[0]);
    if (!file.startsWith(storage.root + path.sep) || !fs.existsSync(file)) return res.status(404).end();
    res.sendFile(file, { dotfiles: 'allow' }); // the data folder is ".devdata"
  });
  outer.use(createApp());

  const server = outer.listen(port, '0.0.0.0', () => {
    console.log(`[dev] FaceGuard API on http://localhost:${port}/api`);
    console.log(`[dev] saved users: http://localhost:${port}/admin`);
    console.log(`[dev] data folder: ${dataDir}`);
  });

  const stop = async () => {
    server.close();
    await mongoose.disconnect();
    await mongo.stop({ doCleanup: false }); // keep the data files
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
})().catch((e) => {
  console.error('[dev] could not start:', e.message);
  process.exit(1);
});
