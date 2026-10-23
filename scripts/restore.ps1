[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$Repository,
    [Parameter(Mandatory)][string]$PasswordFile,
    [Parameter(Mandatory)][string]$Target,
    [Parameter(Mandatory)][string]$ProjectName,
    [string]$Origin='http://localhost:3211',
    [ValidateRange(1024,65535)][int]$Port=3211,
    [string]$Snapshot='latest'
)
$ErrorActionPreference='Stop'
if($ProjectName -notmatch '^[a-z0-9][a-z0-9_-]+$'){throw 'Specify a new lowercase project name.'}
$originUri=[Uri]$Origin
if($originUri.Scheme -notin @('http','https') -or $originUri.AbsolutePath -ne '/' -or $originUri.Query -or $originUri.Fragment){throw 'Origin must be an HTTP(S) origin.'}
$Repository=[IO.Path]::GetFullPath((Resolve-Path -LiteralPath $Repository).Path)
$PasswordFile=[IO.Path]::GetFullPath((Resolve-Path -LiteralPath $PasswordFile).Path)
$Target=[IO.Path]::GetFullPath($Target)
New-Item -ItemType Directory -Force -Path $Target | Out-Null
if(Get-ChildItem -LiteralPath $Target -Force | Select-Object -First 1){throw 'Restore target must be empty.'}
$backupImage=$env:LOVECLOUD_BACKUP_IMAGE
foreach($settings in @((Join-Path $PSScriptRoot '../.env'),(Join-Path $PSScriptRoot '../release.env'))){
    if(-not $backupImage -and (Test-Path -LiteralPath $settings)){
        $match=Get-Content -LiteralPath $settings | Where-Object {$_ -match '^LOVECLOUD_BACKUP_IMAGE='} | Select-Object -Last 1
        if($match){$backupImage=($match -split '=',2)[1].Trim('"',"'")}
    }
}
if(-not $backupImage){$backupImage='restic/restic:0.18.0'}
function Invoke-LoveCloudDocker([string[]]$Arguments){
    $output=& docker @Arguments
    if($LASTEXITCODE -ne 0){throw ('Docker operation failed: '+$Arguments[0]+'. Inspect sanitized logs before reporting.')}
    return $output
}
if(Invoke-LoveCloudDocker @('ps','-aq','--filter',"label=com.docker.compose.project=$ProjectName")){throw 'Restore project already has containers; choose a fresh name.'}
foreach($name in @('pgdata','files','keys','tls_data','tls_config','tailnet_state')){
    & docker volume inspect "${ProjectName}_restore_$name" *> $null
    if($LASTEXITCODE -eq 0){throw 'Restore volume already exists; choose a fresh project.'}
}
& docker network inspect "${ProjectName}_restore_private" *> $null
if($LASTEXITCODE -eq 0){throw 'Restore network already exists; choose a fresh project.'}
$stage=[IO.Path]::GetFullPath((Join-Path ([IO.Path]::GetTempPath()) ('lovecloud-restore-'+[guid]::NewGuid().ToString('N'))))
New-Item -ItemType Directory -Path $stage | Out-Null
if($IsWindows){$owner=[Security.Principal.WindowsIdentity]::GetCurrent().Name;& icacls $stage /inheritance:r /grant:r "${owner}:(OI)(CI)F" | Out-Null;if($LASTEXITCODE -ne 0){throw 'Cannot protect restore staging.'}}
else{& chmod 700 $stage}
Push-Location $Target
$previousEnvironment=@{}
try {
    Invoke-LoveCloudDocker @('run','--rm','--mount',"type=bind,source=$Repository,target=/repository",'--mount',"type=bind,source=$PasswordFile,target=/password,readonly",'--mount',"type=bind,source=$stage,target=/restore",$backupImage,'--repo','/repository','--password-file','/password','restore',$Snapshot,'--target','/restore')
    if(-not (Test-Path -LiteralPath "$stage/source/database/database.dump")){throw 'Snapshot has no LoveCloud database.'}
    $services=@(Get-Content -LiteralPath "$stage/source/install/backup-services.txt")
    foreach($service in $services){if($service -notin @('db','api','frontend','gateway','caddy','tailscale','')){throw 'Snapshot includes an unsupported additional service; prepare a reviewed manual restore before starting containers.'}}
    Get-ChildItem -LiteralPath "$stage/source/install" -Force | Copy-Item -Destination $Target -Recurse -Force
    if(-not $IsWindows){& chmod 700 .secrets;& chmod 644 .secrets/database_password .secrets/database_connection .secrets/bootstrap_password .secrets/setup_token}
    $files=(Get-Content backup-compose-files.txt -Raw).Trim().Split(':')
    @"
services:
  db:
    network_mode: !reset null
    networks: !override [private]
    ports: !override []
    volumes: !override
      - pgdata:/var/lib/postgresql
  api:
    network_mode: !reset null
    networks: !override [private]
    ports: !override []
    volumes: !override
      - files:/data/files
      - keys:/data/keys
  gateway:
    network_mode: !reset null
    networks: !override [private]
    ports: !override
      - "127.0.0.1:${Port}:80"
    depends_on: !override
      api:
        condition: service_started
      frontend:
        condition: service_started
    volumes: !override
      - ./ops/nginx.conf:/etc/nginx/nginx.conf:ro
  frontend:
    network_mode: !reset null
    networks: !override [private]
    ports: !override []
"@ | Set-Content -LiteralPath compose.restore.yaml -Encoding utf8NoBOM
    foreach($service in @('caddy','tailscale')){if($service -in $services){"  ${service}:`n    profiles: [restore-external-entrypoint]" | Add-Content -LiteralPath compose.restore.yaml}}
    @"
secrets:
  database_password:
    file: ./.secrets/database_password
  database_connection:
    file: ./.secrets/database_connection
  bootstrap_password:
    file: ./.secrets/bootstrap_password
  setup_token:
    file: ./.secrets/setup_token
volumes: !override
  pgdata:
    name: ${ProjectName}_restore_pgdata
  files:
    name: ${ProjectName}_restore_files
  keys:
    name: ${ProjectName}_restore_keys
  tls_data:
    name: ${ProjectName}_restore_tls_data
  tls_config:
    name: ${ProjectName}_restore_tls_config
  tailnet_state:
    name: ${ProjectName}_restore_tailnet_state
networks: !override
  private:
    name: ${ProjectName}_restore_private
"@ | Add-Content -LiteralPath compose.restore.yaml -Encoding utf8NoBOM
    $lines=@();if(Test-Path .env){$lines=@(Get-Content .env | Where-Object {$_ -notmatch '^(COMPOSE_PROJECT_NAME|COMPOSE_FILE|COMPOSE_PATH_SEPARATOR|APP_ORIGIN|SECURE_COOKIES|LOVE_CLOUD_PORT|LOVE_CLOUD_BIND)='})}
    $separator=if($IsWindows){';'}else{':'}
    $lines+=@("COMPOSE_PROJECT_NAME=$ProjectName",('COMPOSE_FILE='+((@($files)+@('compose.restore.yaml')) -join $separator)),"COMPOSE_PATH_SEPARATOR=$separator","APP_ORIGIN=$Origin",('SECURE_COOKIES='+($originUri.Scheme -eq 'https').ToString().ToLowerInvariant()),"LOVE_CLOUD_PORT=$Port",'LOVE_CLOUD_BIND=127.0.0.1')
    [IO.File]::WriteAllLines((Join-Path $Target '.env'),$lines,[Text.UTF8Encoding]::new($false))
    $effective=@{COMPOSE_PROJECT_NAME=$ProjectName;COMPOSE_FILE=((@($files)+@('compose.restore.yaml')) -join $separator);COMPOSE_PATH_SEPARATOR=$separator;APP_ORIGIN=$Origin;SECURE_COOKIES=($originUri.Scheme -eq 'https').ToString().ToLowerInvariant();LOVE_CLOUD_PORT="$Port";LOVE_CLOUD_BIND='127.0.0.1';COMPOSE_PROFILES=''}
    foreach($name in $effective.Keys){$previousEnvironment[$name]=[Environment]::GetEnvironmentVariable($name);[Environment]::SetEnvironmentVariable($name,$effective[$name])}
    Invoke-LoveCloudDocker @('compose','config','--quiet') | Out-Null
    Invoke-LoveCloudDocker @('compose','up','-d','--no-build','db') | Out-Null
    $db=(Invoke-LoveCloudDocker @('compose','ps','-q','db') | Out-String).Trim()
    $ready=$false
    for($attempt=0;$attempt -lt 90;$attempt++){
        & docker exec $db pg_isready -U lovecloud -d lovecloud *> $null
        if($LASTEXITCODE -eq 0){$ready=$true;break};Start-Sleep -Seconds 1
    }
    if(-not $ready){throw 'Restored database readiness failed.'}
    Invoke-LoveCloudDocker @('cp',"$stage/source/database/database.dump","${db}:/tmp/lovecloud-restore.dump") | Out-Null
    Invoke-LoveCloudDocker @('exec',$db,'pg_restore','-U','lovecloud','-d','lovecloud','--clean','--if-exists','--no-owner','--exit-on-error','/tmp/lovecloud-restore.dump') | Out-Null
    Invoke-LoveCloudDocker @('exec',$db,'rm','-f','/tmp/lovecloud-restore.dump') | Out-Null
    Invoke-LoveCloudDocker @('compose','create','--no-build','api') | Out-Null
    $api=(Invoke-LoveCloudDocker @('compose','ps','-aq','api') | Out-String).Trim()
    Invoke-LoveCloudDocker @('run','--rm','--volumes-from',$api,'--mount',"type=bind,source=$stage/data,target=/originals,readonly",'--entrypoint','sh',$backupImage,'-c','cp -a /originals/files/. /data/files/; cp -a /originals/keys/. /data/keys/') | Out-Null
    Invoke-LoveCloudDocker @('compose','up','-d','--no-build') | Out-Null
    $ready=$false
    for($attempt=0;$attempt -lt 90;$attempt++){
        & docker compose exec -T gateway wget -qO- http://127.0.0.1/health *> $null
        if($LASTEXITCODE -eq 0){$ready=$true;break};Start-Sleep -Seconds 1
    }
    if(-not $ready){throw 'Restored application readiness failed; inspect docker compose logs --tail 100.'}
    Write-Host "Restored fresh project $ProjectName at $Origin. Verify accounts, originals and TOTP before removing any backup."
} finally {
    foreach($name in $previousEnvironment.Keys){[Environment]::SetEnvironmentVariable($name,$previousEnvironment[$name])}
    Pop-Location
    if(Test-Path -LiteralPath $stage){
        $resolved=[IO.Path]::GetFullPath((Resolve-Path -LiteralPath $stage).Path)
        $prefix=Join-Path ([IO.Path]::GetTempPath()) 'lovecloud-restore-'
        if(-not $resolved.StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase)){throw 'Refusing cleanup outside owned restore staging.'}
        if($IsWindows){Remove-Item -LiteralPath $resolved -Recurse -Force}
        else {
            # Linux snapshot metadata may be UID1654. This helper is mounted
            # solely to the just-created, verified staging directory.
            Invoke-LoveCloudDocker @('run','--rm','--mount',"type=bind,source=$resolved,target=/restore",'--entrypoint','sh',$backupImage,'-c','rm -rf /restore/* /restore/.[!.]* /restore/..?*') | Out-Null
            Remove-Item -LiteralPath $resolved -Force
        }
    }
}
