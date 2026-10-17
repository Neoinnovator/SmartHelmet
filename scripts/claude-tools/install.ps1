<#
.SYNOPSIS
  Instala las herramientas Claude Code de Piramid a nivel de USUARIO en Windows:
  ponytail, agent-skills (Addy Osmani), omniroute (plugin MCP) y graphify.
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\claude-tools\install.ps1
  powershell -ExecutionPolicy Bypass -File scripts\claude-tools\install.ps1 -WithOmnirouteServer -Project
#>
[CmdletBinding()]
param(
  [switch]$WithOmnirouteServer,   # ademas: npm install -g omniroute
  [switch]$Project                # ademas: graphify install --project en este repo
)
$ErrorActionPreference = 'Continue'

function Log($m)  { Write-Host "`n==> $m" -ForegroundColor Cyan }
function Warn($m) { Write-Host "AVISO: $m" -ForegroundColor Yellow }
function Have($c) { [bool](Get-Command $c -ErrorAction SilentlyContinue) }

if (-not (Have claude)) { throw "no se encontro 'claude' (Claude Code CLI). Instala: npm install -g @anthropic-ai/claude-code" }
if (-not (Have node))   { Warn "no se encontro 'node'. ponytail usa hooks Node.js; sin node cada hook muestra 'node: command not found'." }

# Evita el error 'Permission denied (publickey)' al clonar marketplaces por SSH
git config --global url."https://github.com/".insteadOf "git@github.com:" 2>$null

Log "Marketplaces de plugins"
$marketplaces = @(
  @{ name = 'ponytail';                src = 'DietrichGebert/ponytail' },
  @{ name = 'addy-agent-skills';       src = 'addyosmani/agent-skills' },
  @{ name = 'omniroute-claude-plugin'; src = 'projectsaibg/omniroute-claude-plugin' }
)
foreach ($m in $marketplaces) {
  $listed = (claude plugin marketplace list 2>$null | Out-String)
  if ($listed -match [regex]::Escape($m.name)) {
    claude plugin marketplace update $m.name | Out-Null
    Write-Host "  marketplace $($m.name) ya registrado (actualizado)"
  } else {
    claude plugin marketplace add $m.src --scope user
  }
}

Log "Plugins"
foreach ($p in 'ponytail@ponytail', 'agent-skills@addy-agent-skills', 'omniroute@omniroute-claude-plugin') {
  claude plugin install $p --scope user -y
  if ($LASTEXITCODE -ne 0) { Warn "fallo la instalacion de $p" } else { Write-Host "  plugin $p instalado" }
}

Log "graphify (CLI graphifyy + skill)"
if (Have uv)        { uv tool install --upgrade graphifyy; uv tool update-shell | Out-Null }
elseif (Have pipx)  { pipx install --force graphifyy }
elseif (Have pip)   { pip install --user --upgrade graphifyy }
else { Warn "no hay uv/pipx/pip. Instala uv (winget install astral-sh.uv) y vuelve a ejecutar." }

$env:Path = "$env:USERPROFILE\.local\bin;$env:Path"
if (Have graphify) {
  graphify install
  if ($Project) { graphify install --project }
} else {
  Warn "'graphify' no esta en PATH. Abre una terminal nueva y ejecuta: graphify install"
}

if ($WithOmnirouteServer) {
  Log "Servidor OmniRoute (npm)"
  npm install -g omniroute
  Write-Host "  Arranca el gateway con: omniroute   (MCP en http://localhost:20128/api/mcp/stream)"
}

Log "Verificacion"
claude plugin list
if (Have graphify) { graphify --version }
Write-Host @"

Listo. Abre Claude Code (sesion nueva) y prueba:
  /ponytail            modo "lazy senior dev"
  /spec, /plan, /build agent-skills (comandos de ciclo de vida)
  /graphify .          construir el grafo de conocimiento del repo
El plugin omniroute solo expone herramientas MCP si el gateway OmniRoute esta corriendo (puerto 20128).
"@
