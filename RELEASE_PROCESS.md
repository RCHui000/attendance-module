# Release Process

Use this process when the product owner says the current work is ready for a GitHub release and cloud deployment.

## Standard Flow

1. Confirm the target version from the latest `V*` tag and choose the next patch version unless the change clearly needs a minor version.
2. Review the working tree and include only intentional changes.
3. Update or add `release-manifest/<version>.json`.
4. Run local checks:
   - `git diff --check`
   - `npm --prefix frontend run build` with `VITE_APP_VERSION=<version>`
5. Run production safety gates before deployment:
   - `deploy/scripts/verify-jwt-keys.sh`
   - `deploy/scripts/pre-deploy-check.sh`
   - `scripts/assert-function-grants.sql` when function grants changed or need confirmation
6. Commit the release changes to `main`.
7. Create and push tag `<version>`.
8. Create the GitHub release from the pushed tag.
9. Deploy on the cloud host with:
   - `APP_IMAGE_TAG=<version> VITE_APP_VERSION=<version> bash deploy/scripts/deploy-aliyun.sh`
   - If the cloud host has no Node/npm, build locally, sync `frontend/dist`, then run `SKIP_FRONTEND_BUILD=1 APP_IMAGE_TAG=<version> VITE_APP_VERSION=<version> bash deploy/scripts/deploy-aliyun.sh`
10. Run post-deploy checks:
   - `EXPECTED_VERSION=<version> deploy/scripts/pre-deploy-check.sh`
   - `scripts/smoke-timesheet-withdraw.sql` for approval/timesheet related changes

## Automation Boundary

Do not use a local Git hook for production releases. Hooks are machine-local, easy to bypass, and cannot express the product decision that a set of changes is ready to ship.

Prefer an explicit release command or GitHub Actions `workflow_dispatch` later. A tag-push workflow can build or package artifacts, but production deploy should remain an intentional step with visible logs and rollback context.

## Current Production Target

- Repository: `RCHui000/attendance-module`
- Cloud app directory: `/opt/approval-app/app`
- Cloud deploy script: `deploy/scripts/deploy-aliyun.sh`
- Cloud pre-deploy gate: `deploy/scripts/pre-deploy-check.sh`
