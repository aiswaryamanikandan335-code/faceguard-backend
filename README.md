# FaceGuard API

Node.js + Express backend for the FaceGuard Unity app.

```
FaceGuard app ──HTTPS──► this API ──► MongoDB Atlas   (name, phone, email, gender, bcrypt password hash, sign-up time)
                                  └──► Cloudinary      (face photo, private — opened only through 1-hour signed links)
```

## Endpoints (all under `/api`)

| Method | Path | Body | What it does |
|---|---|---|---|
| GET | `/health` | – | `{ ok: true }` |
| POST | `/auth/check` | `{ email, phone }` | `{ emailExists, phoneExists }` — Sign Up page check |
| POST | `/auth/signup` | multipart: `fullName, phone, email, gender, password, faceImage` (JPEG/PNG ≤ 2 MB) | Saves the profile + photo. 409 if email/phone already exists |
| POST | `/auth/login` | `{ username, password }` (username = email or phone) | `{ token, user }` |
| GET | `/profile` | header `Authorization: Bearer <token>` | `{ user }` with a fresh `faceUrl` |
| POST | `/auth/forgot` | `{ email }` | Emails a 6-digit code (10 min, 5 tries) |
| POST | `/auth/reset` | `{ email, code, newPassword }` | Changes the password; old tokens stop working |

Security: bcrypt (12 rounds) password hashes, JWT login tokens, rate limits per IP, lock after 5 wrong
passwords (30 s), reset codes stored only as HMAC hashes, private Cloudinary images, Helmet headers,
photo type checked by its bytes, no password/lock/reset fields ever returned.

## Run it

Node.js 20+ (on this PC: `D:\Tools\node-v24.21.0-win-x64`, add it to PATH or call it directly).

```powershell
cd D:\FaceGuardBackend
npm install
npm test               # 8 API tests against a throw-away database
npm run dev:local      # local server, NO accounts needed; data saved in .devdata/; view users at http://localhost:3000/admin
npm start              # real server: needs .env (below)
```

The Unity Editor uses `http://localhost:3000/api` (see `BackendApi.EditorUrl`).

## Real cloud setup (.env)

Copy `.env.example` to `.env` and fill in:

1. **MongoDB Atlas** (free M0): https://www.mongodb.com/cloud/atlas/register → create a free cluster →
   *Database Access*: add a user + password → *Network Access*: add `0.0.0.0/0` →
   *Connect → Drivers*: copy the connection string into `MONGODB_URI` (put the password in, and the database
   name `faceguard` before the `?`).
2. **Cloudinary** (free): https://cloudinary.com/users/register_free → *Dashboard*: copy **Cloud name**,
   **API Key**, **API Secret** into the three `CLOUDINARY_*` lines.
3. **JWT_SECRET**: any long random text (32+ characters).
4. **Gmail for reset codes** (optional): Google Account → Security → 2-Step Verification on → *App passwords* →
   create one → `SMTP_USER` = your Gmail, `SMTP_PASS` = the 16 letters. Without it, codes are printed in the
   server console.

Then `npm start` → `[db] connected to MongoDB` and `listening on port 3000`.

## Put it online (so phones can reach it)

**Render** (free web service):
1. Put this folder on GitHub (the `.gitignore` keeps `.env` and `node_modules` out).
2. https://render.com → *New → Web Service* → pick the repo.
   Build command `npm install`, start command `npm start`.
3. *Environment*: add every line of your `.env` as a variable.
4. Deploy → you get `https://<name>.onrender.com`. Check `https://<name>.onrender.com/api/health`.
5. In Unity, `Assets/FaceGuard/Scripts/Data/BackendApi.cs`: set
   `DeviceUrl = "https://<name>.onrender.com/api";` and build the APK.

The free Render plan sleeps after 15 minutes without requests; the first request then takes ~30–50 s.

## Where to see the data

- **This API's viewer**: `/admin` — local server: http://localhost:3000/admin (open). On a deployed server set
  `ADMIN_KEY` (16+ characters) and open `/admin?key=YOUR_KEY`. Password hashes are never shown.

- **MongoDB Atlas** → *Browse Collections* → `faceguard` → `users`.
- **Cloudinary** → *Media Library* → folder `faceguard/faces` (one photo per user id).
