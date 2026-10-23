[CmdletBinding()]
param([string]$ProjectName='', [string]$Repository='backups/restic')
$ErrorActionPreference='Stop'
$root=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$repositoryPath=[IO.Path]::GetFullPath((Join-Path $root $Repository))
$stageRoot=Join-Path $root '.artifacts'
$stagePath=Join-Path $stageRoot ('backup-'+[guid]::NewGuid().ToString('N'))
$passwordPath=Join-Path $root '.secrets/backup_password'
$lock=$null; $stopped=$false
function Docker([string[]]$Arguments) {
    $output=& docker @Arguments
    if($LASTEXITCODE -ne 0){throw ('Docker operation failed: '+$Arguments[0]+'. Inspect docker compose logs --tail 100; do not publish secrets.')}
    return $output
}
function Compose([string[]]$Arguments){
    $composeArgs=@('compose');if($ProjectName){$composeArgs+=@('-p',$ProjectName)}
    Docker ($composeArgs+$Arguments)
}
Push-Location $root
try {
    foreach($name in @('database_password','database_connection','bootstrap_password','setup_token')){
        if(-not (Test-Path -LiteralPath ".secrets/$name")){throw "Missing .secrets/$name. Restore the existing secret from backup; do not regenerate database credentials."}
    }
    New-Item -ItemType Directory -Force -Path $stageRoot,$repositoryPath | Out-Null
    $lock=[IO.File]::Open((Join-Path $stageRoot 'backup.lock'),[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
    $api=(Compose @('ps','-q','api') | Out-String).Trim();$db=(Compose @('ps','-q','db') | Out-String).Trim()
    if(-not $api -or -not $db){throw 'The existing API and database must be running.'}
    $info=(Docker @('inspect',$api) | Out-String | ConvertFrom-Json)[0]
    $actualProject=$info.Config.Labels.'com.docker.compose.project'
    $backupImage=$env:LOVECLOUD_BACKUP_IMAGE
    if(-not $backupImage -and (Test-Path .env)){
        $match=Get-Content .env | Where-Object {$_ -match '^LOVECLOUD_BACKUP_IMAGE='} | Select-Object -Last 1
        if($match){$backupImage=($match -split '=',2)[1].Trim('"',"'")}
    }
    if(-not $backupImage){$backupImage='restic/restic:0.18.0'}
    Docker @('pull',$backupImage) | Out-Null
    if(-not (Test-Path -LiteralPath $passwordPath)){
        if(Test-Path -LiteralPath (Join-Path $repositoryPath 'config')){throw 'Existing encrypted repository has no backup_password. Restore the key; refusing to replace it.'}
        $bytes=[Security.Cryptography.RandomNumberGenerator]::GetBytes(48)
        [IO.File]::WriteAllText($passwordPath,[Convert]::ToBase64String($bytes),[Text.UTF8Encoding]::new($false))
    }
    New-Item -ItemType Directory -Force -Path "$stagePath/install/scripts","$stagePath/install/ops","$stagePath/install/.secrets","$stagePath/database" | Out-Null
    if($IsWindows){
        $owner=[Security.Principal.WindowsIdentity]::GetCurrent().Name
        & icacls $stagePath /inheritance:r /grant:r "${owner}:(OI)(CI)F" | Out-Null
        if($LASTEXITCODE -ne 0){throw 'Cannot protect backup staging directory.'}
        & icacls $passwordPath /inheritance:r /grant:r "${owner}:F" | Out-Null
        if($LASTEXITCODE -ne 0){throw 'Cannot protect backup password.'}
    } else { & chmod 700 $stagePath; & chmod 600 $passwordPath }
    foreach($name in @('database_password','database_connection','bootstrap_password','setup_token')){Copy-Item -LiteralPath ".secrets/$name" -Destination "$stagePath/install/.secrets/"}
    foreach($name in @('.env','VERSION','release.env')){if(Test-Path -LiteralPath $name){Copy-Item -LiteralPath $name -Destination "$stagePath/install/"}}
    foreach($name in @('init.sh','init.ps1','backup.sh','backup.ps1','restore.sh','restore.ps1')){Copy-Item -LiteralPath "scripts/$name" -Destination "$stagePath/install/scripts/"}
    Get-ChildItem -LiteralPath ops -File | Copy-Item -Destination "$stagePath/install/ops/"
    $composeFiles=@();$index=0
    foreach($file in $info.Config.Labels.'com.docker.compose.project.config_files'.Split(',')){
        if(-not (Test-Path -LiteralPath $file)){throw 'A Compose source file is unavailable; restore it before backup.'}
        $index++;$name="compose.backup.$index.yaml"
        Copy-Item -LiteralPath $file -Destination (Join-Path "$stagePath/install" $name);$composeFiles+=$name
    }
    if(-not $composeFiles.Count){throw 'Cannot identify Compose source files.'}
    [IO.File]::WriteAllText("$stagePath/install/backup-compose-files.txt",($composeFiles -join ':'),[Text.UTF8Encoding]::new($false))
    [IO.File]::WriteAllText("$stagePath/install/backup-project.txt",$actualProject,[Text.UTF8Encoding]::new($false))
    Compose @('config','--format','json') | Set-Content "$stagePath/install/backup-effective-compose.json"
    Compose @('config','--services') | Set-Content "$stagePath/install/backup-services.txt"
    Docker @('inspect','--format','{{json .Mounts}}',$api) | Set-Content "$stagePath/install/backup-api-mounts.json"
    Docker @('inspect','--format','{{json .Mounts}}',$db) | Set-Content "$stagePath/install/backup-db-mounts.json"
    Compose @('stop','api') | Out-Null;$stopped=$true
    Docker @('exec',$db,'pg_dump','-U','lovecloud','-d','lovecloud','-Fc','-f','/tmp/lovecloud-backup.dump') | Out-Null
    Docker @('cp',"${db}:/tmp/lovecloud-backup.dump","$stagePath/database/database.dump") | Out-Null
    Docker @('exec',$db,'rm','-f','/tmp/lovecloud-backup.dump') | Out-Null
    $restic=@('run','--rm','--volumes-from',"${api}:ro",'--mount',"type=bind,source=$repositoryPath,target=/repository",'--mount',"type=bind,source=$passwordPath,target=/password,readonly",'--mount',"type=bind,source=$stagePath,target=/source,readonly",$backupImage,'--repo','/repository','--password-file','/password')
    if(-not (Test-Path -LiteralPath "$repositoryPath/config")){Docker ($restic+@('init'))}
    Docker ($restic+@('backup','--tag',$actualProject,'/source','/data/files','/data/keys'))
    Docker ($restic+@('check'))
    Write-Host "Encrypted backup verified: $repositoryPath"
    Write-Host "Keep a separate safe copy of $passwordPath"
} finally {
    if($stopped){& docker compose $(if($ProjectName){'-p';$ProjectName}) start api | Out-Null}
    if($lock){$lock.Dispose()}
    if(Test-Path -LiteralPath $stagePath){
        $resolved=[IO.Path]::GetFullPath((Resolve-Path -LiteralPath $stagePath).Path)
        if(-not $resolved.StartsWith($stageRoot+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw 'Refusing cleanup outside owned backup staging.'}
        Remove-Item -LiteralPath $resolved -Recurse -Force
    }
    Pop-Location
}
