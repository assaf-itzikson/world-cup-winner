# The Final Whistle

A public live draw using the names in `participants.json`, initially transcribed from the supplied screenshot. Only names are included; no email addresses are stored. Simon McWhinnie and Rhiannon Smith each appear once. The current roster excludes Assaf Itzikson following a roster edit during development.

## Run locally

Use Node.js 22 or newer for deployment and Yarn Classic 1.22.x (the project pins 1.22.11). The app also runs on the Node.js 18 installation on this computer. Server and browser JavaScript use ES modules. No third-party packages or build step are needed.

1. Copy `.env.example` to `.env`.
2. Replace `ADMIN_PASSWORD` with a unique password of at least 16 characters.
3. Run `yarn install --frozen-lockfile`.
4. Run `yarn start`.
5. Open http://localhost:3000. Click **Admin access** and sign in with that password.

Share the public URL with viewers. They can watch without signing in and enter their name to check in; only the admin sees the check-in list. Checking in does not enter a person into the draw. Edit `participants.json` before starting the server to change the eligible names.

## Deploy the frontend on GitHub Pages

The public frontend is hosted at https://assaf-itzikson.github.io/world-cup-winner/. GitHub Pages serves static files and cannot run the Node backend. Admin authentication, the shared draw, and viewer presence still require a public HTTPS backend.

1. Deploy the backend using the Render instructions below, or another Node hosting service.
2. Set `ALLOWED_ORIGINS=https://assaf-itzikson.github.io` on the backend. `render.yaml` already includes this setting.
3. In this GitHub repository, open **Settings → Secrets and variables → Actions → Variables**. Add `PAGES_API_URL` containing the backend's public HTTPS URL, without a trailing slash. This URL is public configuration, not a secret.
4. In **Settings → Pages**, select **GitHub Actions** as the deployment source.
5. Push to `main`, or run **Deploy GitHub Pages** from the Actions tab. After changing `PAGES_API_URL`, rerun that workflow.

`PAGES_API_URL` must point to the running Node server, not `https://assaf-itzikson.github.io` or the Pages site URL. The backend's `/health` endpoint should return `{"ok":true}`. A Pages URL has no API and returns 404 for `/api/session`. The build rejects GitHub Pages hostnames as backend URLs.

The workflow uses `yarn build:pages` to publish only the frontend and participant names from `dist/`. `.env`, the server, and saved draw data are excluded. Asset paths work under `/world-cup-winner/`. Never put `ADMIN_PASSWORD` in `PAGES_API_URL`, frontend configuration, or any Pages artifact.

Without `PAGES_API_URL`, the public page displays the wheel and eligible names, with the live draw disconnected and its controls disabled. It cannot spin, check in viewers, or show shared live results until the backend is connected.

For a local Pages build, run `PAGES_API_URL=https://your-backend.example yarn build:pages`. Only use an HTTPS backend URL that you actually control and have deployed.

## Run Docker in the background

Docker Desktop must be running. Set `ADMIN_PASSWORD` in `.env`, then run:

```sh
docker compose up -d --build
docker compose ps
docker compose logs --tail=50 app
docker compose down
```

The app runs at http://localhost:3000 and restarts automatically while Docker is running. No tunnel service is included. This local HTTP address cannot be used as the backend for the public HTTPS Pages site. `.env` stays out of the Docker image and draw results remain in the `draw-data` volume. Avoid `docker compose down -v` unless you intend to delete saved results. Changes to `.env` or participant names require running `docker compose up -d --build` again.

## Viewer sessions

Each browser tab keeps its viewer ID across refreshes, preventing duplicate online counts. Names are initially added only when the check-in form is submitted. A successful submission locks the name field and submit button and saves the name in the tab's session storage. Refresh restores that name and check-in without duplicate viewers. Closing the tab or window ends the session. If its departure notification cannot be delivered, the viewer expires about a minute after the last update. Pages and Docker use one-second polling; same-origin deployments may use Server-Sent Events.

## How the draw works

The server normalizes names and removes duplicates, then uses Node's cryptographic `randomInt` and a Fisher–Yates shuffle to select three distinct people with equal probability. Randomness comes from the operating system; the wheel is a visual animation of that server draw. All winners are drawn together. The wheel rests on the first winner and all three appear on the cards after 18 seconds.

Results are saved before the animation starts and survive restarts when `DATA_DIR` is persistent. Winners are withheld from public responses until the draw ends. A second spin is rejected until an admin explicitly resets the completed draw. This is a fair random selection, but not an independently verifiable public lottery protocol.

Admin authorization is checked on the server, with expiring sessions, allowed-origin checks and login attempt limits. Pages keeps an admin session token in tab session storage and sends it in the Authorization header, so cross-origin authentication does not depend on third-party cookies. Same-origin hosting also supports an HttpOnly cookie. HTTPS is required for public deployment. Login attempts are limited per connection IP; a hosting proxy can cause this limit to be shared by viewers. Admin sessions and check-ins are held in memory and expire on restart. Run a single server instance. The free Render configuration does not preserve saved results across restarts; Docker retains results in its volume.

## Deploy publicly on Render

Use a **Node web service**, so viewers receive shared live updates and the server can enforce admin access.

1. Push this folder to a GitHub repository. Keep `.env` out of Git.
2. In Render, create a **Blueprint** from the repository. `render.yaml` configures a free web service with no paid disk.
3. Set `ADMIN_PASSWORD` when prompted. Use a long, unique password and share it only with the admin.
4. Deploy and use the supplied `https://…onrender.com` URL as the GitHub `PAGES_API_URL` variable. The same backend URL also serves the complete app directly.

Alternatively create a Node web service manually: choose the **Free** compute plan, build command `yarn install --frozen-lockfile --production`, start command `yarn start`, health check `/health`; set `ADMIN_PASSWORD`, `ALLOWED_ORIGINS=https://assaf-itzikson.github.io`, `LIVE_TRANSPORT=poll`, and `DATA_DIR=./data`. Do not add a disk.

Free services sleep after 15 minutes without traffic and can take about a minute to wake up. Saved draw results are lost when the service sleeps, restarts, or redeploys; record the winners before closing the draw. Free services do not support persistent disks. A paid service and disk are optional if durable results are required later. Static-only hosting cannot enforce these admin controls or synchronize the room.

Render documentation: https://render.com/docs/web-services and https://render.com/docs/free

## Validation

`yarn run check` validates JavaScript syntax. To smoke test, open two browser windows: sign in as admin in one, check in from the other, and spin. Verify both show the same three distinct winners and the public window cannot initiate a draw.
