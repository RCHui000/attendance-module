# Reverse Proxy Deployment Profile

This profile previews the cloud production topology on LAN:

- `http://<host>:8080/` -> Web SPA (`attendance-module`)
- `http://<host>:8080/auth/` -> GoTrue
- `http://<host>:8080/rest/` -> PostgREST
- `ws://<host>:8080/realtime/socket` -> Supabase Realtime

Only the reverse proxy should be opened to LAN/public traffic after validation.
Backend service ports can then be bound to `127.0.0.1` with
`supabase-psa/docker-compose.local-bind.yml`.

## LAN Smoke Deployment

Build the frontend with same-origin API paths:

```bash
cd frontend
npm run build
```

Start or refresh the web app:

```bash
docker compose up -d --build attendance-module
```

Start the reverse proxy:

```bash
docker compose -f docker-compose.proxy.yml up -d
```

Open:

```text
http://192.168.2.100:8080
```

## Optional Port Hardening After Validation

After `:8080` is verified, restart Supabase with localhost-only backend ports:

```bash
cd supabase-psa
docker compose -f docker-compose.yml -f docker-compose.local-bind.yml up -d
```

For cloud production, map the proxy to `80:80` and put TLS in front of this
same routing shape. Do not expose Postgres, GoTrue, PostgREST, or Realtime
directly to the public internet.
