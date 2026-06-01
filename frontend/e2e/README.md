# Production E2E smoke tests

These Playwright checks exercise the deployed app at `http://192.168.2.100:8767/`.

## Run

```powershell
cd "C:\workfile\code project\考勤统计模块\frontend"
npm run test:e2e:prod:edge
```

Use Chromium instead of installed Microsoft Edge:

```powershell
npx playwright install chromium
npm run test:e2e:prod
```

## Environment variables

- `E2E_BASE_URL`: target URL, defaults to `http://192.168.2.100:8767/`
- `E2E_ADMIN_LOGIN`: admin login, defaults to `jss`
- `E2E_ADMIN_PASSWORD`: admin password, defaults to `123456`
- `E2E_EMPLOYEE_LOGIN`: optional normal employee login. If omitted, the test queries employee metadata after admin login.
- `E2E_EMPLOYEE_PASSWORD`: normal employee password, defaults to `123456`

If the normal employee test cannot discover or authenticate an employee account, create one in the environment and rerun with `E2E_EMPLOYEE_LOGIN` and `E2E_EMPLOYEE_PASSWORD`.
