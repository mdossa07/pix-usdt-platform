$ErrorActionPreference = "Stop"
Set-Location (Resolve-Path (Join-Path $PSScriptRoot ".."))
if (-not (Test-Path ".env")) { Copy-Item ".env.example" ".env" }
$piiBytes = New-Object byte[] 32
$jwtBytes = New-Object byte[] 48
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$rng.GetBytes($piiBytes)
$rng.GetBytes($jwtBytes)
$rng.Dispose()
$pii = ($piiBytes | ForEach-Object { $_.ToString("x2") }) -join ""
$jwt = [Convert]::ToBase64String($jwtBytes)
$content = Get-Content ".env" -Raw
$content = [regex]::Replace($content, '(?m)^PII_ENCRYPTION_KEY=.*$', "PII_ENCRYPTION_KEY=$pii")
$content = [regex]::Replace($content, '(?m)^JWT_SECRET=.*$', "JWT_SECRET=$jwt")
Set-Content -Path ".env" -Value $content -NoNewline
Write-Host "Segredos novos gravados em .env. Não compartilhe esse arquivo nem o envie ao GitHub."
