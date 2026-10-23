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
    # Evaluate the production serialization statement itself and read its actual
    # persisted dotenv output. A comma/concatenation precedence regression can
    # otherwise be hidden by the initial restore process environment.
    $settingsStatement=@($ast.FindAll({param($node) $node -is [System.Management.Automation.Language.AssignmentStatementAst] -and $node.Extent.Text.StartsWith('$lines+=')},$true))
    if($settingsStatement.Count -ne 1){throw 'Expected one restore settings serialization statement.'}
    foreach($case in @(@{Separator=':';Origin='http://localhost:33216';Secure='false'},@{Separator=';';Origin='https://lovecloud.example';Secure='true'})){
        $files=@('compose.backup.1.yaml','compose.backup.2.yaml');$separator=$case.Separator
        $ProjectName='lc000-synthetic-restore';$Origin=$case.Origin;$originUri=[Uri]$Origin;$Port=33216;$lines=@('CUSTOM_SETTING=keep')
        . ([scriptblock]::Create($settingsStatement[0].Extent.Text))
        $settingsFile=Join-Path $probe 'restore-settings.env'
        [IO.File]::WriteAllLines($settingsFile,$lines,[Text.UTF8Encoding]::new($false))
        $settings=@{}
        foreach($entry in [IO.File]::ReadAllLines($settingsFile)){
            if($entry -notmatch '^([^=]+)=(.*)$'){throw 'Restore wrote a dangling dotenv value instead of a key=value record.'}
            $settings[$Matches[1]]=$Matches[2]
        }
        if($settings.COMPOSE_FILE -ne ((@($files)+@('compose.restore.yaml')) -join $separator) -or $settings.SECURE_COOKIES -ne $case.Secure -or $settings.CUSTOM_SETTING -ne 'keep'){throw 'Restore did not persist reusable Compose files, cookies and custom settings.'}
    }
    Write-Host 'PASS PowerShell operational wrappers dispatch to a native command without recursive command shadowing (Docker shim; no daemon contacted).'
    Write-Host 'PASS real backup preflight preserves absolute repositories and anchors relative repositories to its installation (synthetic filesystem; no daemon contacted).'
    Write-Host 'PASS restore dotenv serialization retains whole Compose file lists, HTTP/HTTPS cookie settings and custom values across host separators (production statement; no daemon contacted).'
} finally {
    $env:PATH=$previousPath
    $env:LOVECLOUD_DISPATCH_MODE=$previousMode
    Remove-Item Function:/Invoke-LoveCloudDocker -ErrorAction SilentlyContinue
}
