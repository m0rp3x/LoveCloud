#requires -Version 7.0
[CmdletBinding()]
param([string]$InstallerPath=(Join-Path $PSScriptRoot '../scripts/init.ps1'))
$ErrorActionPreference='Stop'
$probe=Join-Path ([IO.Path]::GetTempPath()) ('lovecloud-installer-fixture-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path "$probe/scripts" -Force | Out-Null
Copy-Item -LiteralPath $InstallerPath -Destination "$probe/scripts/init.ps1"
'services: {}' | Set-Content "$probe/compose.yaml"
'services: {}' | Set-Content "$probe/custom.yaml"
@('APP_ORIGIN="http://localhost:4321"','COMPOSE_PROJECT_NAME=lc000-fixture','CUSTOM_LITERAL=$(throw "dotenv executed")') | Set-Content "$probe/.env"
$global:fixtureDockerCalls=[Collections.Generic.List[string]]::new()
function global:docker {
    $global:fixtureDockerCalls.Add(($args -join ' '))
    $global:LASTEXITCODE=0
    if(($args -join ' ') -match 'exec.*wget'){return '{"required":true}'}
}
function Assert([bool]$Value,[string]$Message){if(-not $Value){throw $Message}}
try {
    $output=(& "$probe/scripts/init.ps1" -QuietSecrets -ComposeFile @('compose.yaml','custom.yaml') 6>&1 | Out-String)
    Assert ($output -notmatch '#token=') 'Quiet mode disclosed setup link.'
    $token=Get-Content "$probe/.secrets/setup_token" -Raw
    $password=Get-Content "$probe/.secrets/database_password" -Raw
    Assert ($token.Trim() -match '^[a-f0-9]{64}$') 'Setup token entropy/encoding.'
    & "$probe/scripts/init.ps1" -QuietSecrets *> $null
    Assert ((Get-Content "$probe/.secrets/setup_token" -Raw) -eq $token) 'Rerun changed token.'
    Assert ((Get-Content "$probe/.secrets/database_password" -Raw) -eq $password) 'Rerun changed database password.'
    $settings=Get-Content "$probe/.env" -Raw
    Assert ($settings -match "COMPOSE_PROJECT_NAME='lc000-fixture'") 'Project not persisted.'
    Assert ($settings -match 'COMPOSE_FILE=.*compose.yaml.*custom.yaml') 'Override not persisted.'
    & "$probe/scripts/init.ps1" -QuietSecrets -ResetSetupToken *> $null
    Assert ((Get-Content "$probe/.secrets/setup_token" -Raw) -ne $token) 'Explicit token rotation failed.'
    & "$probe/scripts/init.ps1" -QuietSecrets -Origin 'https://lovecloud.example' *> $null
    & "$probe/scripts/init.ps1" -QuietSecrets *> $null
    $settings=Get-Content "$probe/.env" -Raw
    Assert ($settings -match "APP_ORIGIN='https://lovecloud.example'") 'HTTPS origin not retained.'
    Assert ($settings -match "SECURE_COOKIES='true'") 'HTTPS secure cookies not retained.'
    & "$probe/scripts/init.ps1" -QuietSecrets -Start *> $null
    Assert (($global:fixtureDockerCalls | Where-Object {$_ -match 'pull$'}).Count -gt 0) 'Default installer did not pull.'
    Assert (($global:fixtureDockerCalls | Where-Object {$_ -match 'up -d --no-build$'}).Count -gt 0) 'Default installer did not use --no-build.'
    Assert (($global:fixtureDockerCalls | Where-Object {$_ -match ' build$'}).Count -eq 0) 'Unexpected source build.'
    Move-Item -LiteralPath "$probe/.secrets/database_password" -Destination "$probe/saved-password"
    $failed=$false;try{& "$probe/scripts/init.ps1" -QuietSecrets *> $null}catch{$failed=$_.Exception.Message -match 'missing|required|restore'}
    Assert $failed 'Lost existing secret did not fail with recovery instructions.'
    Assert (-not (Test-Path "$probe/.secrets/database_password")) 'Lost secret silently regenerated.'
    Write-Host 'PASS PowerShell installer fixtures: real filesystem/secrets/settings, literal dotenv, idempotence/reset, pull/no-build, missing-secret refusal (Docker mocked).'
}finally{
    Remove-Item Function:/docker
    # Synthetic directory is deliberately retained for inspection; no production paths.
}
