# Deploys one or more edge functions to the self-owned Supabase project.
# Usage:  .\deploy.ps1 <project-ref> <function-name> [<function-name> ...]
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string]$ProjectRef,

    [Parameter(Mandatory = $true, Position = 1, ValueFromRemainingArguments = $true)]
    [string[]]$Functions
)

$ErrorActionPreference = "Stop"

# Resolve repo root (this script lives in scripts/migrate-functions/).
$Root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
Set-Location $Root

foreach ($fn in $Functions) {
    $fnPath = Join-Path "supabase\functions" $fn
    if (-not (Test-Path $fnPath -PathType Container)) {
        Write-Host "x supabase/functions/$fn does not exist" -ForegroundColor Red
        exit 1
    }
    Write-Host "-> Deploying $fn to $ProjectRef"
    # --no-verify-jwt: functions handle JWT verification in-code against the
    # Lovable-managed auth (different project from the function host).
    & supabase functions deploy $fn --project-ref $ProjectRef --no-verify-jwt
    if ($LASTEXITCODE -ne 0) {
        Write-Host "x Deploy failed for $fn (exit $LASTEXITCODE)" -ForegroundColor Red
        exit $LASTEXITCODE
    }
}

Write-Host ""
Write-Host "Done. Logs:  supabase functions logs <name> --project-ref $ProjectRef --tail"
