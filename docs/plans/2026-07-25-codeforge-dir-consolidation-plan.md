# Plan: consolidate the installed footprint under `.codeforge/`

- **Fecha:** 2026-07-25
- **Problema:** un install esparce 13 entradas en la raíz del proyecto ajeno. `shared/`, `.workflow/`,
  `.forge-manifest` y `.forge-version` son maquinaria del framework y no tienen por qué estar visibles
  ni competir con las carpetas del proyecto.
- **No es un objetivo:** mover `docs/`. Se queda en la raíz porque es documentación humana (GitHub la
  renderiza, las convenciones de ADR la esperan ahí, y un CHANGELOG en un dotfolder es raro). Eso
  también deja intactas 79 referencias.

---

## 1. Layout objetivo

```
root/
  CLAUDE.md  AGENTS.md  opencode.json      ← obligado por los motores
  .claude/  .agents/  .codex/              ← obligado por los motores
  PROJECT.md  CONTINUITY.md                ← project-owned, human-facing
  docs/                                    ← SIN CAMBIOS (incl. ci-templates/ y e2e/)
  .codeforge/
    rules/                ← shared/rules/
    scripts/              ← shared/scripts/
    state.template.md     ← shared/state.template.md
    workflow/state.md     ← .workflow/state.md
    manifest              ← .forge-manifest
    version               ← .forge-version
```

Raíz: **13 → 10 entradas**. Desaparecen `shared/`, `.workflow/`, `.forge-manifest`, `.forge-version`.

### Lo que NO puede moverse (y por qué)

`.claude/skills/`, `.agents/skills/`, `.codex/config.toml`, `opencode.json`, `CLAUDE.md` y `AGENTS.md`
son rutas de descubrimiento fijas de cada motor. `.codeforge/` siempre coexistirá con ellas: la
unificación total no es alcanzable, y prometerla sería falso.

### Decisiones de nombre (tomadas, no bloqueantes)

- Dentro de un dotdir el prefijo `.forge-` es redundante → `manifest` y `version` a secas.
- `workflow/state.md` en subdirectorio, no `state.md` suelto, porque `/goal` escribe más artefactos
  ahí (`e2e-run/`) y conviene que todo lo volátil quede bajo un solo path ignorable.
- `rules/` y `scripts/` pierden el prefijo `shared/`: dentro de `.codeforge/` ya no comparten con nada.

---

## 2. Blast radius (medido, no estimado)

| Zona | Ocurrencias | Archivos |
| --- | --- | --- |
| Payload `src/` (skills + rules + CLAUDE.md) | 158 (`shared/` 97, `.workflow/` 61) | ~25 |
| `install.sh` | 49 | 1 |
| `install.ps1` | 39 | 1 |
| `tests/smoke.sh` | 38 | 1 |
| `tools/` (12 tests + linter + README) | 51 | 13 |
| `src/sync.sh`, `.github/` | 2 | 2 |
| **Total** | **~336** | **~42** |

Puntos que no son un simple find/replace:

1. **`tools/lib/skill-lint.mjs:26`** — `SHARED_REF_RE = /\b(shared\/[a-z0-9/_-]+\.md)\b/gi` valida que
   toda referencia exista. Debe pasar a `.codeforge/rules/…`. **Este es el aliado del refactor**: una
   vez actualizado, el linter falla sobre cualquier referencia que se me haya olvidado.
2. **Defaults hardcodeados en los scripts** — `check-gates.sh:21`, `goal-state.sh:10,15,19,24`
   (`${1:-.workflow/state.md}`) y sus gemelos `.ps1`.
3. **`goal-digest.sh:17`** — pathspecs de exclusión `':(exclude).workflow/*'`. Si no se actualiza, el
   digest empieza a incluir el estado volátil y **ninguna certificación vuelve a coincidir**.
4. **Writer de `.gitignore`** (`install.sh:389,394`) — hoy escribe `.workflow/`. Debe escribir
   `.codeforge/workflow/`. **Footgun crítico:** un `.codeforge/` a secas en el `.gitignore` borraría
   del repo las reglas y scripts que sí deben commitearse.
