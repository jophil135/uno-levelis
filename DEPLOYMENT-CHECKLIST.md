# Pre-launch checklist

- [ ] Copy `.env.example` to `.env` locally, or set equivalent host environment variables.
- [ ] Replace the sample admin username/passcode and development session secret.
- [ ] Set `NODE_ENV=production` and `APP_ORIGIN` to the exact HTTPS origin.
- [ ] Use a Node.js 20+ runtime.
- [ ] Attach persistent storage for both database and uploads.
- [ ] Confirm `/` and `/admin` load over HTTPS.
- [ ] Register a test user and complete a quest.
- [ ] Sign in to the admin console and add/pause a quote.
- [ ] Upload a small test sponsor image and confirm it appears in the user dashboard.
- [ ] Confirm the app remains usable at narrow mobile widths.
- [ ] Back up the database and uploaded images.
- [ ] Do not publish `.env`, database backups, user data or administrator credentials.

## Important

A successful local code check does not guarantee the settings of a third-party hosting account. Verify the environment variables, persistent disk mount and service logs after deployment.
