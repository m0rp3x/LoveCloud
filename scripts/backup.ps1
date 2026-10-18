[CmdletBinding()]
param([string]$ProjectName='lovecloud', [string]$Repository='backups/restic')
$ErrorActionPreference='Stop'
if ($ProjectName -notmatch '^[a-z0-9][a-z0-9_-]+$') { throw 'Invalid Compose project name.' }
$workspacePath=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$repositoryPath=[IO.Path]::GetFullPath((Join-Path $workspacePath $Repository))
$stageRoot=[IO.Path]::GetFullPath((Join-Path $workspacePath '.artifacts'))
$stagePath=[IO.Path]::GetFullPath((Join-Path $stageRoot ('backup-'+[guid]::NewGuid().ToString('N'))))
$secretPath=Join-Path $workspacePath '.secrets'
$backupPasswordPath=Join-Path $secretPath 'backup_password'
$lockStream=$null
$apiStopped=$false
function Invoke-CheckedDocker([string[]]$Arguments) {
    & docker @Arguments
    if ($LASTEXITCODE -ne 0) { throw ('Docker command failed: '+$Arguments[0]) }
}
Push-Location $workspacePath
try {
    New-Item -ItemType Directory -Force -Path $stageRoot,$repositoryPath,$secretPath | Out-Null
    $lockStream=[IO.File]::Open((Join-Path $stageRoot 'backup.lock'),[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
    if (-not (Test-Path -LiteralPath $backupPasswordPath)) {
        $bytes=New-Object byte[] 32
        $rng=[Security.Cryptography.RandomNumberGenerator]::Create()
        try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
        [IO.File]::WriteAllText($backupPasswordPath,[Convert]::ToBase64String($bytes),[Text.UTF8Encoding]::new($false))
    }
    & (Join-Path $PSScriptRoot 'init.ps1') -QuietSecrets
    New-Item -ItemType Directory -Force -Path $stagePath | Out-Null
    Invoke-CheckedDocker -Arguments @('pull','restic/restic:latest')
    Invoke-CheckedDocker -Arguments @('compose','-p',$ProjectName,'stop','api')
    $apiStopped=$true
    $dbId=(& docker compose -p $ProjectName ps -q db).Trim()
    if (-not $dbId) { throw 'Database container is not running.' }
    $dumpPath='/tmp/lovecloud-'+[guid]::NewGuid().ToString('N')+'.dump'
    Invoke-CheckedDocker -Arguments @('exec',$dbId,'pg_dump','-U','lovecloud','-d','lovecloud','-Fc','-f',$dumpPath)
    Invoke-CheckedDocker -Arguments @('cp',($dbId+':'+$dumpPath),(Join-Path $stagePath 'database.dump'))
    Invoke-CheckedDocker -Arguments @('exec',$dbId,'rm','-f',$dumpPath)
    $restic=@('run','--rm','--mount',"type=bind,source=$repositoryPath,target=/repository",'--mount',"type=bind,source=$backupPasswordPath,target=/password,readonly",'--mount',"type=bind,source=$stagePath,target=/source/database,readonly",'--mount',"type=bind,source=$workspacePath,target=/source/install,readonly",'--mount',"type=volume,source=$($ProjectName)_files,target=/source/files,readonly",'--mount',"type=volume,source=$($ProjectName)_keys,target=/source/keys,readonly",'restic/restic:latest','--repo','/repository','--password-file','/password')
    if (-not (Test-Path -LiteralPath (Join-Path $repositoryPath 'config'))) {
        Invoke-CheckedDocker -Arguments ($restic+@('init'))
    }
    Invoke-CheckedDocker -Arguments ($restic+@('backup','--tag',$ProjectName,'--exclude','**/node_modules','--exclude','**/.next','--exclude','**/bin','--exclude','**/obj','--exclude','**/.git','--exclude','/source/install/.artifacts','--exclude','/source/install/backups','--exclude','/source/install/.secrets/backup_password','/source/database','/source/files','/source/keys','/source/install'))
    Invoke-CheckedDocker -Arguments ($restic+@('check'))
    Write-Host "Encrypted backup verified: $repositoryPath"
    Write-Host "Keep a separate safe copy of $backupPasswordPath to be able to restore."
} finally {
    if ($apiStopped) { & docker compose -p $ProjectName start api }
    if ($lockStream) { $lockStream.Dispose() }
    $stagePrefix=$stageRoot+[IO.Path]::DirectorySeparatorChar
    if (Test-Path -LiteralPath $stagePath) {
        $resolvedStage=[IO.Path]::GetFullPath((Resolve-Path -LiteralPath $stagePath).Path)
        if (-not $resolvedStage.StartsWith($stagePrefix,[StringComparison]::OrdinalIgnoreCase)) { throw 'Refusing cleanup outside the backup staging directory.' }
        Remove-Item -LiteralPath $resolvedStage -Recurse -Force
    }
    Pop-Location
}
