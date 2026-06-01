# NAS Deployment

## Runtime

The attendance module is now a static React application served by Nginx. It talks directly to the self-hosted Supabase stack:

- GoTrue: `http://192.168.2.100:8777`
- PostgREST: `http://192.168.2.100:8779`
- App: `http://192.168.2.100:8767`

## Deploy

```bash
cd /vol1/@team/个人工作文件/惠若超/attendance-module
npm --prefix frontend ci
npm --prefix frontend run build
docker compose build
docker compose up -d
```

## Database Migrations

Apply SQL files in `supabase-psa/migrations/` in order. The current browser runtime requires `004_full_supabase_runtime.sql`.

## Container

```yaml
services:
  attendance-module:
    build: .
    image: attendance-module:latest
    container_name: attendance-module
    restart: unless-stopped
    ports:
      - "8767:80"
```
