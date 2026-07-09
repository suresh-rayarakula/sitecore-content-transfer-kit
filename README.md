# Sitecore Content Transfer Kit

A Next.js marketplace-style custom app for Sitecore XM Cloud that gives teams a guided UI over the Sitecore Content Transfer API and Item Transfer API. It lets you point at a source and target environment, select item paths, and run a transfer with live progress feedback.

## Why this project exists

Sitecore's older package-based migration flow is no longer the supported path. The modern approach is a documented, OAuth-authenticated API workflow that streams content in chunks and consumes the resulting `.raif` package into the target database. This app packages that workflow into a simple app that can run locally or be installed inside Sitecore App Studio as a standalone experience.

## Features

- Source and target environment configuration
- OAuth client credential validation
- Transfer initiation and status polling
- Chunk download and upload workflow
- Blob assembly and consumption through the Item Transfer API
- Live NDJSON transfer log output for monitoring

## Project structure

```text
app/                  Next.js routes and API handlers
components/           UI panels and transfer console
lib/                  Sitecore API wrappers and shared types
utils/                Marketplace client helpers
```

## Prerequisites

- Node.js 20+
- A Sitecore Cloud environment with automation client credentials for the source and target environments
- Access to the Content Transfer API and Item Transfer API for your organization

## Run locally

```bash
npm install
npm run dev
```

Open http://localhost:3000 and use the standalone experience route at /standalone-extension.

## Credentials and authentication

For each environment you need:

- Environment host
- OAuth token URL
- Client ID
- Client secret
- Audience (typically https://api.sitecorecloud.io)

The app uses these values server-side in the API routes and does not persist them.

## Deploy for App Studio or marketplace use

1. Push the repository to GitHub.
2. Deploy it to Vercel or another Node.js hosting platform.
3. Register it in Sitecore App Studio as a custom app with the standalone route pointing to /standalone-extension.
4. Install it into the target organization and open it from the Sitecore experience.

> Large transfers can take several minutes. Make sure your hosting plan supports longer-running server functions.

## Security notes

- Treat the client secrets as sensitive credentials.
- Restrict who can install or access the app in App Studio.
- Prefer scoped automation credentials for source and target environments.

## License

This project is licensed under the MIT License. See the LICENSE file for details.
