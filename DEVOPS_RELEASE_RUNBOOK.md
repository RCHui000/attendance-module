# DevOps Release Runbook

This runbook is for agents working on `RCHui000/attendance-module`. It records the current cloud deployment shape, the standard GitHub release flow, and the production-specific pitfalls we have already hit.

## Scope

Use this document when you need to:

- connect to the Aliyun production server;
- publish a GitHub release;
- deploy a tagged version to production;
- verify or roll back the deployed version.

For the shorter checklist, see `RELEASE_PROCESS.md`.

## Production Target

- GitHub repository: `https://github.com/RCHui000/attendance-module`
- Default branch: `main`
- Production URL: `https://xpjs.asia/`
- SSH account: get from the private deployment handoff, not from the public repository.
- SSH key: get from the private deployment handoff; never commit it.
- Server app directory: `/opt/approval-app/app`
- Server env file: `/opt/approval-app/env/production.env`
- Server backup directory: `/opt/approval-app/backups`

Important: `/opt/approval-app/app` is not a git checkout. Deploy by uploading an archive and overlaying the app directory, not by running `git pull` on the server.

## SSH Access

From Windows PowerShell in the repo root:

```powershell
ssh -i <SSH_KEY_PATH> -o StrictHostKeyChecking=no -o UserKnownHostsFile=NUL <SSH_TARGET>
```

If OpenSSH rejects the key because permissions are too open, tighten the local ACL first:

```powershell
$pem = Resolve-Path <SSH_KEY_PATH>
icacls $pem /inheritance:r /grant:r "$($env:USERNAME):R" /remove:g "*S-1-5-11" "*S-1-1-0" "*S-1-5-32-545"
```

Do not print, paste, or commit production secrets. Treat `/opt/approval-app/env/production.env` as sensitive.

## Versioning

Check the latest tags and choose the next patch version unless the change clearly requires a minor version:

```powershell
git tag --sort=-v:refname | Select-Object -First 5
```

Use the existing `Vx.y.z` format, for example `V0.16.48`.

Add a release manifest for each release:

```text
release-manifest/<version>.json
```

The manifest should include the version, date, commit, summary, checks, and deployment notes.

## Local Build With Production Vite Variables

The server does not have Node/npm available for frontend builds. Build `frontend/dist` locally with production `VITE_*` variables before uploading it.

This step is especially important because a frontend built without `VITE_SUPABASE_ANON_KEY` can deploy successfully but render as a blank page with a `supabaseKey is required` runtime error.

Use a temporary local copy of the production env file, load only build-time variables, then delete the temp file:

```powershell
$version = "V0.16.48" # replace with the target version
$tmpEnv = Join-Path $env:TEMP 'approval-production-build.env'

if (Test-Path $tmpEnv) {
  Remove-Item -LiteralPath $tmpEnv -Force
}

scp -i <SSH_KEY_PATH> -o StrictHostKeyChecking=no -o UserKnownHostsFile=NUL <SSH_TARGET>:/opt/approval-app/env/production.env $tmpEnv

Get-Content -LiteralPath $tmpEnv | ForEach-Object {
  if ($_ -match '^\s*#' -or $_ -notmatch '=') { return }
  $parts = $_ -split '=', 2
  $name = $parts[0].Trim()
  $value = $parts[1]

  if ($name -match '^(VITE_|APP_IMAGE_TAG$|IMAGE_TAG$)') {
    [Environment]::SetEnvironmentVariable($name, $value, 'Process')
  }
}

$env:VITE_APP_VERSION = $version
$env:APP_IMAGE_TAG = $version
$env:IMAGE_TAG = $version

npm --prefix frontend run build

Remove-Item -LiteralPath $tmpEnv -Force
```

Never commit the temporary env file or any production secret.

## Local Checks

Run at least:

```powershell
git diff --check
npm --prefix frontend run build
```

If a local or deployed URL is available, run the frontend render smoke:

```powershell
$env:EXPECTED_VERSION = "V0.16.48" # replace
$env:E2E_BASE_URL = "https://xpjs.asia/"
node scripts/smoke-frontend-render.mjs
```

For approval or timesheet workflow changes, also run the withdraw smoke against the appropriate database environment. On production, run it through the database container only when the change is ready for a production smoke:

```bash
docker exec -i approval-postgres psql -U psa_admin -d psa < /opt/approval-app/app/scripts/smoke-timesheet-withdraw.sql
```

## Commit, Tag, And GitHub Release

Commit only intentional changes:

```powershell
git status --short
git add <files>
git commit -m "release: V0.16.48"
```

Create and push the tag:

```powershell
git tag -a V0.16.48 -m "V0.16.48"
git push origin main --tags
```

Create the GitHub release:

```powershell
gh release create V0.16.48 --repo RCHui000/attendance-module --title "V0.16.48" --notes "<release notes>"
```

After deployment, edit the release notes if needed to include production verification results:

```powershell
gh release edit V0.16.48 --repo RCHui000/attendance-module --notes-file <notes-file>
```

## Package And Upload

Create a source archive from the tag and a separate prebuilt frontend archive:

```powershell
$version = "V0.16.48" # replace
$archive = Join-Path $env:TEMP "attendance-module-$version.tar.gz"
$distArchive = Join-Path $env:TEMP "attendance-module-dist-$version.tar.gz"

git archive --format=tar.gz --output=$archive $version
tar -czf $distArchive -C frontend dist

scp -i <SSH_KEY_PATH> -o StrictHostKeyChecking=no -o UserKnownHostsFile=NUL $archive <SSH_TARGET>:/tmp/attendance-module-$version.tar.gz
scp -i <SSH_KEY_PATH> -o StrictHostKeyChecking=no -o UserKnownHostsFile=NUL $distArchive <SSH_TARGET>:/tmp/attendance-module-dist-$version.tar.gz
```

