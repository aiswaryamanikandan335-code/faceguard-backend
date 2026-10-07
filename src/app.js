const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const multer = require('multer');
const routes = require('./routes');

function createApp() {
  const app = express();
  app.set('trust proxy', 1); // Render / Railway put the app behind one proxy; needed for per-IP rate limits
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors());
  app.use(express.json({ limit: '20kb' }));

  app.use('/api', routes);
  app.use('/admin', require('./admin'));

  app.use((req, res) => res.status(404).json({ error: 'Not found.' }));

  // Errors: clear messages for bad uploads, nothing internal leaks for the rest.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) {
      const msg = err.code === 'LIMIT_FILE_SIZE' ? 'The face photo is too large (2 MB max).' : 'Invalid upload.';
      return res.status(400).json({ error: msg });
    }
    if (err && err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid request.' });
    console.error('[error]', err);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  });

  return app;
}

module.exports = { createApp };
