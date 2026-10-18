[CmdletBinding()]
param([switch]$Start,[switch]$QuietSecrets,[switch]$ResetSetupToken,[string]$Origin='')
$ErrorActionPreference = 'Stop'
$workspacePath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$secretDirectory = Join-Path $workspacePath '.secrets'
New-Item -ItemType Directory -Force -Path $secretDirectory | Out-Null
$utf8 = [Text.UTF8Encoding]::new($false)
function New-RandomSecret([switch]$Hex) {
    $secretBytes = New-Object byte[] 32
    $secretGenerator = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $secretGenerator.GetBytes($secretBytes) } finally { $secretGenerator.Dispose() }
    if ($Hex) { return [BitConverter]::ToString($secretBytes).Replace('-','').ToLowerInvariant() }
    return [Convert]::ToBase64String($secretBytes)
}
function Write-NewSecret([string]$Name) {
    $secretFile = Join-Path $secretDirectory $Name
    if (-not (Test-Path -LiteralPath $secretFile)) {
        [IO.File]::WriteAllText($secretFile, (New-RandomSecret), $utf8)
    }
    return $secretFile
}
function Get-InstallSetting([string]$Name) {
    $settingValue = [Environment]::GetEnvironmentVariable($Name)
    if ($settingValue) { return $settingValue }
    $envPath = Join-Path $workspacePath '.env'
    if (Test-Path -LiteralPath $envPath) {
        foreach ($line in [IO.File]::ReadAllLines($envPath)) {
            if ($line -match ('^\s*'+[regex]::Escape($Name)+'\s*=(.*)$')) {
                return $Matches[1].Trim().Trim([char[]]@('"',"'"))
            }
        }
    }
    return ''
}
$databasePasswordPath = Write-NewSecret 'database_password'
$bootstrapPasswordPath = Write-NewSecret 'bootstrap_password'
$databaseConnectionPath = Join-Path $secretDirectory 'database_connection'
if (-not (Test-Path -LiteralPath $databaseConnectionPath)) {
    $databaseSecret = [IO.File]::ReadAllText($databasePasswordPath).Trim()
    [IO.File]::WriteAllText($databaseConnectionPath, "Host=db;Port=5432;Database=lovecloud;Username=lovecloud;Password=$databaseSecret;Include Error Detail=false", $utf8)
    $databaseSecret = $null
}
$setupTokenPath = Join-Path $secretDirectory 'setup_token'
if ($ResetSetupToken -or -not (Test-Path -LiteralPath $setupTokenPath)) {
    [IO.File]::WriteAllText($setupTokenPath,(New-RandomSecret -Hex),$utf8)
}
$publicOrigin = $Origin
if (-not $publicOrigin) { $publicOrigin = Get-InstallSetting 'APP_ORIGIN' }
if (-not $publicOrigin) {
    $publicPort = Get-InstallSetting 'LOVE_CLOUD_PORT'
    if (-not $publicPort) { $publicPort = '3211' }
    $publicOrigin = 'http://localhost:'+$publicPort
}
$publicUri = $null
if (-not [Uri]::TryCreate($publicOrigin,[UriKind]::Absolute,[ref]$publicUri) -or $publicUri.Scheme -notin @('http','https') -or $publicUri.AbsolutePath -ne '/' -or $publicUri.Query -or $publicUri.Fragment -or $publicUri.UserInfo) {
    throw 'APP_ORIGIN must be an absolute http(s) origin without a path, query, fragment or username.'
}
$publicOrigin = $publicOrigin.TrimEnd('/')
$setupLink = $publicOrigin+'/setup#token='+[IO.File]::ReadAllText($setupTokenPath).Trim()
$setupLinkPath = Join-Path $secretDirectory 'setup-link.txt'
[IO.File]::WriteAllText($setupLinkPath,$setupLink+[Environment]::NewLine,$utf8)
if ($env:OS -eq 'Windows_NT') {
    $secretIdentity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
    foreach ($secretFile in Get-ChildItem -LiteralPath $secretDirectory -File) {
        & icacls.exe $secretFile.FullName /inheritance:r /grant:r ($secretIdentity + ':(F)') | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'Could not restrict installation secret permissions.' }
    }
} else {
    & chmod 700 $secretDirectory
    Get-ChildItem -LiteralPath $secretDirectory -File | ForEach-Object { & chmod 600 $_.FullName }
    # Compose bind-mounts these individual files with their host permissions.
    # The private 0700 parent blocks other host users; containers need read access.
    foreach ($mountedSecret in @('database_password','database_connection','bootstrap_password','setup_token')) {
        & chmod 644 (Join-Path $secretDirectory $mountedSecret)
    }
}
$alreadyConfigured = $false
if ($Start) {
    $previousOrigin = $env:APP_ORIGIN
    $previousSecureCookies = $env:SECURE_COOKIES
    $env:APP_ORIGIN = $publicOrigin
    $env:SECURE_COOKIES = if ($publicUri.Scheme -eq 'https') { 'true' } else { 'false' }
    Push-Location $workspacePath
    try {
        $composeArgs = @('compose')
        if ($publicUri.Scheme -eq 'https' -and (Get-InstallSetting 'LOVE_CLOUD_DOMAIN')) {
            $composeArgs += @('-f','compose.yaml','-f','compose.https.yaml')
        }
        & docker @composeArgs up -d --build
        if ($LASTEXITCODE -ne 0) { throw 'Docker Compose failed.' }
        $ready = $false
        for ($attempt=0;$attempt -lt 45;$attempt++) {
            & docker @composeArgs exec -T gateway wget -q -O /dev/null http://127.0.0.1/api/v1/setup/status 2>$null
            if ($LASTEXITCODE -eq 0) { $ready=$true;break }
            Start-Sleep -Seconds 1
        }
        if (-not $ready) { throw 'Services are not ready. Check docker compose logs api gateway.' }
        $setupStatus = & docker @composeArgs exec -T gateway wget -q -O - http://127.0.0.1/api/v1/setup/status 2>$null
        if ($LASTEXITCODE -eq 0) { $alreadyConfigured = ($setupStatus | ConvertFrom-Json).required -eq $false }
    } finally {
        Pop-Location
        $env:APP_ORIGIN = $previousOrigin
        $env:SECURE_COOKIES = $previousSecureCookies
    }
}
Write-Host ('Cloud address: '+$publicOrigin)
if ($alreadyConfigured) {
    Write-Host 'Setup is already complete. Existing accounts and settings were preserved.'
} else {
    Write-Host 'Open the one-time setup link to choose language, accounts, avatars and a theme.'
    if (-not $QuietSecrets) { Write-Host ('Setup link: '+$setupLink) }
    Write-Host ('Private link file: '+$setupLinkPath)
    Write-Host 'The link cannot reopen a completed installation. Keep it private.'
}
if (-not $Start) { Write-Host 'Start services: docker compose up -d --build' }
$setupLink = $null
