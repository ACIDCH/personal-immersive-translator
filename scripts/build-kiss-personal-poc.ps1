# Local-only Windows experimental KISS (GPL-3.0) + PIT test build.
# Does not access user browser sessions, and does not distribute artifacts.
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$root=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$workspace=Join-Path $root '.local-kiss-poc'
$source=Join-Path $workspace 'kiss-upstream'
$sha='a1279f2517bd478ef1dd93b941f9177094486cd4'
function Invoke-Checked([string]$exe,[string[]]$arguments){
    & $exe @arguments
    if($LASTEXITCODE -ne 0){
        throw "Command failed: $exe (exit $LASTEXITCODE)"
    }
}
foreach($command in @('git','node','npm')){
    if(-not (Get-Command $command -ErrorAction SilentlyContinue)){
        throw "Missing $command. Install Git and Node.js 22.13+ first."
    }
}
if(Test-Path $workspace){
    throw 'The private .local-kiss-poc folder already exists. Review it yourself before removing/rebuilding.'
}
New-Item -ItemType Directory -Path $workspace | Out-Null
Write-Host 'Fetching exact GPL-3.0 KISS v2.1.1 upstream source...'
Invoke-Checked 'git' @('clone','--no-checkout','--filter=blob:none','https://github.com/fishjar/kiss-translator.git',$source)
Invoke-Checked 'git' @('-C',$source,'checkout','--detach',$sha)
$resolved=(& git -C $source rev-parse HEAD).Trim()
if($LASTEXITCODE -ne 0 -or $resolved -ne $sha){throw 'Pinned KISS SHA verification failed'}
Write-Host 'Building original KISS Chrome extension...'
Invoke-Checked 'npm' @('install','--global','--no-audit','--no-fund','pnpm@9.15.9')
Push-Location $source
try{
    Invoke-Checked 'pnpm' @('install','--frozen-lockfile','--ignore-scripts')
    Invoke-Checked 'pnpm' @('build:chrome')
}finally{Pop-Location}
Push-Location $root
try{
    Write-Host 'Installing exact Mozilla PDF.js for local vendor files...'
    Invoke-Checked 'npm' @('install','--ignore-scripts','--no-audit','--no-fund','--omit=optional')
    Invoke-Checked 'npm' @('run','vendor:pdf')
    $build=Join-Path $source 'build/chrome'
    Invoke-Checked 'node' @('scripts/assemble-kiss-sidecar.mjs',$build)
    if(-not (Test-Path (Join-Path $build 'pit/control.html'))){throw 'Personal video control page missing'}
    if(-not (Test-Path (Join-Path $build 'pit/site-diagnostics.js'))){throw 'Capability diagnostic page missing'}
    Write-Host ''
    Write-Host 'Private experimental extension assembled. NO upload, ZIP or release produced.'
    Write-Host ('LOAD UNPACKED FOLDER: '+$build)
    Write-Host 'Chrome / Edge -> Extensions -> Developer Mode -> Load unpacked'
    Write-Host 'Login only in your own browser. Never share your password, cookies or API key.'
}finally{Pop-Location}
