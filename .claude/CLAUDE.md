# Herramientas Claude Code de este repositorio

Este repo declara en `.claude/settings.json` los plugins **ponytail**,
**agent-skills (Addy Osmani)** y **omniroute**. Cualquier sesion de Claude Code que
abra el repo (PC de desarrollo, VPS, sesion en la nube) los instala y activa al
confiar en el proyecto.

**graphify** se instala por maquina con su CLI oficial
(`uv tool install graphifyy && graphify install`); el comando `/graphify .`
construye el grafo de conocimiento del repo en `graphify-out/`.

Para dejar las cuatro herramientas instaladas a nivel de usuario en una maquina
nueva: `scripts/claude-tools/install.sh` (Linux/macOS/VPS) o
`scripts/claude-tools/install.ps1` (Windows). Detalle en `scripts/claude-tools/README.md`.
