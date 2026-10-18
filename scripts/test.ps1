#requires -Version 7.0
[CmdletBinding()]
param([switch]$KeepRunning)
$ErrorActionPreference = 'Stop'
$workspacePath = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Push-Location $workspacePath
try {
    & (Join-Path $PSScriptRoot 'init.ps1') -QuietSecrets
    New-Item -ItemType Directory -Force -Path '.artifacts' | Out-Null
    $testEnvPath = Join-Path $workspacePath '.artifacts/integration.env'
    [System.IO.File]::WriteAllText($testEnvPath, "LOVE_CLOUD_BIND=127.0.0.1`nLOVE_CLOUD_PORT=3212`nAPP_ORIGIN=http://localhost:3212`nSECURE_COOKIES=false`n", [System.Text.UTF8Encoding]::new($false))
    # Fixed isolated project: these volumes contain only synthetic acceptance data.
    & docker compose -p lovecloud-integration --env-file $testEnvPath down -v --remove-orphans
    if ($LASTEXITCODE -ne 0) { throw 'Could not reset the isolated integration project.' }
    & docker compose -p lovecloud-integration --env-file $testEnvPath up -d --no-build
    if ($LASTEXITCODE -ne 0) { throw 'Build images first using docker compose build.' }
    $ready = $false
    for ($attempt = 0; $attempt -lt 60; $attempt++) {
        try {
            $healthResponse = Invoke-WebRequest -Uri 'http://127.0.0.1:3212/health' -NoProxy -UseBasicParsing -TimeoutSec 5
            if ($healthResponse.StatusCode -eq 200) { $ready = $true; break }
        } catch { }
        Start-Sleep -Seconds 1
    }
    if (-not $ready) { throw 'Integration API did not become healthy.' }
    & node 'tests/integration.mjs'
    if ($LASTEXITCODE -ne 0) { throw 'Acceptance tests failed; see .artifacts/integration-results.json.' }
    & docker compose -p lovecloud-integration --env-file $testEnvPath up -d --force-recreate db api
    if ($LASTEXITCODE -ne 0) { throw 'Recreation failed.' }
    $env:LOVECLOUD_VERIFY_PERSISTENCE = '1'
    & node 'tests/persistence.mjs'
    if ($LASTEXITCODE -ne 0) { throw 'Persistence verification failed.' }
    Write-Host 'HTTP, SignalR, permissions, TOTP and persistent volumes: PASS.'
} finally {
    if (-not $KeepRunning -and (Test-Path -LiteralPath '.artifacts/integration.env')) {
        & docker compose -p lovecloud-integration --env-file '.artifacts/integration.env' stop
    }
    Pop-Location
}
