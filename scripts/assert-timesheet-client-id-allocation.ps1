$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$apiPath = Join-Path $repoRoot "frontend/src/lib/api.ts"
$source = Get-Content -Raw -LiteralPath $apiPath

if ($source -match 'nextId\("timesheets"\)') {
  Write-Error "Timesheet creation must not allocate ids in the browser. Let PostgreSQL assign timesheets.id."
}

if ($source -match 'JSON\.stringify\(\s*\[\s*\{\s*id\s*,\s*user_id') {
  Write-Error "Timesheet insert payload still includes an explicit id."
}

Write-Output "PASS: timesheet creation relies on the database default id sequence."
