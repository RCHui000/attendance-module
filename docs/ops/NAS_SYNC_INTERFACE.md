# NAS Employee Sync Interface

This integration uses the cloud app as an event center and keeps NAS access
outbound-only. Public traffic terminates at `https://xpjs.asia`; no inbound NAS
ports, NAS administrator credentials, or Supabase `service_role` keys are shared
with the NAS side.

## Environment

```text
NAS_SYNC_API_BASE=https://xpjs.asia/api/nas-sync
SUPABASE_REALTIME_URL=wss://xpjs.asia/realtime/socket
NAS_SYNC_TABLE=public.nas_sync_events
NAS_SYNC_AUTH_MODE=dedicated-token
```

All HTTP requests use:

```http
Authorization: Bearer <NAS_SYNC_TOKEN>
```

The cloud server stores only `NAS_SYNC_TOKEN_SHA256`, the SHA-256 hex digest of
that token. Rotate the raw token on the NAS side and replace only the digest in
`/opt/approval-app/env/production.env`.

## Event Source

When a new active employee row is inserted with a non-empty `name`, migration
`126_nas_sync_events.sql` writes one durable `employee.created` event into
`public.nas_sync_events`. The unique `(employee_id, event_type)` constraint keeps
the employee creation event idempotent.

Realtime is a wake-up signal only. The pending API is the source of truth, so the
NAS worker must pull pending events on startup and after reconnect.

## Pending

```http
GET /api/nas-sync/events/pending?limit=10
```

Response:

```json
{
  "ok": true,
  "events": [
    {
      "eventId": "018f7a97-8a8f-7d52-a94d-b4f52ce76e40",
      "employeeId": 42,
      "name": "张三",
      "type": "employee.created",
      "status": "pending",
      "attempts": 0,
      "createdAt": "2026-06-29T00:00:00Z"
    }
  ]
}
```

The payload intentionally excludes salary, contract, identity-card, login, and
claim-token fields.

## Claim

```http
POST /api/nas-sync/events/{eventId}/claim
```

The server atomically moves a pending event to `processing`, increments
`attempts`, and returns a worker-specific claim token.

```json
{
  "ok": true,
  "event": {
    "eventId": "018f7a97-8a8f-7d52-a94d-b4f52ce76e40",
    "employeeId": 42,
    "name": "张三",
    "type": "employee.created",
    "status": "processing",
    "attempts": 1,
    "createdAt": "2026-06-29T00:00:00Z"
  },
  "claimToken": "worker-secret"
}
```

Use `name` as the NAS username, matching the existing
`create_nas_user(name, settings)` behavior. Duplicate-name behavior remains a
NAS-side responsibility.

## Complete

```http
POST /api/nas-sync/events/{eventId}/complete
Content-Type: application/json

{
  "claimToken": "worker-secret",
  "nasUsername": "张三"
}
```

The claim token must match the active processing claim. Stale workers receive a
conflict response and must not retry completion blindly.

## Fail

```http
POST /api/nas-sync/events/{eventId}/fail
Content-Type: application/json

{
  "claimToken": "worker-secret",
  "error": "NAS API timeout"
}
```

Failures record `last_error` and return the event to `pending` until `attempts`
reaches 5. At 5 attempts it becomes `failed` and is excluded from default pending
pulls.

## Realtime Wake-Up

```http
GET /api/nas-sync/realtime-token
```

Response:

```json
{
  "ok": true,
  "token": "<short-lived nas_sync JWT>",
  "expiresIn": 3600,
  "realtimeUrl": "wss://xpjs.asia/realtime/socket",
  "table": "public.nas_sync_events"
}
```

The `nas_sync` database role has read-only access to minimal event columns for
Realtime table-change wake-ups. It cannot write events or call sync RPCs.
