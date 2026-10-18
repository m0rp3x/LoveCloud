#requires -Version 7.0
[CmdletBinding()]
param([switch]$KeepRunning)
$ErrorActionPreference='Stop'
$workspacePath=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Push-Location $workspacePath
try {
    & (Join-Path $PSScriptRoot 'init.ps1') -QuietSecrets
    New-Item -ItemType Directory -Force -Path '.artifacts' | Out-Null
    $testEnvPath=Join-Path $workspacePath '.artifacts/onboarding.env'
    [IO.File]::WriteAllText($testEnvPath,"LOVE_CLOUD_BIND=127.0.0.1`nLOVE_CLOUD_PORT=3213`nAPP_ORIGIN=http://localhost:3213`nSECURE_COOKIES=false`n",[Text.UTF8Encoding]::new($false))
    & docker compose -p lovecloud-onboarding --env-file $testEnvPath down -v --remove-orphans
    if ($LASTEXITCODE -ne 0) { throw 'Could not reset isolated onboarding test project.' }
    & docker compose -p lovecloud-onboarding --env-file $testEnvPath up -d --no-build
    if ($LASTEXITCODE -ne 0) { throw 'Build application images first.' }
    $ready=$false
    for($attempt=0;$attempt -lt 60;$attempt++){
        try { $health=Invoke-WebRequest -Uri 'http://127.0.0.1:3213/health' -NoProxy -UseBasicParsing -TimeoutSec 5; if($health.StatusCode -eq 200){$ready=$true;break} } catch{}
        Start-Sleep -Seconds 1
    }
    if(-not $ready){throw 'Onboarding test API did not start.'}
    & node tests/onboarding.mjs
    if($LASTEXITCODE -ne 0){throw 'Onboarding tests failed; see .artifacts/onboarding-results.json.'}
    $overridePath=Join-Path $workspacePath '.artifacts/onboarding-rotated.yaml'
    [IO.File]::WriteAllText($overridePath,"secrets:`n  setup_token:`n    file: ./.artifacts/onboarding-rotation-token`n",[Text.UTF8Encoding]::new($false))
    & docker compose -p lovecloud-onboarding --env-file $testEnvPath -f compose.yaml -f $overridePath up -d --no-deps --force-recreate api
    if($LASTEXITCODE -ne 0){throw 'Could not recreate onboarding API for restart verification.'}
    & node tests/onboarding-persistence.mjs
    if($LASTEXITCODE -ne 0){throw 'Onboarding restart verification failed.'}
} finally {
    if(-not $KeepRunning -and (Test-Path -LiteralPath '.artifacts/onboarding.env')){& docker compose -p lovecloud-onboarding --env-file '.artifacts/onboarding.env' stop}
    Pop-Location
}
