$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$api = Get-Content -LiteralPath (Join-Path $root "frontend/src/lib/api.ts") -Raw
$reportHooks = Get-Content -LiteralPath (Join-Path $root "frontend/src/hooks/useReport.ts") -Raw
$employeeHooks = Get-Content -LiteralPath (Join-Path $root "frontend/src/hooks/useEmployees.ts") -Raw
$approvalHooks = Get-Content -LiteralPath (Join-Path $root "frontend/src/hooks/useApprovals.ts") -Raw
$grantAssert = Get-Content -LiteralPath (Join-Path $root "scripts/assert-function-grants.sql") -Raw

if ($api -match "id:\s*Date\.now\(\)") {
  throw "frontend/src/lib/api.ts must not generate timesheet/overtime row ids with Date.now()."
}

if ($api -match "nextId\(") {
  throw "frontend/src/lib/api.ts must not use client-side max(id)+1 helpers."
}

if ($api -notmatch "/rpc/psa_save_timesheet") {
  throw "frontend timesheet save must call /rpc/psa_save_timesheet."
}

if ($api -notmatch "/rpc/psa_save_organization") {
  throw "frontend organization save must call /rpc/psa_save_organization."
}

if (($reportHooks + $employeeHooks + $approvalHooks) -match "refetchInterval") {
  throw "Configuration/review hooks must not use refetchInterval polling."
}

if ($grantAssert -match "public_schema_functions\s*<>|authenticated_execute\s*<>|anon_execute\s*<>") {
  throw "scripts/assert-function-grants.sql must not hard-code grant/function counts."
}

Write-Host "Backend ownership refactor assertion passed."
