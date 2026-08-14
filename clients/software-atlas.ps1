[CmdletBinding()]
param(
  [ValidateSet("inventory")][string]$Command = "inventory",
  [string]$Output = "inventory.json",
  [string]$SiteUrl = $(if ($env:SOFTWARE_ATLAS_URL) { $env:SOFTWARE_ATLAS_URL } else { "http://127.0.0.1:4173" }),
  [ValidateRange(1024, 30000)][int]$MaxUrlLength = 16000,
  [switch]$NoOpen,
  [string]$Fixture
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Get-OptionalProperty {
  param([object]$Object, [string]$Name, [object]$Default = "")
  if ($null -eq $Object) { return $Default }
  $property = $Object.PSObject.Properties[$Name]
  if ($null -eq $property -or $null -eq $property.Value) { return $Default }
  return $property.Value
}

function Normalize-Architecture([string]$Value) {
  $normalized = if ($Value) { $Value.ToLowerInvariant() } else { "" }
  switch ($normalized) {
    { $_ -in @("amd64", "x64", "x86_64") } { return "amd64" }
    { $_ -in @("arm64", "aarch64") } { return "arm64" }
    { $_ -in @("x86", "i386", "i686") } { return "x86" }
    default { if ($Value) { return $Value.ToLowerInvariant() }; return "unknown" }
  }
}

function ConvertTo-Base64Url([string]$Text) {
  return [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($Text)).TrimEnd("=").Replace("+", "-").Replace("/", "_")
}

function Add-Package {
  param([Collections.Generic.List[object]]$Items, [string]$Manager, [string]$Name, [string]$Version, [string]$Collection = "", [string]$Scope = "unknown")
  if ([string]::IsNullOrWhiteSpace($Name)) { return }
  $item = [ordered]@{ manager = $Manager; name = $Name.Trim(); version = $(if ($Version) { $Version.Trim() } else { "" }) }
  if ($Collection) { $item.collection = $Collection.Trim() }
  $item.scope = $Scope
  $Items.Add($item)
}

function Get-InstalledPackages {
  $items = [Collections.Generic.List[object]]::new()
  if (Get-Command scoop -ErrorAction SilentlyContinue) {
    try {
      $document = ((& scoop export 2>$null) -join "`n") | ConvertFrom-Json
      foreach ($app in @(Get-OptionalProperty $document "apps" @())) {
        Add-Package $items "scoop" (Get-OptionalProperty $app "Name") (Get-OptionalProperty $app "Version") (Get-OptionalProperty $app "Source") "user"
      }
    } catch { Write-Warning "无法读取 Scoop：$($_.Exception.Message)" }
  }
  if (Get-Command choco -ErrorAction SilentlyContinue) {
    try {
      $lines = @(& choco list --local-only --limit-output 2>$null)
      if ($LASTEXITCODE -ne 0) { $lines = @(& choco list --limit-output 2>$null) }
      foreach ($line in $lines) {
        $parts = $line -split "\|", 2
        if ($parts.Count -eq 2) { Add-Package $items "chocolatey" $parts[0] $parts[1] "" "system" }
      }
    } catch { Write-Warning "无法读取 Chocolatey：$($_.Exception.Message)" }
  }
  return @($items | Sort-Object manager, name, collection -Unique)
}

if ($Fixture) {
  $fixtureDocument = Get-Content -Raw -LiteralPath $Fixture | ConvertFrom-Json
  $packages = @(Get-OptionalProperty $fixtureDocument "packages" @())
  $system = Get-OptionalProperty $fixtureDocument "system" ([ordered]@{ os = "windows"; arch = "unknown" })
  $generatedAt = Get-OptionalProperty $fixtureDocument "generatedAt" ([DateTimeOffset]::UtcNow.ToString("yyyy-MM-ddTHH:mm:ss.fffZ"))
} else {
  $packages = @(Get-InstalledPackages)
  $system = [ordered]@{ os = "windows"; arch = Normalize-Architecture $(if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }) }
  $generatedAt = [DateTimeOffset]::UtcNow.ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
}

$inventory = [ordered]@{ schemaVersion = "1.0.0"; generatedAt = $generatedAt; system = $system; packages = @($packages) }
$target = [IO.Path]::GetFullPath($Output)
[IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($target)) | Out-Null
$formatted = ($inventory | ConvertTo-Json -Depth 8).Replace("`r`n", "`n")
[IO.File]::WriteAllText($target, "$formatted`n", [Text.UTF8Encoding]::new($false))

$compact = $inventory | ConvertTo-Json -Depth 8 -Compress
$fragment = "#inventory=v1.base64.$(ConvertTo-Base64Url $compact)"
$inventoryUrl = "$($SiteUrl.TrimEnd('/'))/inventory$fragment"
$openUrl = if ($inventoryUrl.Length -le $MaxUrlLength) { $inventoryUrl } else { "$($SiteUrl.TrimEnd('/'))/inventory" }

Write-Host "已生成清单：$target"
Write-Host "共发现 $($packages.Count) 个软件包。"
if ($inventoryUrl.Length -le $MaxUrlLength) {
  Write-Host "清单已放入本地 URL Fragment（$($inventoryUrl.Length) 个字符）。"
} else {
  Write-Warning "清单 URL 为 $($inventoryUrl.Length) 个字符，超过 $MaxUrlLength；已回退到文件导入页面。"
}
Write-Host "也可以打开网站后选择或拖入该 JSON 文件。"
if (-not $NoOpen) { Start-Process $openUrl }
