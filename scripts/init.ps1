[CmdletBinding()]
param(
    [switch]$Start,[switch]$QuietSecrets,[switch]$ResetSetupToken,[switch]$Build,
    [string]$Origin='', [Alias('p')][string]$ProjectName='', [string[]]$ComposeFile=@()
)
$ErrorActionPreference='Stop'
$workspacePath=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$secretDirectory=Join-Path $workspacePath '.secrets'
$envPath=Join-Path $workspacePath '.env'
$utf8=[Text.UTF8Encoding]::new($false)
$isWindowsHost=$env:OS -eq 'Windows_NT'
$separator=if ($isWindowsHost) {';'} else {':'}
function Read-SettingFile([string]$Name,[string]$Path) {
    $value=''
    if (Test-Path -LiteralPath $Path) {
        foreach ($line in [IO.File]::ReadAllLines($Path)) {
            if ($line -match ('^\s*'+[regex]::Escape($Name)+'\s*=(.*)$')) { $value=$Matches[1].Trim().Trim([char[]]@('"',"'")) }
        }
    }
    return $value
}
function Get-InstallSetting([string]$Name) {
    $value=[Environment]::GetEnvironmentVariable($Name)
    if (-not $value) { $value=Read-SettingFile $Name $envPath }
    if (-not $value) { $value=Read-SettingFile $Name (Join-Path $workspacePath 'release.env') }
    return $value
}
function Save-Setting([string]$Name,[string]$Value) {
    if ($Value.Contains("'") -or $Value.Contains("`r") -or $Value.Contains("`n")) { throw "Unsupported quote/newline in setting $Name" }
    $lines=@()
    if (Test-Path -LiteralPath $envPath) { $lines=@([IO.File]::ReadAllLines($envPath) | Where-Object {$_ -notmatch ('^\s*'+[regex]::Escape($Name)+'\s*=')}) }
    [IO.File]::WriteAllLines($envPath,($lines+($Name+"='"+$Value+"'")),$utf8)
}
function Invoke-Docker([string[]]$DockerArguments) {
    & docker @DockerArguments
    if ($LASTEXITCODE -ne 0) { throw 'Docker command failed. Check docker info, docker compose ps, and docker compose logs --tail=100. Keep diagnostic logs private and never share .secrets.' }
}
function New-RandomSecret([switch]$Hex) {
    $bytes=New-Object byte[] 32; $rng=[Security.Cryptography.RandomNumberGenerator]::Create()
    try {$rng.GetBytes($bytes)} finally {$rng.Dispose()}
    if ($Hex) {return [BitConverter]::ToString($bytes).Replace('-','').ToLowerInvariant()}
    return [Convert]::ToBase64String($bytes)
}
if (-not $ProjectName) {$ProjectName=Get-InstallSetting 'COMPOSE_PROJECT_NAME'}
if (-not $ProjectName) {$ProjectName='lovecloud'}
if ($ProjectName -notmatch '^[a-z0-9][a-z0-9_-]*$') {throw 'Invalid Compose project name.'}
if (-not $Origin) {$Origin=Get-InstallSetting 'APP_ORIGIN'}
$publicPort=Get-InstallSetting 'LOVE_CLOUD_PORT'
if (-not $publicPort) {$publicPort='3211'}
if (-not $Origin) {$Origin='http://localhost:'+$publicPort}
$publicUri=$null
if (-not [Uri]::TryCreate($Origin,[UriKind]::Absolute,[ref]$publicUri) -or $publicUri.Scheme -notin @('http','https') -or $publicUri.AbsolutePath -ne '/' -or $publicUri.Query -or $publicUri.Fragment -or $publicUri.UserInfo) {throw 'APP_ORIGIN must be an absolute http(s) origin without a path, query, fragment or username.'}
$Origin=$Origin.TrimEnd('/')
$secure=if ($publicUri.Scheme -eq 'https') {'true'} else {'false'}
if (-not $ComposeFile.Count) {
    $filesSetting=Get-InstallSetting 'COMPOSE_FILE'
    if ($filesSetting) {
        $savedSeparator=Get-InstallSetting 'COMPOSE_PATH_SEPARATOR'
        if (-not $savedSeparator) {$savedSeparator=$separator}
        $ComposeFile=$filesSetting.Split([string[]]@($savedSeparator),[StringSplitOptions]::RemoveEmptyEntries)
    } else {
        $ComposeFile=@('compose.yaml')
        if (Test-Path -LiteralPath (Join-Path $workspacePath 'compose.images.yaml')) {$ComposeFile+='compose.images.yaml'}
        if ($secure -eq 'true' -and (Get-InstallSetting 'LOVE_CLOUD_DOMAIN')) {$ComposeFile+='compose.https.yaml'}
    }
}
if ($Build) {
    if (-not (Test-Path (Join-Path $workspacePath 'backend')) -or -not (Test-Path (Join-Path $workspacePath 'frontend'))) {throw 'Source build requires a source checkout, not an installation archive.'}
    if ('compose.dev.yaml' -notin $ComposeFile) {$ComposeFile+='compose.dev.yaml'}
}
foreach ($file in $ComposeFile) {if (-not (Test-Path -LiteralPath (Join-Path $workspacePath $file))) {throw "Missing Compose file: $file"}}
Push-Location $workspacePath
$previousEnvironment=@{}
try {
    if ($Start) {
        if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {throw 'Install Docker Engine/Desktop and Docker Compose v2 first.'}
        Invoke-Docker @('compose','version')
        & docker info *> $null
        if ($LASTEXITCODE -ne 0) {throw 'Docker unavailable. Start Docker and check permissions (docker info).'}
    }
    $required=@('database_password','database_connection','bootstrap_password','setup_token')
    $existing=(Get-InstallSetting 'LOVECLOUD_INITIALIZED') -eq 'true'
    foreach ($name in $required) {if (Test-Path -LiteralPath (Join-Path $secretDirectory $name)) {$existing=$true}}
    if (Get-Command docker -ErrorAction SilentlyContinue) {
        $volumes=& docker volume ls -q --filter "label=com.docker.compose.project=$ProjectName" 2>$null
        if ($LASTEXITCODE -eq 0 -and $volumes) {$existing=$true}
    }
    if ($existing) {
        $missing=@($required | Where-Object { -not ($_ -eq 'setup_token' -and $ResetSetupToken) -and (-not (Test-Path -LiteralPath (Join-Path $secretDirectory $_)) -or (Get-Item -LiteralPath (Join-Path $secretDirectory $_)).Length -eq 0) })
        if ($missing.Count) {throw ('Existing installation is missing required secrets: '+($missing -join ', ')+'. STOP: restore .secrets from the matching encrypted backup. Do not generate a new database password or remove volumes. See docs/OPERATIONS.md.')}
    }
    New-Item -ItemType Directory -Force -Path $secretDirectory | Out-Null
    foreach ($name in @('database_password','bootstrap_password')) {
        $path=Join-Path $secretDirectory $name
        if (-not (Test-Path -LiteralPath $path)) {[IO.File]::WriteAllText($path,(New-RandomSecret),$utf8)}
    }
    $connectionPath=Join-Path $secretDirectory 'database_connection'
    if (-not (Test-Path -LiteralPath $connectionPath)) {
        $password=[IO.File]::ReadAllText((Join-Path $secretDirectory 'database_password')).Trim()
        [IO.File]::WriteAllText($connectionPath,"Host=db;Port=5432;Database=lovecloud;Username=lovecloud;Password=$password;Include Error Detail=false",$utf8)
        $password=$null
    }
    $tokenPath=Join-Path $secretDirectory 'setup_token'
    if ($ResetSetupToken -or -not (Test-Path -LiteralPath $tokenPath)) {[IO.File]::WriteAllText($tokenPath,(New-RandomSecret -Hex),$utf8)}
    if ($isWindowsHost) {
        $identity=[Security.Principal.WindowsIdentity]::GetCurrent().Name
        & icacls.exe $secretDirectory /inheritance:r /grant:r ($identity+':(OI)(CI)(F)') | Out-Null
        if ($LASTEXITCODE -ne 0) {throw 'Could not restrict secret directory permissions.'}
        foreach ($file in Get-ChildItem -LiteralPath $secretDirectory -File) {
            & icacls.exe $file.FullName /inheritance:r /grant:r ($identity+':(F)') | Out-Null
            if ($LASTEXITCODE -ne 0) {throw 'Could not restrict secret file permissions.'}
        }
    } else {
        & chmod 700 $secretDirectory
        foreach ($file in Get-ChildItem -LiteralPath $secretDirectory -File) {& chmod 600 $file.FullName}
        foreach ($name in $required) {& chmod 644 (Join-Path $secretDirectory $name)}
        if ($LASTEXITCODE -ne 0) {throw 'Could not set mounted secret permissions.'}
    }
    $settings=@{COMPOSE_PROJECT_NAME=$ProjectName;COMPOSE_FILE=($ComposeFile -join $separator);COMPOSE_PATH_SEPARATOR=$separator;APP_ORIGIN=$Origin;SECURE_COOKIES=$secure;LOVE_CLOUD_PORT=$publicPort;LOVECLOUD_INITIALIZED='true'}
    foreach ($name in @('LOVE_CLOUD_BIND','LOVE_CLOUD_DOMAIN','LOVE_CLOUD_REDIRECT_PORT','LOVECLOUD_BACKUP_IMAGE')) {$value=Get-InstallSetting $name; if ($value) {$settings[$name]=$value}}
    foreach ($name in $settings.Keys) {Save-Setting $name $settings[$name];$previousEnvironment[$name]=[Environment]::GetEnvironmentVariable($name);[Environment]::SetEnvironmentVariable($name,$settings[$name])}
    $setupLink=$Origin+'/setup#token='+[IO.File]::ReadAllText($tokenPath).Trim()
    $linkPath=Join-Path $secretDirectory 'setup-link.txt'
    [IO.File]::WriteAllText($linkPath,$setupLink+[Environment]::NewLine,$utf8)
    $configured=$false
    if ($Start) {
        $argsList=@('compose','--project-name',$ProjectName,'--env-file','.env')
        foreach ($file in $ComposeFile) {$argsList+=@('-f',$file)}
        if ($Build) {Invoke-Docker ($argsList+@('build'))} else {Invoke-Docker ($argsList+@('pull'))}
        Invoke-Docker ($argsList+@('up','-d','--no-build'))
        $ready=$false
        for ($attempt=0;$attempt -lt 90;$attempt++) {
            & docker @argsList exec -T gateway wget -q -O /dev/null http://127.0.0.1/api/v1/setup/status 2>$null
            if ($LASTEXITCODE -eq 0) {$ready=$true;break}
            Start-Sleep -Seconds 1
        }
        if (-not $ready) {throw 'Application not ready after 90s. Run docker compose ps and docker compose logs --tail=100 api gateway. Check mounted secret permissions and APP_ORIGIN; never share secrets.'}
        $status=& docker @argsList exec -T gateway wget -q -O - http://127.0.0.1/api/v1/setup/status
        if ($LASTEXITCODE -ne 0) {throw 'Setup readiness query failed.'}
        $configured=($status | ConvertFrom-Json).required -eq $false
    }
    Write-Host ('Cloud address: '+$Origin)
    Write-Host ('Compose project: '+$ProjectName)
    if ($configured) {Write-Host 'Setup complete. Existing accounts and settings preserved.'} else {
        Write-Host 'Open the one-time setup link to choose language, accounts, avatars and theme.'
        if (-not $QuietSecrets) {Write-Host ('Setup link: '+$setupLink)}
        Write-Host ('Private link file: '+$linkPath)
        Write-Host 'A completed installation cannot be reopened.'
    }
    if (-not $Start) {Write-Host 'Settings saved. Start with: ./scripts/init.ps1 -Start'}
    $setupLink=$null
} finally {
    foreach ($name in $previousEnvironment.Keys) {[Environment]::SetEnvironmentVariable($name,$previousEnvironment[$name])}
    Pop-Location
}