5. **`check-gates.sh`** — el mensaje de error apunta a `shared/state.template.md`; y la whitelist del
   reporte E2E (`^docs/e2e/reports/…`) **no cambia**, porque `docs/` no se mueve.
6. **`src/sync.sh`** — genera dentro del target; hay que ver si toca alguno de estos paths.

---

## 3. Pasos, en orden, con verificación tras cada uno

Cada paso termina con la suite completa (`node --test`, `lint-skills`, `run-evals`, `smoke.sh`). No se
avanza al siguiente con algo rojo — es la disciplina que evitó que una reescritura anterior se
compusiera en cascada.

1. **Mover los archivos en `src/`**: `src/shared/rules/` → `src/codeforge/rules/`, `src/shared/scripts/`
   → `src/codeforge/scripts/`, `src/shared/state.template.md` → `src/codeforge/state.template.md`.
   (El payload usa `codeforge/` sin punto; el punto lo pone el instalador al copiar a `.codeforge/`.
   Alternativa: nombrar el dir del payload `dot-codeforge/`. Decidir en el paso 1 y no antes.)
2. **Actualizar el linter** (`SHARED_REF_RE` + el mensaje de model-ID) y correrlo: ahora enumera todas
   las referencias rotas del payload. Esa lista es la lista de trabajo del paso 3.
3. **Reescribir las referencias del payload** (158). Mecánico, guiado por el linter hasta que pase.
4. **Scripts**: defaults, pathspecs de `goal-digest`, mensajes de error. Correr los tests de
   `goal-*` y `check-gates` (sh y ps1) — ya cubren estos paths.
5. **Instaladores** (`install.sh` 49 + `install.ps1` 39): rutas de copia, creación de directorios,
   prune por manifest, writer de `.gitignore`, validación post-install. Paridad obligatoria.
6. **`tests/smoke.sh`** (38) y los 12 tests de `tools/test/`.
7. **Un install limpio a un target de scratch** y comparar el árbol resultante contra el layout de §1,
   entrada por entrada. Es la única prueba de que el objetivo se cumplió.
8. **Dogfooding**: reinstalar sobre el propio repo si aplica, y sobre el directorio `codeforge/`
   vecino, que hoy es un install de v0.5.1.

---

## 4. Riesgos y cómo se atrapan

| Riesgo | Detección |
| --- | --- |
| Referencia olvidada en el payload | `lint-skills` falla (integridad de referencias es ERROR) |
| Default de script sin actualizar | Los tests de `goal-state`/`check-gates` fallan |
| `goal-digest` incluyendo estado volátil → certificaciones que nunca coinciden | `goal-digest.test.mjs` + los ps1; **añadir** un caso que afirme que el estado del workflow está excluido |
| `.gitignore` ignorando `.codeforge/` entero | **Añadir** un test: `rules/` y `scripts/` deben estar trackeados tras un install en un repo git |
| Divergencia sh↔ps1 | `smoke.sh` hace `diff -rq` entre ambas salidas |
| Layout no cumplido | Paso 7, comparación explícita del árbol |
| Windows | La lección de hoy: verde en local no dice nada. Correr en CI antes de dar por cerrado, y ojo con paths `\` y CRLF |

**Test nuevo que este plan exige** (no existe hoy): una aserción del **layout instalado** — la raíz
contiene exactamente el conjunto de §1 y nada más. Hoy ningún test comprueba el footprint, que es
precisamente por qué se pudo esparcir sin que nadie lo notara.

---

## 5. Sobre installs previos

No hay usuarios reales, así que **no hay migración**: un target instalado con el layout viejo se
reinstala. Queda una decisión pequeña: el bloque de self-heal de `install.sh` (gateado en la presencia
del manifest) ya elimina maquinaria retirada; añadir `shared/` y `.workflow/` a esa lista son ~4 líneas
y evita que un target quede con dos fuentes de verdad simultáneas. **Recomendado**, y no es
retrocompatibilidad sino higiene.
