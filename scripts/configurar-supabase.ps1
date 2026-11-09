$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot

if (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'scripts/migrar-sqlite-supabase.mjs'))) {
  throw 'Configurator is not inside the app folder.'
}

$secureKey = Read-Host -Prompt 'Paste the Supabase Secret API key (sb_secret_...) and press Enter' -AsSecureString
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)
try {
  $secretKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  if ($secretKey -notmatch '^sb_secret_[A-Za-z0-9_-]+$') {
    throw 'Wrong key type. Use the Supabase Secret API key starting with sb_secret_.'
  }

  $envPath = Join-Path $projectRoot '.env'
  $envText = "DATA_STORE=supabase`r`nSUPABASE_URL=https://uuacoagstovfpiuopwym.supabase.co`r`nSUPABASE_SECRET_KEY=$secretKey`r`n"
  [System.IO.File]::WriteAllText($envPath, $envText, [System.Text.Encoding]::ASCII)
  $envText = $null
  $secretKey = $null

  $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
  if ($nodeCommand) {
    $nodeExe = $nodeCommand.Source
  } else {
    $nodeExe = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
  }
  if (-not (Test-Path -LiteralPath $nodeExe)) {
    throw 'Node.js was not found. The Supabase key is saved; install Node.js or reopen this through Codex.'
  }

  Write-Host 'Local configuration saved. Importing existing SQLite data to Supabase...'
  & $nodeExe (Join-Path $projectRoot 'scripts/migrar-sqlite-supabase.mjs')
  if ($LASTEXITCODE -ne 0) {
    throw "Migration failed with exit code $LASTEXITCODE. The PowerShell window will stay open for this message."
  }
  Write-Host 'Migration finished. You can close this window.' -ForegroundColor Green
} finally {
  if ($pointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
  if ($secureKey) { $secureKey.Dispose() }
  $secretKey = $null
}
