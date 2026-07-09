# Transfer Yard — Sitecore Content Transfer Console

A Next.js **Marketplace Custom App** for SitecoreAI / XM Cloud that gives you a GUI over the
**Content Transfer API** and **Item Transfer API** — the APIs that now replace the retired
Package Designer/Installer for moving content between environments (it was retired to close a
security vulnerability; there is no packages-in-production path anymore, by design).

You point it at a **source** environment and a **target** environment, list the item paths you
want to move, and it streams a live log while it:

1. Authenticates with the source (OAuth client credentials)
2. Initiates a Content Transfer job and polls until packaging is done
3. Downloads every chunk from the source
4. Authenticates with the target
5. Uploads every chunk to the target and marks each chunk set complete
6. Calls the Item Transfer API to consume the assembled `.raif` file into the target's content tree
7. Verifies the blob actually landed (`BlobState: Transferred`)

## Is this the right approach?

Yes — this is the supported path going forward. Package-based migration is gone; Sitecore's own
replacement is a documented, chunked, OAuth-authenticated API pair. Wrapping it in a small GUI is
exactly what the Marketplace platform is for: a **Custom App**, registered in **App Studio**,
shown as a **Standalone** page inside SitecoreAI. That's what this repo builds.

One alternative worth knowing about, in case it fits your workflow better: since both APIs are
plain REST, you could also drive them from a script (the blog post this was based on ships a
Postman collection) instead of a GUI, if you only need occasional, single-operator migrations
and don't need a shared team tool. The GUI is worth it once more than one person needs to run
transfers, or you want a safe, no-typing-raw-requests way to do it.

## Project layout

```
app/
  page.tsx                     landing page (local-dev convenience only)
  standalone-extension/
    page.tsx                   the route you register as the Standalone extension point
  api/
    transfer/route.ts          orchestrates the full transfer, streams NDJSON log lines
    token/route.ts             validates one environment's credentials ("Test auth" button)
components/
  TransferConsole.tsx          the main screen: env panels, manifest table, log console
  EnvPanel.tsx                 source/target credential form + "Test auth"
lib/
  sitecoreTransfer.ts          thin wrappers around every Content/Item Transfer API call
  types.ts                     shared types
utils/hooks/
  useMarketplaceClient.ts      standard Sitecore Marketplace SDK init hook
```

## 1. Run it locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000` — it links straight to `/standalone-extension`, which is the same
screen Sitecore will show once it's registered. You can fully use the app locally without Sitecore
involved at all, since the Content/Item Transfer APIs are called directly with credentials you
enter in the form.

## 2. Where the credentials come from

For **each** environment (source and target) you need:

- **Environment host** — e.g. `https://xmc-yourorg-yourtenant-envname.sitecorecloud.io`
- **OAuth token URL**, **Client ID**, **Client secret** — create these in Cloud Portal under your
  organization's API/service-account credentials for that environment. This app does a standard
  OAuth 2.0 `client_credentials` request to whatever token URL you give it, so use the exact
  token endpoint Cloud Portal shows you when you generate the client — don't assume the URL,
  copy it from there, since Sitecore has more than one identity surface depending on API family.
- **Audience** — Sitecore Cloud's OAuth token endpoint (`auth.sitecorecloud.io`, Auth0-based)
  **requires** this on every `client_credentials` request. The app defaults it to
  `https://api.sitecorecloud.io`, which covers most Sitecore Cloud API clients. If you leave it
  blank you'll get a `403 access_denied` from Auth0 — that's an auth-server rejection, not a bug
  in this app, and not a sign your client ID/secret are wrong.

Credentials are only used server-side (inside the Next.js API routes) to fetch bearer tokens and
call Sitecore; they're never written to disk or a database by this app. Use the **Test auth**
button on each panel before dispatching a real transfer.

## 3. Deploy it publicly (so App Studio can load it)

1. Push this repo to GitHub.
2. In [Vercel](https://vercel.com), **Add New → Project**, import the repo. Framework preset
   auto-detects Next.js — no build/env changes needed for a first deploy.
3. Note the deployed URL, e.g. `https://transfer-yard.vercel.app`.

> **Function duration:** the transfer route can run for minutes on large trees. `vercel.json`
> already requests `maxDuration: 300`, but durations beyond 60s require a Vercel **Pro** plan or
> higher. On Hobby, either upgrade, split large trees into smaller item paths so each dispatch
> finishes under a minute, or move the orchestration route to a long-running host (Azure App
> Service, Fly.io, a small VM) and keep the Marketplace app as a thin client pointing at it.

## 4. Register it as a Custom App in App Studio

This mirrors what you were seeing in your screenshot (an app with **Standalone** +
**SitecoreAI full screen** extension points, status "To be installed").

1. Cloud Portal → **App studio → Studio → Register app** (or **Create app**).
2. Choose **Custom App**, give it a name (e.g. "Transfer Yard") and a logo.
3. **Extension points** — enable **Standalone** (full-screen SitecoreAI app). Set its **Route
   URL** to `/standalone-extension` and the **Deployment URL** to your Vercel URL from step 3
   above, e.g. `https://transfer-yard.vercel.app`.
4. **API access** — this app doesn't need Sitecore's XM Cloud API grants (it talks to the
   Content/Item Transfer APIs directly with its own credentials, not through the Marketplace
   SDK's mediated GraphQL bridge), so you can leave this unset unless you extend the app later.
5. **Activate** the app, then **Install** it into your organization.
6. Open it from the SitecoreAI navigation — it'll load `/standalone-extension` inside an iframe,
   which is why `next.config.mjs` sets a `frame-ancestors` CSP allowing Sitecore's domains to
   frame it.
7. When you're ready for other people to use it, go back into App Studio → your app →
   **Organizations**, and authorize the orgs/users who should see it. (Skip **Prepare to
   submit/Publish** entirely unless you actually want this listed in the *public* Sitecore
   Marketplace for other customers — for an internal tool, a Custom App installed to your own
   org is the right scope.)

## 5. Security notes

- Client secrets are sent from the browser to this app's own `/api/token` and `/api/transfer`
  routes over HTTPS, then straight to Sitecore — they are not logged, persisted, or sent anywhere
  else. Still, treat this as you would any tool that holds infrastructure credentials: restrict
  who can install/open the app in App Studio (step 4.7), and consider scoping the API client
  credentials you use here as narrowly as your organization's Cloud Portal setup allows.
- If you want to avoid typing secrets into the UI at all, the cleanest hardening is to move
  credential storage server-side (e.g. Vercel encrypted environment variables per environment
  alias) and have the UI only pick "Source: DEV" / "Target: UAT" from a dropdown instead of raw
  fields — the form is built so that swap is a small, contained change in `TransferConsole.tsx`
  and `EnvPanel.tsx`.

## 6. Known rough edges

- The Content Transfer status endpoint can return "not found" for a short window right after
  initiating a transfer (a known Sitecore-side timing issue at the time this was built) — the
  orchestration route already retries through that instead of failing on the first miss.
- Multi-chunk-set transfers (very large trees) are supported by the loop in
  `app/api/transfer/route.ts`, but you'll want the longer function duration from step 3 for those.
- This was built directly against the documented request/response shapes for both APIs, but
  they're new enough that Sitecore may still be iterating on them — if a call starts failing with
  an unexpected shape, check Sitecore's changelog for the Content/Item Transfer APIs before
  assuming the app's code is wrong.
