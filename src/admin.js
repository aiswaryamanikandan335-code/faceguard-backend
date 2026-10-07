// Read-only viewer for the saved users: GET /admin (web page) and GET /admin/users.json.
// Protected by ADMIN_KEY (open it as /admin?key=YOUR_KEY). The local dev server sets ADMIN_OPEN=1 instead.
// Never shows password hashes, reset codes or lock fields.
const express = require('express');
const User = require('./models/User');
const storage = require('./storage');

const router = express.Router();

router.use((req, res, next) => {
  if (process.env.ADMIN_OPEN === '1') return next();
  const key = process.env.ADMIN_KEY;
  if (key && key.length >= 16 && (req.query.key === key || req.get('x-admin-key') === key)) return next();
  return res.status(404).json({ error: 'Not found.' }); // look like nothing is here
});

async function listUsers() {
  const users = await User.find().sort({ createdAt: -1 }).limit(500);
  return users.map((u) => ({
    ...u.publicProfile(storage.url(u.face)),
    updatedAt: u.updatedAt,
    passwordStored: u.passwordHash ? 'bcrypt hash (hidden)' : 'none',
    locked: !!(u.lockedUntil && u.lockedUntil > new Date()),
  }));
}

router.get('/users.json', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ count: await User.countDocuments(), users: await listUsers() });
});

router.get('/', async (req, res) => {
  const users = await listUsers();
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const when = (d) => (d ? new Date(d).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '');
  const rows = users
    .map(
      (u) => `<tr>
        <td>${u.faceUrl ? `<a href="${esc(u.faceUrl)}" target="_blank"><img src="${esc(u.faceUrl)}" alt="face of ${esc(u.fullName)}"></a>` : '<span class="muted">no photo</span>'}</td>
        <td><b>${esc(u.fullName)}</b><div class="muted mono">${esc(u.id)}</div></td>
        <td>${esc(u.email)}</td>
        <td>+91 ${esc(u.phone)}</td>
        <td>${esc(u.gender)}</td>
        <td>${esc(when(u.createdAt))}</td>
        <td class="muted">${esc(u.passwordStored)}${u.locked ? ' · <b class="warn">locked</b>' : ''}</td>
      </tr>`
    )
    .join('');
  const keyParam = req.query.key ? `?key=${encodeURIComponent(req.query.key)}` : '';
  res.set('Cache-Control', 'no-store');
  res.set('Content-Security-Policy', "default-src 'none'; img-src * data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'");
  res.type('html').send(`<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="15">
<title>FaceGuard users</title>
<style>
  :root { --bg:#f5f6fb; --card:#fff; --text:#141833; --muted:#6a6f8a; --line:#e1e3ee; --accent:#5b4bd6; --warn:#c2410c; }
  @media (prefers-color-scheme: dark) { :root { --bg:#0e1330; --card:#161c40; --text:#f2f3fa; --muted:#a3a9cf; --line:#2a3160; --accent:#9d91ff; --warn:#fb923c; } }
  body { margin:0; padding:24px 16px; background:var(--bg); color:var(--text); font:15px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif; }
  h1 { margin:0 0 4px; font-size:24px; } .sub { color:var(--muted); margin:0 0 20px; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:14px; overflow-x:auto; }
  table { width:100%; border-collapse:collapse; min-width:760px; }
  th, td { text-align:left; padding:12px 14px; border-bottom:1px solid var(--line); vertical-align:middle; }
  th { font-size:12px; text-transform:uppercase; letter-spacing:.06em; color:var(--muted); }
  tr:last-child td { border-bottom:none; }
  img { width:56px; height:70px; object-fit:cover; border-radius:10px; border:1px solid var(--line); display:block; }
  .muted { color:var(--muted); font-size:13px; } .mono { font-family:ui-monospace,Consolas,monospace; font-size:11px; }
  .warn { color:var(--warn); } a { color:var(--accent); } .empty { padding:40px; text-align:center; color:var(--muted); }
</style></head><body>
<h1>FaceGuard users</h1>
<p class="sub">${users.length} saved account${users.length === 1 ? '' : 's'} · newest first · refreshes every 15 s ·
<a href="/admin/users.json${keyParam}">raw JSON</a></p>
<div class="card">${users.length
    ? `<table><thead><tr><th>Face photo</th><th>Name</th><th>Email</th><th>Phone</th><th>Gender</th><th>Registered</th><th>Password</th></tr></thead><tbody>${rows}</tbody></table>`
    : '<div class="empty">No accounts yet. Sign up from the FaceGuard app.</div>'}</div>
</body></html>`);
});

module.exports = router;
