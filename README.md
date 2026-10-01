# APEX TRADES

A full-stack trading education and market-intelligence app. The local build includes a React/Vite client, Express API, Prisma/SQLite database, cookie-based JWT authentication, member/admin authorization, uploads, Socket.IO market updates, and optional Stripe and SMTP integrations.

## Requirements

- Node.js 20.19+ or 22.12+
- npm
- PostgreSQL only when using the PostgreSQL schema; SQLite is the default and needs no separate service

## Local setup

```powershell
npm install
Copy-Item .env.example .env
```

Set a private `JWT_SECRET` and `ADMIN_PASSWORD` in `.env`. Keep `.env` out of source control. The checked-in local `.env` is ignored and configured for development only.

```powershell
npm run db:generate
npm run db:push
npm run db:seed
npm run dev
```

Open <http://localhost:5173>. The API runs at <http://localhost:4000>; `GET /api/health` reports its status. `npm run dev` starts both processes together. `npm run build` type-checks both apps and creates the production client/API build. `npm start` serves the compiled API from `dist/server`.

## Public deployment on Render

The included `render.yaml` deploys the website and API together on Render and uses an external PostgreSQL database. Create a free PostgreSQL project with a provider such as Neon, then create a Render Blueprint from this GitHub repository. Enter the provider's PostgreSQL connection string, `ADMIN_EMAIL`, and `ADMIN_PASSWORD` in Render when prompted. Keep the connection string and password private; Render generates a private `JWT_SECRET`. Once deployment completes, open the public URL shown for the `apex-trades` web service.

The free Render web service uses ephemeral storage: files uploaded through the owner console can be lost when the service restarts or redeploys. Use private persistent object storage before relying on uploads in production. Configure Stripe and SMTP separately if you need live payments and email-based password resets. Free database providers may pause inactive projects or have usage limits; review the provider's current terms.

### Local demo access

Choose **Try member demo** from the log-in dialog. It creates a local demo member and a 30-day demo subscription without payment details. The local owner account is created from `ADMIN_EMAIL` and `ADMIN_PASSWORD` the first time the API starts; configure those values before launch to access the owner panel.

Password reset tokens are shown in the app during local development. In production, configure SMTP (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`) to deliver reset links. Reset tokens expire after 30 minutes.

## Database

SQLite is the local default (`DATABASE_URL=file:./dev.db`) and is described by `prisma/schema.prisma`.

To use PostgreSQL, set `DATABASE_URL_POSTGRESQL` to your database connection string and run:

```powershell
npm run db:generate:postgres
npm run db:push:postgres
```

The generated Prisma client is shared by both schemas. Back up the database before schema changes in production.

## Stripe subscriptions

Create monthly and yearly recurring prices in Stripe test mode. Set `STRIPE_SECRET_KEY`, `STRIPE_MONTHLY_PRICE_ID`, and `STRIPE_YEARLY_PRICE_ID` in `.env`. Configure a webhook endpoint at `/api/subscriptions/webhook` and set `STRIPE_WEBHOOK_SECRET`. Subscribe the endpoint to `checkout.session.completed`, `customer.subscription.updated`, and `customer.subscription.deleted`.

Without Stripe configuration, local checkout creates a demo membership. Production checkout returns a configuration error instead of granting a paid membership. Never use the local demo endpoint in production; it is disabled when `NODE_ENV=production`.

## Admin uploads

The owner panel accepts bot packages (`.zip`, `.ex4`, `.ex5`, `.mq4`, `.mq5`, `.pdf`) and course assets (`.mp4`, `.webm`, `.mov`, `.pdf`) up to 50 MB. Local uploads go to `uploads/` and are served only through an authenticated member endpoint. For production, replace local disk storage with private object storage and signed download URLs; do not expose the upload directory as a public static folder.

Admin capabilities require the bootstrapped owner email and password. New sign-ups never receive admin privileges based on their email address.

## Development integrations and production boundaries

- TradingView embeds provide charting for OANDA XAUUSD and Nasdaq 100. The Socket.IO gold ticker is simulated local development data, not an exchange feed.
- The copy-trading connection records a demo broker/account link only. Connecting a real broker and automatically mirroring orders requires a separately selected broker, its official API, and appropriate risk controls; this app does not collect trading-account passwords or place live orders.
- Bot activation records member settings. It does not execute or run an automated strategy on a trading account.
- Example performance figures and seeded market content are illustrative, not financial advice.
- The app includes security headers, CORS allowlisting, input validation, authentication and API rate limits. Production deployment additionally requires HTTPS, a strong JWT secret, SMTP, Stripe webhook configuration, private asset storage, database backups, and deployment-specific cookie/CORS settings.

## Environment variables

See `.env.example` for the complete template. Do not commit `.env` or place real credentials in frontend `VITE_*` variables; all Stripe and SMTP secrets must remain server-side.

## Scripts

- `npm run dev` — client and API in watch mode
- `npm run build` — TypeScript checks and production client/API build
- `npm run api:build` — compile only the API
- `npm run db:generate` / `npm run db:push` — generate the SQLite Prisma client and sync its schema
- `npm run db:seed` — add starter bots and courses
- `npm start` — run the compiled API