## Server Deploy

Run this from local PowerShell after replacing the version:

```powershell
ssh -i <SSH_KEY_PATH> -o StrictHostKeyChecking=no -o UserKnownHostsFile=NUL <SSH_TARGET> @'
set -euo pipefail

version="V0.16.48"
stamp=$(date +%Y%m%d-%H%M%S)

tar -czf "/opt/approval-app/backups/app-pre-${version}-${stamp}.tgz" -C /opt/approval-app app
cp -p /opt/approval-app/env/production.env "/opt/approval-app/backups/production.env-pre-${version}-${stamp}"

tar -xzf "/tmp/attendance-module-${version}.tar.gz" -C /opt/approval-app/app
rm -rf /opt/approval-app/app/frontend/dist
tar -xzf "/tmp/attendance-module-dist-${version}.tar.gz" -C /opt/approval-app/app/frontend

sed -i "s/^APP_IMAGE_TAG=.*/APP_IMAGE_TAG=${version}/" /opt/approval-app/env/production.env
sed -i "s/^IMAGE_TAG=.*/IMAGE_TAG=${version}/" /opt/approval-app/env/production.env
sed -i "s/^VITE_APP_VERSION=.*/VITE_APP_VERSION=${version}/" /opt/approval-app/env/production.env
printf '%s\n' "$version" > /opt/approval-app/app/.current-version

cd /opt/approval-app/app
DOCKER_BUILDKIT=0 COMPOSE_DOCKER_CLI_BUILD=0 docker compose --env-file /opt/approval-app/env/production.env -f docker-compose.aliyun.yml build app
docker compose --env-file /opt/approval-app/env/production.env -f docker-compose.aliyun.yml up -d app nginx
docker compose --env-file /opt/approval-app/env/production.env -f docker-compose.aliyun.yml ps app nginx
'@
```

Build only the `app` service. A full `docker compose build` can trigger Docker Hub metadata fetches for base services and fail because of network timeouts. Use the old Docker builder flags shown above for the same reason.

## Post-Deploy Checks

Run the server pre-deploy gate with the expected version:

```powershell
ssh -i <SSH_KEY_PATH> -o StrictHostKeyChecking=no -o UserKnownHostsFile=NUL <SSH_TARGET> "cd /opt/approval-app/app && EXPECTED_VERSION=V0.16.48 bash deploy/scripts/pre-deploy-check.sh"
```

Run the frontend render smoke from local:

```powershell
$env:EXPECTED_VERSION = "V0.16.48"
$env:E2E_BASE_URL = "https://xpjs.asia/"
node scripts/smoke-frontend-render.mjs
```

For permission changes, confirm function grants:

```powershell
ssh -i <SSH_KEY_PATH> -o StrictHostKeyChecking=no -o UserKnownHostsFile=NUL <SSH_TARGET> "cd /opt/approval-app/app && docker exec -i approval-postgres psql -U psa_admin -d psa < scripts/assert-function-grants.sql"
```

For approval or timesheet changes, run the withdraw smoke:

```powershell
ssh -i <SSH_KEY_PATH> -o StrictHostKeyChecking=no -o UserKnownHostsFile=NUL <SSH_TARGET> "cd /opt/approval-app/app && docker exec -i approval-postgres psql -U psa_admin -d psa < scripts/smoke-timesheet-withdraw.sql"
```

Expected healthy signals:

- `approval-app` is `Up` and `healthy`;
- `approval-nginx` is `Up`;
- `pre-deploy-check.sh` passes;
- frontend smoke sees rendered text and the expected `VITE_APP_VERSION`;
- no blank page in browser.

## Rollback

Prefer rolling back to a previous image tag first:

```bash
cd /opt/approval-app/app
sed -i "s/^APP_IMAGE_TAG=.*/APP_IMAGE_TAG=V0.16.47/" /opt/approval-app/env/production.env
sed -i "s/^IMAGE_TAG=.*/IMAGE_TAG=V0.16.47/" /opt/approval-app/env/production.env
sed -i "s/^VITE_APP_VERSION=.*/VITE_APP_VERSION=V0.16.47/" /opt/approval-app/env/production.env
docker compose --env-file /opt/approval-app/env/production.env -f docker-compose.aliyun.yml up -d app nginx
```

Restore the backed-up app directory only if the code overlay itself must be reverted. Before any destructive restore, verify the target path is exactly `/opt/approval-app/app`.

## Known Pitfalls

- Blank frontend page usually means `frontend/dist` was built without the production `VITE_SUPABASE_ANON_KEY` or other required `VITE_*` variables.
- The server currently has Docker but no Node/npm, so do not rely on server-side frontend builds.
- Avoid full-service Docker builds on the server unless necessary; build `app` only.
- The server app directory is not a git checkout.
- Do not leak production env values into logs, release notes, or final agent responses.
- If migration execution behaves unexpectedly, inspect the migration ledger before rerunning old migrations.
- `CLOUD_DEPLOY_CHECKLIST.md` may contain encoding issues in this workspace; prefer this runbook as the current handoff source.

## Agent Handoff Checklist

Before handing off a release/deploy task, report:

- target version and commit SHA;
- whether `frontend/dist` was built with production `VITE_*`;
- GitHub release URL;
- server deploy command outcome;
- container health from `docker compose ps`;
- post-deploy smoke results;
- rollback backup path and previous version.
