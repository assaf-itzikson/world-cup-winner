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

## Run in the background with a public HTTPS URL

Docker Desktop must be running. Set `ADMIN_PASSWORD` in `.env`, then run:

```sh
docker compose up -d --build
docker compose logs tunnel
```

Share the public HTTPS URL printed in the tunnel logs. The app and a localhost.run SSH tunnel run in the background and restart automatically while Docker is running. The app is accessible through the tunnel; no host port is published. `.env` stays out of the Docker image, and the password is supplied at runtime. Draw results are stored in the `draw-data` Docker volume and survive container rebuilds. The tunnel uses no personal SSH keys or account credentials; its server host key is retained in a separate Docker volume.

To find the latest address without the tunnel's QR-code output:

```sh
docker compose logs --no-color tunnel | rg 'tunneled with tls termination' | tail -1
```

Live updates use one-second polling in Docker to work reliably across public tunnel proxies. Each browser tab keeps its viewer ID across refreshes, so refreshing does not add another online viewer. Names are initially added only when the check-in form is submitted. A successful submission locks the name field and submit button, and saves the name in that tab's session storage. Refreshing restores the locked name and its check-in without creating duplicate viewers. Closing the tab or window ends that session; a new tab starts with an empty, editable field. Closing a page sends a departure notification; if it cannot be delivered, the viewer expires about a minute after the last update. Other deployments continue to use Server-Sent Events. Docker sets `COOKIE_SECURE=true` so admin cookies are always restricted to HTTPS, even when the tunnel's forwarding headers differ between providers.

Useful commands:

```sh
docker compose ps
docker compose logs --tail=50 app tunnel
docker compose up -d --build
docker compose down
```

`docker compose down` stops public access without deleting draw results. Avoid `docker compose down -v` unless you intend to delete the saved results. Changes to `.env` or participant names require running `docker compose up -d --build` again.

The free public URL rotates regularly, even while the tunnel is connected. Get the latest address from the logs and share it again if the previous address stops working. This makes the free tunnel suitable for testing, but a stable address is preferable for the actual live draw. Your computer must remain awake, connected to the internet, with Docker running. For a permanent address, deploy on Render below, or configure a tunnel with a domain you own. This setup requires outbound SSH access to `localhost.run:22`. Cloudflare Quick Tunnels were unavailable on the current network because their required outbound port 7844 is blocked.

Tunnel documentation: https://localhost.run/docs/http-tunnels/

## How the draw works

The server normalizes names and removes duplicates, then uses Node's cryptographic `randomInt` and a Fisher–Yates shuffle to select three distinct people with equal probability. Randomness comes from the operating system; the wheel is a visual animation of that server draw. All winners are drawn together. The wheel rests on the first winner and all three appear on the cards after 18 seconds.

Results are saved before the animation starts and survive restarts when `DATA_DIR` is persistent. Winners are withheld from public responses until the draw ends. A second spin is rejected until an admin explicitly resets the completed draw. This is a fair random selection, but not an independently verifiable public lottery protocol.

Admin authorization is checked on the server, with an expiring HttpOnly cookie, same-origin checks and login attempt limits. HTTPS is required for public deployment. Login attempts are limited per connection IP; a hosting proxy can cause this limit to be shared by viewers. Admin sessions and check-ins are held in memory and expire on restart; check-ins disappear when SSE viewers disconnect or polling viewers time out. Run a single server instance with a persistent disk.

## Deploy publicly on Render

Use a **Node web service**, so viewers receive shared live updates and the server can enforce admin access.

1. Push this folder to a GitHub repository. Keep `.env` out of Git.
2. In Render, create a **Blueprint** from the repository. `render.yaml` configures a paid Starter service and a 1 GB persistent disk.
3. Set `ADMIN_PASSWORD` when prompted. Use a long, unique password and share it only with the admin.
4. Deploy, then share the supplied `https://…onrender.com` URL with everyone.

Alternatively create a Node web service manually: build command `yarn install --frozen-lockfile --production`, start command `yarn start`, health check `/health`; set `ADMIN_PASSWORD`, mount a persistent disk at `/var/data`, and set `DATA_DIR=/var/data`.

The paid service and disk incur hosting charges; review Render's current pricing before deploying. A free service can demonstrate the page, but free services sleep and do not offer persistent disks, so results will not reliably survive restarts or deploys. Static-only hosting cannot enforce these admin controls or synchronize the room.

Render documentation: https://render.com/docs/web-services and https://render.com/docs/disks

## Validation

`yarn run check` validates JavaScript syntax. To smoke test, open two browser windows: sign in as admin in one, check in from the other, and spin. Verify both show the same three distinct winners and the public window cannot initiate a draw.
