#requires -Version 7.0
[CmdletBinding()]
param([switch]$KeepRunning,[string]$ImagesFile=$env:LOVECLOUD_TEST_IMAGES)
$ErrorActionPreference='Stop'
$root=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if(-not $ImagesFile){$ImagesFile=Join-Path $root 'compose.images.yaml'}
$argsList=@((Join-Path $root 'tests/run-suite.mjs'),'onboarding',[IO.Path]::GetFullPath($ImagesFile))
if($KeepRunning){$argsList+='--keep-running'}
& node @argsList
if($LASTEXITCODE -ne 0){throw 'Isolated onboarding checks failed; inspect the explicit result files, never publish credentials.'}
