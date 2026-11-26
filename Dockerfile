# Web image: builds the Angular app, then serves it with Caddy, which also terminates HTTPS and forwards
# /api to the backend (same origin, so the API needs no CORS). Used by the backend repo's
# deploy/docker-compose.yml. src/environments/firebase.ts is git-ignored: copy it to the server clone first.

FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN test -f src/environments/firebase.ts || { echo "Missing src/environments/firebase.ts (copy it from your PC)"; exit 1; }
# The build takes about a minute. The time limit turns a hang into a failed deploy: identical inline styles
# in two components of one file make Angular 21.2's build finish but never exit (see subscription-ui.ts).
RUN timeout 900 npx ng build --configuration production || { echo "ng build failed or hung (over 15 minutes)"; exit 1; }

FROM caddy:2-alpine
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/dist/society-management-web/browser /srv
