[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Output,
  [Parameter(Mandatory = $true)][string]$RunnerLabel,
  [switch]$Strict,
  [string]$Fixture
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if ($Fixture) {
  $document = Get-Content -Raw -LiteralPath $Fixture | ConvertFrom-Json
  $json = $document | ConvertTo-Json -Depth 12
  $target = [IO.Path]::GetFullPath($Output)
  [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($target)) | Out-Null
  [IO.File]::WriteAllText($target, "$json`n", [Text.UTF8Encoding]::new($false))
  exit 0
}

function Get-StableId {
  param([string]$Ecosystem, [string]$Name, [string]$Version, [string]$Architecture)
  $text = "$Ecosystem`0$($Name.ToLowerInvariant())`0$Version`0$Architecture"
  $bytes = [Text.Encoding]::UTF8.GetBytes($text)
  $hash = [Security.Cryptography.SHA256]::HashData($bytes)
  return ([Convert]::ToHexString($hash).ToLowerInvariant()).Substring(0, 16)
}

function Normalize-Architecture([string]$Value) {
  $normalized = if ($Value) { $Value.ToLowerInvariant() } else { "" }
  switch ($normalized) {
    { $_ -in @("x64", "x86_64", "amd64") } { return "amd64" }
    { $_ -in @("aarch64", "arm64") } { return "arm64" }
    default { if ($Value) { return $Value.ToLowerInvariant() }; return "unknown" }
  }
}

function Get-OptionalProperty {
  param([object]$Object, [string]$Name, [object]$Default = "")
  if ($null -eq $Object) { return $Default }
  $property = $Object.PSObject.Properties[$Name]
  if ($null -eq $property -or $null -eq $property.Value) { return $Default }
  return $property.Value
}

$architecture = Normalize-Architecture $env:PROCESSOR_ARCHITECTURE
$software = [ordered]@{}
$collectors = [Collections.Generic.List[object]]::new()

function Add-Software {
  param(
    [string]$Name,
    [string]$Version = "",
    [string]$Kind = "package",
    [string]$Ecosystem = "system",
    [string]$Architecture = $script:architecture,
    [string]$Publisher = "",
    [ValidateSet("user", "system", "unknown")][string]$Scope = "unknown",
    [string]$Path = "",
    [string]$SourceRef = "",
    [string]$Method
  )
  if ([string]::IsNullOrWhiteSpace($Name)) { return }
  $normalizedArch = Normalize-Architecture $Architecture
  $id = Get-StableId $Ecosystem $Name $Version $normalizedArch
  if ($script:software.Contains($id)) {
    $methods = @($script:software[$id].discoveryMethods) + $Method | Sort-Object -Unique
    $script:software[$id].discoveryMethods = @($methods)
    return
  }
  $item = [ordered]@{
    id = $id
    name = $Name
    version = $Version
    kind = $Kind
    ecosystem = $Ecosystem
    architecture = $normalizedArch
  }
  if ($Publisher) { $item.publisher = $Publisher }
  $item.scope = $Scope
  if ($Path) {
    $safePath = $Path
    foreach ($entry in @(@($env:RUNNER_TOOL_CACHE, "<RUNNER_TOOL_CACHE>"), @($env:RUNNER_TEMP, "<RUNNER_TEMP>"), @($env:GITHUB_WORKSPACE, "<GITHUB_WORKSPACE>"))) {
      if ($entry[0]) { $safePath = $safePath.Replace([string]$entry[0], [string]$entry[1]) }
    }
    $item.path = $safePath.Replace("\", "/")
  }
  if ($SourceRef) { $item.sourceRef = $SourceRef }
  $item.discoveryMethods = @($Method)
  $script:software[$id] = $item
}

function Invoke-Collector {
  param([string]$Id, [scriptblock]$Action, [switch]$Required)
  $before = $script:software.Count
  try {
    & $Action
    $script:collectors.Add([ordered]@{ id = $Id; status = "ok"; count = $script:software.Count - $before })
  } catch {
    $message = $_.Exception.Message
    $script:collectors.Add([ordered]@{ id = $Id; status = $(if ($message -match "not recognized|not found|cannot find") { "unavailable" } else { "error" }); count = 0; error = $message.Substring(0, [Math]::Min(500, $message.Length)) })
    if ($Required -and $Strict) { throw }
  }
}

Invoke-Collector "registry-uninstall" {
  $locations = @(
    @{ Path = "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*"; Scope = "system" },
    @{ Path = "HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*"; Scope = "system" },
    @{ Path = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*"; Scope = "user" }
  )
  foreach ($location in $locations) {
    foreach ($entry in @(Get-ItemProperty $location.Path -ErrorAction SilentlyContinue)) {
      $name = Get-OptionalProperty $entry "DisplayName"
      if ($name) { Add-Software -Name $name -Version (Get-OptionalProperty $entry "DisplayVersion") -Kind "application" -Ecosystem "windows-uninstall" -Publisher (Get-OptionalProperty $entry "Publisher") -Scope $location.Scope -Method "registry-uninstall" }
    }
  }
} -Required

Invoke-Collector "chocolatey" {
  $lines = @(& choco list --local-only --limit-output 2>$null)
  if ($LASTEXITCODE -ne 0) { $lines = @(& choco list --limit-output) }
  foreach ($line in $lines) {
    $parts = $line -split "\|", 2
    if ($parts.Count -eq 2) { Add-Software -Name $parts[0] -Version $parts[1] -Ecosystem "chocolatey" -Scope "system" -Method "chocolatey" }
  }
}

Invoke-Collector "winget" {
  $temporary = Join-Path $env:RUNNER_TEMP "software-atlas-winget.json"
  & winget export --output $temporary --accept-source-agreements --disable-interactivity | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "winget export failed with exit code $LASTEXITCODE" }
  $document = Get-Content -Raw $temporary | ConvertFrom-Json
  foreach ($source in @(Get-OptionalProperty $document "Sources" @())) {
    foreach ($package in @(Get-OptionalProperty $source "Packages" @())) { Add-Software -Name (Get-OptionalProperty $package "PackageIdentifier") -Version (Get-OptionalProperty $package "Version") -Kind "application" -Ecosystem "winget" -Scope "system" -Method "winget" }
  }
  Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue
}

Invoke-Collector "appx" {
  foreach ($package in @(Get-AppxPackage -AllUsers -ErrorAction Stop)) { Add-Software -Name (Get-OptionalProperty $package "Name") -Version (Get-OptionalProperty $package "Version") -Kind "application" -Ecosystem "appx" -Architecture (Get-OptionalProperty $package "Architecture" $architecture) -Publisher (Get-OptionalProperty $package "Publisher") -Scope "system" -Method "appx" }
}

Invoke-Collector "windows-features" {
  foreach ($feature in @(Get-WindowsOptionalFeature -Online | Where-Object State -eq "Enabled")) { Add-Software -Name (Get-OptionalProperty $feature "FeatureName") -Kind "feature" -Ecosystem "windows-feature" -Scope "system" -Method "windows-features" }
}

Invoke-Collector "windows-capabilities" {
  foreach ($capability in @(Get-WindowsCapability -Online | Where-Object State -eq "Installed")) { Add-Software -Name (Get-OptionalProperty $capability "Name") -Kind "capability" -Ecosystem "windows-capability" -Scope "system" -Method "windows-capabilities" }
}

Invoke-Collector "visual-studio" {
  $vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
  if (-not (Test-Path $vswhere)) { throw "vswhere not found" }
  $instances = & $vswhere -all -prerelease -format json -utf8 | ConvertFrom-Json
  foreach ($instance in @($instances)) {
    Add-Software -Name (Get-OptionalProperty $instance "displayName") -Version (Get-OptionalProperty $instance "installationVersion") -Kind "application" -Ecosystem "visual-studio" -Publisher "Microsoft" -Scope "system" -Path (Get-OptionalProperty $instance "installationPath") -Method "vswhere"
    foreach ($package in @(Get-OptionalProperty $instance "packages" @())) { Add-Software -Name (Get-OptionalProperty $package "id") -Version (Get-OptionalProperty $package "version") -Kind "component" -Ecosystem "visual-studio-component" -Architecture (Get-OptionalProperty $package "architecture" $architecture) -Publisher (Get-OptionalProperty $package "publisher") -Scope "system" -Method "vswhere" }
  }
}

Invoke-Collector "runner-tool-cache" {
  if (-not $env:RUNNER_TOOL_CACHE) { throw "RUNNER_TOOL_CACHE is unavailable" }
  foreach ($tool in @(Get-ChildItem -LiteralPath $env:RUNNER_TOOL_CACHE -Directory)) {
    foreach ($version in @(Get-ChildItem -LiteralPath $tool.FullName -Directory)) { Add-Software -Name $tool.Name -Version $version.Name -Kind "tool" -Ecosystem "runner-tool-cache" -Scope "system" -Path $version.FullName -Method "runner-tool-cache" }
  }
}

Invoke-Collector "allowlisted-version-probes" {
  $probes = @(
    @{ Name = "git"; Args = @("--version") }, @{ Name = "docker"; Args = @("--version") },
    @{ Name = "node"; Args = @("--version") }, @{ Name = "python"; Args = @("--version") },
    @{ Name = "java"; Args = @("-version") }, @{ Name = "dotnet"; Args = @("--version") },
    @{ Name = "go"; Args = @("version") }, @{ Name = "rustc"; Args = @("--version") }
  )
  foreach ($probe in $probes) {
    $command = Get-Command $probe.Name -ErrorAction SilentlyContinue
    if (-not $command) { continue }
    $version = ((& $command.Source @($probe.Args) 2>&1) -join " ").Trim()
    Add-Software -Name $probe.Name -Version $version.Substring(0, [Math]::Min(200, $version.Length)) -Kind "tool" -Ecosystem "version-probe" -Scope "system" -Method "allowlisted-version-probe"
  }
}

try {
  $os = Get-CimInstance Win32_OperatingSystem
} catch {
  $os = [pscustomobject]@{ Caption = "Windows"; Version = [Environment]::OSVersion.Version.ToString(); BuildNumber = [Environment]::OSVersion.Version.Build.ToString() }
}
$readmeLabel = if ($RunnerLabel -eq "windows-2025") { "Windows2025" } else { "Windows2022" }
$readmeSource = "https://github.com/actions/runner-images/blob/main/images/windows/$readmeLabel-Readme.md"
Invoke-Collector "official-image-manifest" {
  $markdown = (Invoke-WebRequest -UseBasicParsing "https://raw.githubusercontent.com/actions/runner-images/main/images/windows/$readmeLabel-Readme.md").Content
  foreach ($line in $markdown -split "`r?`n") {
    if (-not $line.StartsWith("|") -or $line -match "^\|[\s|:-]+\|?$") { continue }
    $fields = @($line.Split("|")[1..($line.Split("|").Count - 2)] | ForEach-Object Trim)
    if ($fields.Count -lt 2 -or $fields[0] -match "^(tool|name|package|software)$") { continue }
    $name = ($fields[0] -replace "!?\[([^\]]+)\]\([^)]*\)", '$1' -replace "<[^>]+>|[``*_]", "").Trim()
    $version = ($fields[1] -replace "<[^>]+>|[``*_]", "").Trim()
    if ($name -and $version -and $version -notmatch "^version$") { Add-Software -Name $name -Version $version -Kind "component" -Ecosystem "runner-image-readme" -Scope "system" -SourceRef $readmeSource -Method "official-image-manifest" }
  }
} -Required
$image = [ordered]@{
  runnerLabel = $RunnerLabel
  imageVersion = $(if ($env:ImageVersion) { $env:ImageVersion } else { "" })
  os = [ordered]@{ name = Get-OptionalProperty $os "Caption" "Windows"; version = Get-OptionalProperty $os "Version"; build = Get-OptionalProperty $os "BuildNumber"; arch = $architecture }
  sourceRefs = @($readmeSource)
  collectors = @($collectors | Sort-Object id)
  software = @($software.Values | Sort-Object id)
}
$document = [ordered]@{ schemaVersion = "1.0.0"; platform = "windows"; image = $image }
$json = $document | ConvertTo-Json -Depth 12
$target = [IO.Path]::GetFullPath($Output)
[IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($target)) | Out-Null
[IO.File]::WriteAllText($target, "$json`n", [Text.UTF8Encoding]::new($false))
