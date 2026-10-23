#requires -Version 7.0
# Isolated native-command shim; does not contact Docker or execute operations.
$ErrorActionPreference='Stop'
$root=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$probe=Join-Path ([IO.Path]::GetTempPath()) ('lovecloud-dispatch-test-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $probe | Out-Null
if($IsWindows){[IO.File]::WriteAllText((Join-Path $probe 'docker.cmd'),"@echo native-dispatch:%*`r`n@exit /b 0`r`n")}
else{[IO.File]::WriteAllText((Join-Path $probe 'docker'),"#!/bin/sh`nprintf 'native-dispatch:%s\n' `"`$*`"`n");& chmod 755 (Join-Path $probe 'docker')}
$previousPath=$env:PATH
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
    Write-Host 'PASS PowerShell operational wrappers dispatch to a native command without recursive command shadowing (Docker shim; no daemon contacted).'
} finally {
    $env:PATH=$previousPath
    Remove-Item Function:/Invoke-LoveCloudDocker -ErrorAction SilentlyContinue
}
