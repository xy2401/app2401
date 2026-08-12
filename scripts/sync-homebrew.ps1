[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$sourceRoot = Join-Path $projectRoot 'sources\homebrew'
$apiRoot = Join-Path $sourceRoot 'api'
$snapshotPath = Join-Path $sourceRoot 'snapshot.json'

$sources = @(
    [pscustomobject]@{
        Name = 'formula'
        Kind = 'formula'
        Url = 'https://formulae.brew.sh/api/formula.json'
    }
    [pscustomobject]@{
        Name = 'cask'
        Kind = 'cask'
        Url = 'https://formulae.brew.sh/api/cask.json'
    }
)

New-Item -ItemType Directory -Force -Path $apiRoot | Out-Null
$results = @()

foreach ($source in $sources) {
    $destination = Join-Path $apiRoot ($source.Name + '.json')
    $temporary = Join-Path $apiRoot ($source.Name + '.tmp')

    try {
        Invoke-WebRequest `
            -Uri $source.Url `
            -OutFile $temporary `
            -Headers @{ 'User-Agent' = 'package-metadata-catalog/0.1' }

        $items = @([System.IO.File]::ReadAllText($temporary) | ConvertFrom-Json)
        Move-Item -Force -LiteralPath $temporary -Destination $destination

        $file = Get-Item -LiteralPath $destination
        $results += [pscustomobject][ordered]@{
            name = $source.Name
            kind = $source.Kind
            url = $source.Url
            path = ('api/' + $file.Name)
            itemCount = $items.Count
            bytes = $file.Length
            sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $destination).Hash.ToLowerInvariant()
        }
    }
    finally {
        if (Test-Path -LiteralPath $temporary) {
            Remove-Item -Force -LiteralPath $temporary
        }
    }
}

$snapshot = [ordered]@{
    generatedAt = [DateTime]::UtcNow.ToString('o')
    sources = $results
}

$snapshot | ConvertTo-Json -Depth 5 | Set-Content -Encoding utf8 -LiteralPath $snapshotPath
$results | Format-Table name, itemCount, bytes, sha256 -AutoSize
