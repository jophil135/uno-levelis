# UNO LEVELING — Rebuild 2.0

A responsive discipline and personal-progression web app. This rebuild uses **Node.js built-in modules only**: no third-party runtime packages or build step are required.

## Included

- Responsive user registration, sign-in and sign-out
- Password hashing with Node.js `scrypt` and per-user random salts
- Personal quests, completion rewards and XP progression
- Levels and progression ranks: Rookie, Disciplined, Ascendant, Vanguard, Elite and Transcendent
- Daily quest set, activity streak tracking and achievement unlocks
- Completion statistics and motivational quote display
- Private administrator console
- Admin quote publishing/pausing/deletion
- Sponsor/partner management and validated image uploads (JPG, PNG, WEBP, GIF; max 5 MB)
- User directory and basic platform totals
- CSRF tokens, same-site HTTP-only cookies, request throttling, security headers, input limits and upload signature checks
- JSON database and persistent uploads directory
- Mobile, tablet and desktop layouts

## Requirements

- Node.js 20 or newer (Node.js 22 LTS recommended)
- A host that runs a long-lived Node.js web service
- Persistent disk/storage for `data/` and `uploads/`

No `npm install` is needed. There are no external package dependencies.

## Run on your computer

1. Extract the ZIP.
2. Open a terminal in the `uno-leveling-rebuild` folder.
3. Copy `.env.example` to `.env`.
   - Windows PowerShell: `Copy-Item .env.example .env`
   - macOS/Linux: `cp .env.example .env`
4. Edit `.env` and set all of the following:
   - `SESSION_SECRET`: a unique random value with at least 32 characters.
   - `ADMIN_USERNAME`: your chosen administrator username.
   - `ADMIN_PASSCODE`: a unique passcode with at least 12 characters.
   - `APP_ORIGIN`: leave `http://localhost:3000` for local use.
5. Start the server with `npm start` (or `node server.js`).
6. Open `http://localhost:3000` for the app and `http://localhost:3000/admin` for the admin console.

The first registered user is not automatically an administrator. Admin access is controlled only by the server-side environment variables.

## Deploy on Render

Create a **Web Service** (not a static site) connected to the GitHub repository containing this folder.

- Root Directory: `uno-leveling-rebuild` if this folder is inside a larger repository; otherwise leave blank.
- Runtime: Node
- Build Command: `npm install` (or `echo 'No dependencies to install'`; both are fine)
- Start Command: `npm start`
- Node version: use Node 22 or newer.

Add these environment variables in the host dashboard:

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `SESSION_SECRET` | A unique random secret of 32+ characters |
| `ADMIN_USERNAME` | Your administrator username |
| `ADMIN_PASSCODE` | A unique passcode of 12+ characters |
| `APP_ORIGIN` | Your exact deployed HTTPS origin, e.g. `https://your-service.onrender.com` |
| `DATA_DIR` | `./data` |
| `UPLOAD_DIR` | `./uploads` |

Attach a persistent disk to the service and mount it at a stable path, then set `DATA_DIR` and `UPLOAD_DIR` to directories on that disk, for example `/var/data/uno` and `/var/data/uno/uploads`. Create/ensure those directories are writable by the service. Without persistent storage, user accounts, quests and uploaded images may be lost when the host replaces the instance.

After deployment, open `/admin` and sign in using the administrator environment variables. Never put the admin passcode or `SESSION_SECRET` in frontend files, source control, screenshots or public messages.

## Data and backups

- Database: `data/uno.json` (or the configured `DATA_DIR/uno.json`)
- Uploaded images: `uploads/` (or configured `UPLOAD_DIR`)
- Back up both locations regularly and store backups privately.
- The JSON database is intended for a small, single-instance deployment. For a larger multi-instance product, migrate to a managed database and object storage.

## Checks performed

The project includes a syntax check:

```bash
npm run check
```

The rebuild was also checked with a local HTTP integration run covering account creation, dashboard loading, quest creation/completion, admin authentication and quote management. Review the host's persistent-storage and environment settings before public launch.

## Current scope / honest limitations

- Email verification, password reset emails, OAuth, multi-admin roles, billing and sponsor impression analytics are not included.
- Streaks are updated when a user completes at least one quest on a new UTC calendar day; this is not a push notification or background scheduler.
- Sessions are held in process memory and users will need to sign in again after a server restart.
- JSON storage is appropriate only for a small single-instance deployment. It is not a substitute for PostgreSQL under high traffic or multiple instances.
- This package is a deployable application source bundle; it does not create a hosted website or configure a hosting account automatically.
