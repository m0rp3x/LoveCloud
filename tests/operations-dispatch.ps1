#requires -Version 7.0
# Isolated native-command shim; does not contact Docker or execute operations.
$ErrorActionPreference='Stop'
$root=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$probe=Join-Path ([IO.Path]::GetTempPath()) ('lovecloud-dispatch-test-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $probe | Out-Null
if($IsWindows){[IO.File]::WriteAllText((Join-Path $probe 'docker.cmd'),"@if `"%LOVECLOUD_DISPATCH_MODE%`"==`"empty`" exit /b 0`r`n@echo native-dispatch:%*`r`n@exit /b 0`r`n")}
else{[IO.File]::WriteAllText((Join-Path $probe 'docker'),"#!/bin/sh`nif [ `"`${LOVECLOUD_DISPATCH_MODE:-}`" = empty ]; then exit 0; fi`nprintf 'native-dispatch:%s\n' `"`$*`"`n");& chmod 755 (Join-Path $probe 'docker')}
$previousPath=$env:PATH
$previousMode=$env:LOVECLOUD_DISPATCH_MODE
try {
    $env:PATH=$probe+[IO.Path]::PathSeparator+$previousPath
    foreach($file in @('scripts/backup.ps1','scripts/restore.ps1')){
        $tokens=$null;$errors=$null
        $ast=[System.Management.Automation.Language.Parser]::ParseFile((Join-Path $root $file),[ref]$tokens,[ref]$errors)
        if($errors){throw "Parse errors in $file"}
        $functions=@($ast.FindAll({param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst]},$true))
        if($functions.Name -contains 'docker'){throw "$file shadows the Docker command (PowerShell names are case-insensitive)."}
        $wrapper=@($functions | Where-Object Name -eq 'Invoke-LoveCloudDocker')
        if($wrapper.Count -ne 1){throw "$file must define one unambiguous Docker wrapper."}
        . ([scriptblock]::Create($wrapper[0].Extent.Text))
        $output=Invoke-LoveCloudDocker @('--version')
        if(($output|Out-String).Trim() -ne 'native-dispatch:--version'){throw "$file did not dispatch exactly once to the native command shim."}
    }
    # Execute the real script through its preflight against a native empty-CLI
    # shim. It must create the chosen repository before refusing absent app
    # containers, proving absolute and relative paths without contacting Docker.
    $install=Join-Path $probe 'synthetic-install'
    New-Item -ItemType Directory -Force -Path "$install/scripts","$install/.secrets" | Out-Null
    Copy-Item -LiteralPath (Join-Path $root 'scripts/backup.ps1') -Destination "$install/scripts/backup.ps1"
    foreach($name in @('database_password','database_connection','bootstrap_password','setup_token')){[IO.File]::WriteAllText("$install/.secrets/$name",[guid]::NewGuid().ToString('N'))}
    $env:LOVECLOUD_DISPATCH_MODE='empty'
    foreach($repository in @((Join-Path $probe 'absolute-repository'),'backups/relative-repository')){
        $refused=$false
        try{& "$install/scripts/backup.ps1" -Repository $repository *> $null}catch{$refused=$_.Exception.Message -match 'must be running'}
        if(-not $refused){throw 'Synthetic backup preflight did not refuse absent containers.'}
        $expected=[IO.Path]::GetFullPath($repository,$install)
        if(-not (Test-Path -LiteralPath $expected -PathType Container)){throw 'Backup changed the chosen absolute/relative repository path.'}
    }
    Write-Host 'PASS PowerShell operational wrappers dispatch to a native command without recursive command shadowing (Docker shim; no daemon contacted).'
    Write-Host 'PASS real backup preflight preserves absolute repositories and anchors relative repositories to its installation (synthetic filesystem; no daemon contacted).'
} finally {
    $env:PATH=$previousPath
    $env:LOVECLOUD_DISPATCH_MODE=$previousMode
    Remove-Item Function:/Invoke-LoveCloudDocker -ErrorAction SilentlyContinue
}
