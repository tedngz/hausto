# Sets runtime secrets on the self-owned Supabase project for migrated edge functions.
# Usage:  .\set-new-project-secrets.ps1 <project-ref>
[CmdletBinding()]
param(
    [string]$ProjectRef = "joxxcvxbsjedzkfpmkfc"
)

$ErrorActionPreference = "Stop"

$Secrets = @(
    "LOVABLE_DB_URL",
    "LOVABLE_DB_SERVICE_ROLE_KEY",
    "LOVABLE_DB_ANON_KEY",
    "OPENAI_API_KEY",
    "UPSTASH_REDIS_REST_URL",
    "UPSTASH_REDIS_REST_TOKEN"
)

Write-Host "Setting secrets on project: $ProjectRef"
Write-Host "Press <enter> with an empty value to SKIP an individual secret."
Write-Host ""

foreach ($name in $Secrets) {
    $secure = Read-Host -AsSecureString -Prompt "  $name"
    $bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try {
        $value = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
    } finally {
        [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    }

    if ([string]::IsNullOrEmpty($value)) {
        Write-Host "    -> skipped"
        continue
    }

    # Pass as KEY=VALUE positional arg (matches the bash script behavior).
    & supabase secrets set --project-ref $ProjectRef "$name=$value" | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Write-Host "    -> FAILED (exit $LASTEXITCODE)" -ForegroundColor Red
        exit $LASTEXITCODE
    }
    Write-Host "    -> set"
}

Write-Host ""
Write-Host "Done. Verify with:  supabase secrets list --project-ref $ProjectRef"
