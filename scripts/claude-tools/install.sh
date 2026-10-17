#!/usr/bin/env bash
# Instala las herramientas Claude Code de Piramid a nivel de USUARIO en esta
# maquina (PC de desarrollo Linux/macOS o VPS):
#   - ponytail            (plugin, marketplace DietrichGebert/ponytail)
#   - agent-skills        (plugin, marketplace addyosmani/agent-skills)
#   - omniroute           (plugin MCP, marketplace projectsaibg/omniroute-claude-plugin)
#   - graphify            (CLI `graphifyy` + skill /graphify)
#
# Uso:
#   scripts/claude-tools/install.sh                            # todo lo anterior
#   scripts/claude-tools/install.sh --with-omniroute-server    # ademas `npm i -g omniroute`
#   scripts/claude-tools/install.sh --project                  # ademas registra graphify en ESTE repo
#
# Idempotente: se puede volver a ejecutar para actualizar.
set -uo pipefail

WITH_OMNIROUTE_SERVER=0
PROJECT=0
for arg in "$@"; do
  case "$arg" in
    --with-omniroute-server) WITH_OMNIROUTE_SERVER=1 ;;
    --project) PROJECT=1 ;;
    -h|--help) sed -n '2,14p' "$0"; exit 0 ;;
    *) echo "argumento desconocido: $arg" >&2; exit 1 ;;
  esac
done

log()  { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33mAVISO:\033[0m %s\n' "$*" >&2; }
fail() { printf '\033[1;31mERROR:\033[0m %s\n' "$*" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

# ---------------------------------------------------------------- requisitos
have claude || fail "no se encontro 'claude' (Claude Code CLI). Instala: npm install -g @anthropic-ai/claude-code"
have node   || warn "no se encontro 'node'. ponytail usa dos hooks Node.js; sin node los skills siguen funcionando pero cada hook muestra 'node: command not found'."
have git    || fail "no se encontro 'git'."

# ------------------------------------------------- marketplaces + plugins
add_marketplace() {  # nombre  fuente
  local name="$1" src="$2"
  if claude plugin marketplace list 2>/dev/null | grep -q "$name"; then
    claude plugin marketplace update "$name" >/dev/null 2>&1 || true
    echo "  marketplace $name ya registrado (actualizado)"
  else
    claude plugin marketplace add "$src" --scope user || warn "no se pudo agregar el marketplace $name ($src)"
  fi
}
install_plugin() {  # plugin@marketplace
  if claude plugin install "$1" --scope user -y; then
    echo "  plugin $1 instalado"
  else
    warn "fallo la instalacion de $1 (revisa la salida anterior)"
  fi
}

log "Marketplaces de plugins"
add_marketplace ponytail                 DietrichGebert/ponytail
add_marketplace addy-agent-skills        addyosmani/agent-skills
add_marketplace omniroute-claude-plugin  projectsaibg/omniroute-claude-plugin

log "Plugins"
install_plugin ponytail@ponytail
install_plugin agent-skills@addy-agent-skills
install_plugin omniroute@omniroute-claude-plugin

# ------------------------------------------------------------------ graphify
log "graphify (CLI graphifyy + skill)"
if have uv; then
  uv tool install --upgrade graphifyy || warn "uv tool install graphifyy fallo"
  uv tool update-shell >/dev/null 2>&1 || true
elif have pipx; then
  pipx install --force graphifyy || warn "pipx install graphifyy fallo"
elif have pip3; then
  pip3 install --user --upgrade graphifyy || warn "pip3 install graphifyy fallo"
else
  warn "no hay uv/pipx/pip3; instala uv (https://docs.astral.sh/uv/) y vuelve a ejecutar."
fi
export PATH="$HOME/.local/bin:$PATH"

if have graphify; then
  graphify install                      # skill global en ~/.claude/skills/graphify + bloque en ~/.claude/CLAUDE.md
  if [ "$PROJECT" = 1 ]; then
    graphify install --project          # skill + hooks en este repo
  fi
else
  warn "'graphify' no esta en PATH tras la instalacion. Abre una terminal nueva y ejecuta: graphify install"
fi

# ------------------------------------------------------- servidor OmniRoute
if [ "$WITH_OMNIROUTE_SERVER" = 1 ]; then
  log "Servidor OmniRoute (npm)"
  have npm || fail "npm es necesario para instalar omniroute"
  npm install -g omniroute || warn "npm install -g omniroute fallo"
  echo "  Arranca el gateway con: omniroute   (MCP en http://localhost:20128/api/mcp/stream)"
fi

# ---------------------------------------------------------------- resumen
log "Verificacion"
claude plugin list 2>/dev/null || true
if have graphify; then graphify --version || true; fi
cat <<'MSG'

Listo. Abre Claude Code (sesion nueva) y prueba:
  /ponytail            modo "lazy senior dev"
  /spec, /plan, /build agent-skills (comandos de ciclo de vida)
  /graphify .          construir el grafo de conocimiento del repo
El plugin omniroute solo expone herramientas MCP si el gateway OmniRoute esta corriendo (puerto 20128).
MSG
