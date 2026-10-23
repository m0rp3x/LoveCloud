#requires -Version 7.0
[CmdletBinding()]
param([Parameter(Mandatory)][string]$Archive,[Parameter(Mandatory)][string]$Images,[Parameter(Mandatory)][string]$SourceSha,[Parameter(Mandatory)][string]$Report,[string]$BaselineImages)
$argsList=@((Join-Path $PSScriptRoot 'verify-candidate.mjs'),'--archive',$Archive,'--images',$Images,'--source-sha',$SourceSha,'--report',$Report)
if($BaselineImages){$argsList+=@('--baseline-images',$BaselineImages)}
& node @argsList
if($LASTEXITCODE -ne 0){throw 'Candidate acceptance failed; inspect the sanitized report.'}
