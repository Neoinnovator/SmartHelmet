# Herramientas Claude Code (ponytail · agent-skills · omniroute · graphify)

Este directorio y `.claude/` dejan instaladas cuatro herramientas para **todas las
sesiones de Claude Code** que trabajen con este repositorio, en cualquier maquina.

| Herramienta | Que es | Como queda instalada |
|---|---|---|
| **ponytail** ([DietrichGebert/ponytail](https://github.com/DietrichGebert/ponytail)) | Skill "lazy senior dev": YAGNI, stdlib primero, el minimo codigo que funciona. Comandos `/ponytail`, `/ponytail-review`, `/ponytail-audit`, ... | Plugin, marketplace `ponytail` |
| **agent-skills** ([addyosmani/agent-skills](https://github.com/addyosmani/agent-skills)) | 25 skills de ingenieria (spec, plan, build, test, review, ship). Comandos `/spec`, `/plan`, `/build`, `/agent-skills:review`, `/ship`, ... | Plugin, marketplace `addy-agent-skills` |
| **omniroute** ([projectsaibg/omniroute-claude-plugin](https://github.com/projectsaibg/omniroute-claude-plugin)) | Conecta Claude Code al gateway [OmniRoute](https://github.com/diegosouzapw/OmniRoute) por MCP (routing, providers, cache, memoria). | Plugin MCP, marketplace `omniroute-claude-plugin`. **Requiere** el gateway corriendo en `localhost:20128` (`npm i -g omniroute && omniroute`). |
| **graphify** ([Graphify-Labs/graphify](https://github.com/Graphify-Labs/graphify), PyPI `graphifyy`) | Convierte el repo en un grafo de conocimiento consultable (`/graphify .`, `graphify query`, `graphify path`). | CLI `graphifyy` + `graphify install` en cada maquina (skill en `~/.claude/skills/graphify/`) |

## Como se propaga a cada lugar

1. **Repositorio / GitHub / sesiones en la nube (claude.ai/code).**
   `.claude/settings.json` declara los marketplaces (`extraKnownMarketplaces`) y
   los plugins habilitados (`enabledPlugins`). Al abrir el repo y confiar en el
   proyecto, Claude Code instala y activa los plugins automaticamente. Para que
   el skill graphify tambien viaje con el repo (util en sesiones en la nube),
   ejecuta una vez en tu PC `graphify install --project` y commitea
   `.claude/skills/graphify/`.
2. **PC de desarrollo y VPS (instalacion a nivel de usuario, para todos los repos).**
   Ejecuta una vez por maquina:

   ```bash
   # Linux / macOS / VPS
   scripts/claude-tools/install.sh                      # plugins + graphify
   scripts/claude-tools/install.sh --with-omniroute-server --project
   ```

   ```powershell
   # Windows
   powershell -ExecutionPolicy Bypass -File scripts\claude-tools\install.ps1
   powershell -ExecutionPolicy Bypass -File scripts\claude-tools\install.ps1 -WithOmnirouteServer -Project
   ```

   Equivalente manual dentro de Claude Code (dos prompts separados por herramienta):

   ```
   /plugin marketplace add DietrichGebert/ponytail
   /plugin install ponytail@ponytail
   /plugin marketplace add addyosmani/agent-skills
   /plugin install agent-skills@addy-agent-skills
   /plugin marketplace add projectsaibg/omniroute-claude-plugin
   /plugin install omniroute@omniroute-claude-plugin
   ```

   y en la terminal: `uv tool install graphifyy && graphify install`.

## Requisitos por maquina

- Claude Code CLI (`claude`) 2.x y `git`.
- `node` en PATH (ponytail ejecuta dos hooks Node.js; sin node los skills funcionan
  pero cada hook avisa `node: command not found`).
- `uv` (recomendado) o `pipx`/`pip` para el CLI `graphifyy`.
- Opcional: `npm` para el servidor OmniRoute.

## Notas

- El plugin **omniroute** solo aporta herramientas MCP cuando el gateway esta
  corriendo. Si no lo usas en una maquina, el servidor MCP aparece como no
  disponible; es inofensivo. Puedes desactivarlo con `/plugin disable omniroute`.
- **ponytail** y **agent-skills** instalan hooks de ciclo de vida que corren con
  tus permisos; el codigo esta en sus repos publicos (MIT). Revisalo si lo
  despliegas en un VPS compartido.
- Los hooks `PreToolUse` de graphify **no** se versionan en `.claude/settings.json`
  para no romper sesiones en maquinas sin el CLI; `install.sh --project` (o
  `graphify install --project`) los agrega cuando el CLI ya existe.
