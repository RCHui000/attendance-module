$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$reviewDesktop = Get-Content -LiteralPath (Join-Path $root "frontend/src/pages/review/ReviewDesktop.tsx") -Raw
$approvalFlowConfig = Get-Content -LiteralPath (Join-Path $root "frontend/src/components/review/ApprovalFlowConfig.tsx") -Raw
$api = Get-Content -LiteralPath (Join-Path $root "frontend/src/lib/api.ts") -Raw
$migrationFiles = Get-ChildItem -LiteralPath (Join-Path $root "supabase-psa/migrations") -Filter "*.sql" |
  Sort-Object Name |
  Select-Object -ExpandProperty FullName
$migrations = ($migrationFiles | ForEach-Object { Get-Content -LiteralPath $_ -Raw }) -join "`n"

if ($reviewDesktop -match "isAdmin\s*\? \[\{ value:\s*`"templates`"") {
  throw "ReviewDesktop must not gate the approval-flow config tab with isAdmin."
}

if ($reviewDesktop -notmatch "canAccess\(`"approval_config`",\s*`"read`"\)") {
  throw "ReviewDesktop must gate the approval-flow config tab with approval_config:read."
}

if ($reviewDesktop -notmatch "canAccess\(`"approval_config`",\s*`"write`"\)") {
  throw "ReviewDesktop must compute approval_config:write for editor capability."
}

if ($approvalFlowConfig -notmatch "canWrite") {
  throw "ApprovalFlowConfig must accept a canWrite/read-only capability."
}

if ($approvalFlowConfig -notmatch "disabled=\{[^}]*!canWrite") {
  throw "ApprovalFlowConfig inputs and save controls must be disabled without approval_config:write."
}

if ($api -notmatch "currentUserCanAccessResource\(`"approval_config`",\s*`"read`"\)") {
  throw "/api/approval-templates must check approval_config:read before loading templates."
}

if ($api -notmatch "currentUserCanAccessResource\(`"approval_config`",\s*`"write`"\)") {
  throw "/api/approval-templates/save must check approval_config:write before saving templates."
}

if ($migrations -notmatch "approval_config") {
  throw "A migration must add the approval_config permission resource and DB policy changes."
}

if ($migrations -notmatch "current_user_can_access_resource\('approval_config',\s*'write'\)") {
  throw "psa_save_approval_template must use approval_config:write."
}

Write-Host "Approval config RBAC assertion passed."
