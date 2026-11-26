# Web image: builds the Angular app, then serves it with Caddy, which also terminates HTTPS and forwards
# /api to the backend (same origin, so the API needs no CORS). Used by the backend repo's
# deploy/docker-compose.yml. src/environments/firebase.ts is git-ignored: copy it to the server clone first.

FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN test -f src/environments/firebase.ts || { echo "Missing src/environments/firebase.ts (copy it from your PC)"; exit 1; }
RUN npx ng build --configuration production

FROM caddy:2-alpine
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/dist/society-management-web/browser /srv
