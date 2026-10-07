// Login tokens (JWT) and the middleware that checks them.
const jwt = require('jsonwebtoken');
const config = require('./config');
const User = require('./models/User');

function issueToken(user) {
  return jwt.sign({ sub: user._id.toString(), tv: user.tokenVersion }, config.jwtSecret, {
    algorithm: 'HS256',
    expiresIn: config.jwtExpiresIn,
  });
}

/** Requires "Authorization: Bearer <token>"; puts the signed-in user on req.user. */
async function requireAuth(req, res, next) {
  const header = req.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Please sign in.' });
  try {
    const payload = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
    const user = await User.findById(payload.sub);
    // A password reset bumps tokenVersion, which signs out every old token.
    if (!user || user.tokenVersion !== payload.tv) return res.status(401).json({ error: 'Your session has ended. Please sign in again.' });
    req.user = user;
    return next();
  } catch {
    return res.status(401).json({ error: 'Your session has ended. Please sign in again.' });
  }
}

module.exports = { issueToken, requireAuth };
