param(
  [string]$Repository = "pix-usdt-platform",
  [switch]$Private = $true
)
$ErrorActionPreference = "Stop"
Set-Location (Resolve-Path (Join-Path $PSScriptRoot ".."))
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw "Git não encontrado. Instale Git for Windows." }
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) { throw "GitHub CLI não encontrado. Instale em https://cli.github.com/ e execute gh auth login." }
if (Test-Path ".env") { Write-Host "Arquivo .env detectado; ele não será adicionado." }
if (-not (Test-Path ".git")) { git init }
$profile = gh api user | ConvertFrom-Json
if (-not (git config --get user.name)) { git config user.name $profile.login }
if (-not (git config --get user.email)) { git config user.email ("{0}+{1}@users.noreply.github.com" -f $profile.id, $profile.login) }
git add .
git commit -m "chore: initialize PixSplit platform"
if ($LASTEXITCODE -ne 0) { throw "Falha ao criar commit inicial." }
$ghArgs = @("repo", "create", $Repository, "--source=.", "--remote=origin", "--push")
if ($Private) { $ghArgs += "--private" } else { $ghArgs += "--public" }
gh @ghArgs
if ($LASTEXITCODE -ne 0) { throw "Falha ao criar/publicar repositório. Verifique gh auth status e nome disponível." }
Write-Host "Repositório publicado: $Repository"
