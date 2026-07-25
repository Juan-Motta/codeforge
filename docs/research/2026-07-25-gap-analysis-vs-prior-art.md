# Gap analysis: forge-ai v0.6.0 frente al prior art (`claude-codex-forge`, `gentle-ai`)

- **Fecha:** 2026-07-25
- **Objeto:** este repo (`forge-ai`, fuente de `@jualopezmo/codeforge` v0.6.0), analizado desde `feat/e2e-spec-bridge`
- **Método:** tres analistas independientes en paralelo (Codex CLI reasoning alto + 2 agentes Claude:
  maquinaria y contenido), con los claims cruzados y spot-checked a mano. Reproducción empírica del
  hallazgo P1. Corridas read-only: `node --test` (162 pass — la cifra de 304 que reportó un analista no se reproduce), `lint-skills` (15 skills, 0 errores),
  `run-evals` (rank-1 91%), `check-gates.sh`, `npm pack --dry-run`.
- **Research previo que este documento corrige:**
  `docs/research/2026-07-25-prior-art-ccf-vs-gentle-ai.md`

---

## Estado de resolución (actualizado 2026-07-25)

Los defectos de §2 marcados P0/P1 con impacto real **ya están arreglados** en
`fix/installer-managed-config` (mergeada a `dev`): el clobber del wizard, la inyección en
`publish.yml`, el aislamiento de la credencial OIDC, `refs/tags/`, el peso del tarball y la
divergencia case-sensitive de `install.ps1`. Ver `docs/CHANGELOG.md` § 0.6.0 y
`docs/plans/2026-07-25-installer-hardening-handoff.md`.

Sigue **abierto** todo §3 (huecos de doctrina: cota del loop de review, split
determinista/inferencial, umbral de riesgo, presupuesto de tokens) y los riesgos de instalador de
§2 marcados 🟡. La migración legacy se descartó a propósito: no hay usuarios reales.

---

## 0. Por qué el research previo estaba parcialmente mal

El research anterior analizó `/Users/juanmotta/Desktop/personal/projects/codeforge`, que **no es este
repo**: es un *install* de v0.5.1 (`codeforge/.forge-version` = `0.5.1` vs `VERSION` = `0.6.0`). Tres
consecuencias:

| Afirmación del research | Realidad en la fuente |
| --- | --- |
| *"Tests propios: **0**"* | 20 archivos `*.test.mjs`, **4.311 LOC de test** sobre 746 de tooling productivo (ratio 5,8:1). Medido: **162 tests, 0 fallos** |
| *"CI: ninguno"* | 4 workflows: `ci.yml` (3 jobs, ubuntu + **windows**), `release.yml`, `publish.yml` (OIDC), `sync-dev.yml` |
| *"Backlog#5: bloquear `git commit && git push` en `claude-gate-hook.sh:20-23`"* | Ese archivo **no existe**: retirado en 0.6.0 y borrado activamente de los targets en upgrade (`install.sh:99-101`, `docs/CHANGELOG.md:15-21`) |
| *"`check-gates.sh` cuenta checkboxes"* | 262 líneas **con identity check** por perfil (`src/shared/scripts/check-gates.sh:100-140`); el snapshot v0.5.1 tenía 201 sin él |
| *"El upgrade real a Verified sigue siendo CI"* | Ya está construido: `src/docs/ci-templates/{gates,e2e}.yml` + README de 14 kB |
| *"skills 456–1.064 tokens, `ship-gates.md` ~2.074"* | La erosión ya ocurrió: `verify-e2e` = **~6.7k tokens**, `ship-gates.md` = **~3.3k** |

**El research subestimó materialmente el repo.** Su diagnóstico central ("codeforge eligió
operabilidad a costa de verificabilidad") era correcto en v0.5.1 y ya no lo es: 0.6.0 construyó el
tier Verified y ató la certificación a digests de árbol Git.

---

## 1. Scorecard: las 7 recomendaciones, re-veredictadas

| # | Recomendación | Veredicto | Evidencia |
| --- | --- | --- | --- |
| 1 | Tests de contrato sobre el markdown | **PARCIAL** — más hecho de lo que el research creía | Existe: 7 clases de ERROR en `tools/lib/skill-lint.mjs:96-144` (frontmatter, `name`==dir, paridad de índice bidireccional con `src/CLAUDE.md`, cuarentena de model-IDs, integridad de referencias `shared/*.md`, y las 3 secciones de anti-racionalización). Falta: cross-check `state.template.md` ↔ anclas de `check-gates`, y la denylist semántica |
| 2 | Evidencia ligada a hash de contenido | **HECHO en `/goal`, FALTA en el path estándar** | `src/shared/scripts/goal-digest.sh:29-36` implementa la técnica de gentle-ai (`snapshot.go`), no la simple de ccf: copia el índice a un temp, `GIT_INDEX_FILE`, `git add -N`, sha256 del diff — sin tocar el índice real. Consumido en `goal-state.md:19` y `goal/SKILL.md:77-78` (`--from-head` post-commit = `initial_review_tree` vs `final_candidate_tree`). Pero `check-gates.sh` no tiene ni una referencia a digest |
| 3 | Convergence breaker | **HECHO en `/goal`, FALTA en el path estándar** | Cotas numéricas en `goal/SKILL.md:58,62` (N=4 plan, N code, `reentries>=3` o `>=3·N`), contador ship-red monótono (`goal-state.sh:24-40`), y `status=halted` terminal (`goal/SKILL.md:93-95`). Pero `severity.md:16-17` sigue siendo *"repeat. Exit only when a single pass yields no P0/P1/P2"* — **sin techo** |
| 4 | Presupuestos acotados + split determinista/inferencial | **FALTA** | `severity.md` no distingue "vi este comando fallar" de "creo que esto race-ea". P2 = *"code smell, maintainability, unclear intent"* (`:10`) **bloquea y consume iteración** — doctrina opuesta a gentle-ai, donde WARNING/SUGGESTION se congelan como `info` sin consumir presupuesto |
| 5 | Bloqueo de comandos-ship compuestos | **NO APLICA** — el research se equivocó | El hook no existe. La superficie residual es la allowlist nativa de cada engine, cuyo parseo es del harness. Hueco propio menor: los deny son por prefijo, así que `git push origin main --force` no matchea `Bash(git push --force:*)` y cae a `ask` |
| 6 | Umbral de riesgo determinista | **FALTA** | `check-gates.sh:29` **lee** el perfil con un `sed` del archivo que el agente escribió; nunca lo computa. Sin `git diff --numstat`, sin paths hot. El criterio es prosa en 4 sitios (`workflow.md:14`, `ship-gates.md:85`, `CLAUDE.md:46`, `quick-fix:3,8`), y *"no behavior risk"* no es computable |
| 7 | Presupuesto de tokens por skill | **PARCIAL y ya erosionado** | Solo `SKILL_MAX_LINES = 500` y **como warning** (`skill-lint.mjs:14,146-147`). `verify-e2e` tiene 447 líneas → **pasa**, con ~6.7k tokens. Medir en líneas es medir el equipaje por número de maletas |

**Balance:** 2 de 7 estaban mal encuadradas (#1 exagerada, #5 obsoleta), 2 están hechas pero solo
dentro de `/goal` (#2, #3), y 3 siguen abiertas tal cual (#4, #6, #7).

---

## 2. La inversión de prioridades: el riesgo está en el instalador

Los tres analistas llegaron a la misma conclusión, y es la más importante de este documento:

> Se invirtió rigor extraordinario en el gate E2E — harness de 447 líneas, tests adversariales con
> Chromium real, pins byte-a-byte — mientras **el instalador que entra en repos ajenos y se publica
> a npm** tiene defectos que causan pérdida de configuración downstream.

Eso es peor que un checkbox débil: un checkbox débil deja pasar un bug propio; un instalador que
sobrescribe configuración rompe el repo de otra persona.

### 🔴 P1 — `--upgrade` se come la configuración del wizard, en silencio y sin backup

**Reproducido empíricamente** (target limpio en scratchpad, `git init`, install, simular wizard,
`--upgrade`):

```
tras install:   **Profile:** standard
tras "wizard":  **Profile:** light
tras --upgrade: **Profile:** standard      ← revertido
backups:        NO hay .bak de models.md ni en la raíz
```

Causa raíz: el wizard escribe en dos archivos **MANAGED** que el instalador copia sin condición.

- `cli/lib/apply.mjs:49-59` (`applyModels`) escribe un bloque managed en `shared/rules/models.md`
  con `Default reviewer(s):` y `Council advisors:`.
- `cli/lib/apply.mjs:61-67` (`applyProfile`) escribe `**Profile:**` en `shared/state.template.md`.
- `install.sh:160-162` es un `cp` pelado sobre **todos** los `shared/rules/*.md`.
- `install.sh:173` es un `cp` pelado de `state.template.md`.

Cinco agravantes:

1. **El propio archivo invita a editarlo**: `apply.mjs:15` escribe el comentario *"Managed by the
   codeforge setup wizard. **Edit here** or re-run the wizard."*
2. **No hay `.pre-forge.bak` para estos dos**, a diferencia de `CLAUDE.md`, `AGENTS.md`,
   `.claude/skills`, `.agents/skills` y `docs/ci-templates/*`, que sí lo tienen.
3. **`--upgrade` salta el wizard** (`bin/codeforge.mjs:46`, `cli/lib/flags.mjs:13-18`), así que la
   ruta de upgrade documentada nunca reaplica la configuración.
4. **Las respuestas del wizard no se persisten en ningún sitio** → no hay forma de reaplicarlas sin
   volver a teclearlas.
5. **CI está verde sobre esto**: `tests/smoke.sh:107-113` prueba que el upgrade preserva `PROJECT.md`
   y una regla con nombre propio del usuario — pero no el bloque managed de `models.md`.

Un equipo que eligió perfil `light` y `claude` como reviewer termina, tras un
`npx @jualopezmo/codeforge --upgrade`, en `standard` con `codex`. Sin aviso.

**Fix mínimo:** persistir las respuestas del wizard en un archivo project-owned (p. ej.
`.codeforge/config.json`) y re-renderizar los bloques managed desde ahí en cada install; o, como
parche inmediato, `.pre-forge.bak` para esos dos archivos.

### 🔴 P1 — Inyección de comandos en `publish.yml`

`.github/workflows/publish.yml:45`: `tag="${{ inputs.tag }}"` dentro de un `run:`. GitHub Actions
interpola `${{ }}` **textualmente antes** de que corra el shell, en un job con `id-token: write`.
Un input como `v1.0.0"; curl … | sh; #` ejecuta. Requiere permiso de dispatch (write), así que es
escalada write→publish, no RCE externo — pero el job posee la credencial OIDC de publicación.

**Fix:** pasar por `env:` y validar `^v[0-9]+\.[0-9]+\.[0-9]+$`. Dos líneas.

### 🟠 P2 — `npm publish` sin gate de tests

`publish.yml` hace checkout del tag, valida que el tag coincida con `package.json`, y publica. No
corre `npm ci`, ni `npm run check`, ni `smoke.sh`. La garantía es *"CI corrió en `main` en algún
momento"*, no *"este tag pasa"*. Un tag creado a mano publica.

Relacionado: `publish.yml:41` hace `npm install -g npm@latest` sin pin — la cadena de publicación
depende de lo que npm publique ese día.

### 🟠 P2 — 867 kB de PNG inerte: el 90% del paquete npm

Medido con `npm pack --dry-run`: **package size 960,5 kB, 82 archivos**, de los cuales
`cli/assets/codeforge-icon.png` son **867,2 kB**. Es un input **dev-only** de `tools/gen-splash.mjs`;
el runtime imprime el string ya committeado en `cli/assets/anvil.ans.mjs` (7,6 kB). No hay
`.npmignore` y `files: ["cli/", …]` lo arrastra. Todo usuario de `npx` lo descarga cada vez.

Relacionado: `ink` + `react` son `dependencies`, no `optionalDependencies` (`package.json:27-32`),
aunque `bin/codeforge.mjs:49` las importa dinámicamente y solo en modo interactivo. Un instalador de
shell scripts arrastra el árbol de React a cada `npx`, y en CI/no-TTY nunca se usa.

### 🟠 P2 — `--upgrade` es un flag que miente

`MODE` solo se usa en el `echo` de `install.sh:72` (verificado: 3 hits en total). Install y upgrade
son el mismo code path. La lógica real de migración se gatea en la existencia de `.forge-manifest`
(`install.sh:94`) más una señal `old_install`.

**Matiz importante frente a ccf:** esto es *más seguro* que el `--upgrade ⇒ FORCE` de ccf, que es un
footgun de pérdida de datos documentado. Y la migración de forge-ai hace **backup en vez de borrar**
(`install.sh:117-123`). El problema es que el flag no significa nada y la doc sugiere que sí.

No existe `uninstall` (`grep -rn uninstall` → 0 hits), ni dry-run, ni rollback, ni detección de
archivos managed modificados.

### 🟡 P3 — Otros riesgos de instalador verificados

- **`shared/` se escribe en la raíz del proyecto ajeno sin backup.** Hay `.pre-forge.bak` para
  `CLAUDE.md`, `AGENTS.md`, los dos mirrors de skills, `configs/`, `skills/` y `docs/ci-templates/*`
  — pero `shared/rules/` y `shared/scripts/` se escriben directo (`install.sh:136-183`). Un monorepo
  con un `shared/` propio recibe subdirectorios inyectados sin aviso.
- **`src/sync.sh:54-61` borra `.claude/skills` y `.agents/skills` enteros** (`rm -rf` + `cp -R`). El
  marker `.forge-generated` protege el **directorio completo**, no las skills individuales dentro:
  una skill que el usuario añada en el sitio natural desaparece sin backup. Es intencional
  ("full mirror: replace so deletions propagate" — y es lo que le da propagación de borrados, algo
  que el modelo merge de ccf no logra), pero no hay warning ni ruta alternativa en el target.
- **Deriva CRLF sh↔ps1.** `install.ps1:185,188` usan `Set-Content` → CRLF en Windows. Después, en
  macOS, `install.sh:153` (`grep -qxF`) falla contra `"rule:foo.md\r"` y `install.sh:67`
  (`grep -q '^localsettings:managed$'`) también → el instalador se niega a regenerar un
  `.claude/settings.local.json` que él mismo creó. No cubierto: `smoke.sh:101` (`diff -rq`) solo
  corre en POSIX y el job de Windows no corre `smoke.sh`.
- **`--git-init` hace `git add -A` + commit del árbol completo** (`install.sh:341-342`). En un
  directorio con secretos o `node_modules/` sin `.gitignore` previo, el baseline los captura.
- **Sin job macOS en CI.** Distribuyes un `install.sh` POSIX y macOS trae bash 3.2 — exactamente la
  clase de bug que rompe a gentle-ai hoy (`declare: -A: invalid option`).

---

## 3. Los huecos de doctrina que quedan (puro markdown, coste bajo)

### 3.1 El loop de review no tiene techo en el path estándar

`src/shared/rules/severity.md:16-17`: *"run reviewers, collect findings, fix P0/P1/P2, **repeat**.
Exit only when a single pass yields no P0/P1/P2 from all reviewers."* Replicado en
`new-feature/SKILL.md:46` y `review/SKILL.md:44`. Lo único parecido a una cota es
`review/SKILL.md:67` — *"The loop has run **many** passes without converging — escalate, don't
grind"*. "Many" no es una cota: es la escapatoria que un breaker existe para eliminar.

Combinado con que **P2 bloquea** y P2 es *"code smell, maintainability, unclear intent"* — categorías
inherentemente opinables — un revisor estocástico puede generar P2 nuevos en cada pase y forzar otra
ronda indefinidamente. Es la receta exacta del incidente de ccf (iteración 15 → 25 en un branch ya
certificado limpio, `ccf/docs/CHANGELOG.md:77`), y forge-ai no tiene ni el breaker que lo corta ni el
downgrade de P2 que lo previene.

**Coste del fix: 4 líneas + un párrafo.**

### 3.2 El breaker de `/goal` falla abierto, por escrito

`src/skills/goal/SKILL.md:113` es un red flag que dice: *"Review-log lines that `goal-state.sh
round-count` can't parse (**breaker silently no-ops**)."* Y `goal-state.sh:16` es un `grep -c`:
**cuenta, no compara**. La comparación `round-count == 4` la hace el agente leyendo un número que
está en prosa dentro de la misma skill que se le pide obedecer.

`N` no vive en ningún artefacto ejecutable: `grep -rn "N=4" src` devuelve solo
`goal/SKILL.md:58,62`. `goal-state.md` — el archivo declarado fuente de verdad de los esquemas — no
lo documenta.

Contraste con ccf: `POST_CERT_REVIEW_ROUND_LIMIT=3` vive en `ccf/hooks/lib/review-breaker.sh:13` con
el comentario *"canonical home — mirrored to prose by test-contracts.sh"*, la comparación está en
`:89`, **y un `N/A:` que borre el contador dispara el breaker** (fail-closed, `:50-58,91`).

La doctrina de forge-ai es **mejor** (digest de árbol > head SHA); la ejecución no existe.

**Fix:** mover `N`/`MAX_REENTRIES` a `goal-state.md`, hacer que `goal-state.sh round-count` compare y
salga non-zero, y tratar una línea no parseable como **trip**, no como no-op. **S/M.**

### 3.3 `quick-fix` puede shippear con el Tier B incapaz de correr

`src/skills/quick-fix/SKILL.md:14` dice que `.workflow/state.md` es **opcional**. Y
`check-gates.sh:23-27` sale **3** ("cannot verify gates") si no hay archivo de estado. `quick-fix` es
además **la única skill de workflow que no menciona `check-gates` en ninguna línea**: su §4 Ship va
directo al prompt nativo.

La rampa por tamaño de tarea es correcta — es justo el fallo que el audit de gentle-ai denuncia
(*"simple doc work launching the same verification as executable behavior"*) — pero tiene el freno
de mano quitado en su extremo bajo.

Hueco relacionado: la lista de cajas del perfil `light` **no existe en el template**.
`src/shared/state.template.md:17` dice *"for the `light` profile use its shorter list"* sin
incluirla, y `check-gates.sh:138` remite al template para restaurarlas. El único sitio con el wording
canónico es `ship-gates.md:83-85`, al que el mensaje de error no apunta. Un usuario de `quick-fix`
tiene que inventar un wording que las anclas `change .*verified` / `still trivial` exigen.

### 3.4 Falta el split determinista/inferencial

La doctrina **ya existe en el repo**, pero aplicada a debugging, no a review:
`fix-bug/SKILL.md:26` (*"Distinguish what you verified from what you infer"*),
`shared/rules/research.md:20`, y la golden rule `src/CLAUDE.md:35`. No se aplica a los hallazgos de
review, que es donde gentle-ai la usa (refuter adversarial sobre hallazgos severos inferenciales).

**Fix:** en `severity.md`, exigir que cada hallazgo declare `deterministic|inferential` + el comando
que lo prueba. Los deterministas van directo a fix; solo P0/P1 inferenciales requieren segundo pase;
P2 inferencial no puede crear loops. **S, puro markdown.**

### 3.5 Dos doctrinas que ccf tiene y forge-ai no

- **"NO BUGS LEFT BEHIND"** (`ccf/rules/critical-rules.md`): *"Never defer known issues 'for later'…
  no 'follow-up PR' for known problems."* forge-ai no lo tiene en ninguna rule; el único rebuttal
  cubre solo el changelog (`finish-branch:77`).
- **Una rule de seguridad de suministro para skills/MCP de terceros** (`ccf/rules/skill-audit.md`,
  63 líneas: tool poisoning, rug pull, response injection, pinning de versión). `grep -i` por
  injection/poisoning/supply-chain en `src/skills` + `src/shared/rules` → **0 hits**. Es incómodo de
  omitir en un producto que **es** un instalador de skills distribuido por npm — y que tiene una
  inyección de comandos en su propio pipeline de publicación (§2).

### 3.6 Presupuesto de contexto: no existe la guía, y ya se erosionó

Medido (tokens ≈ chars/3,7, estimación):

| artefacto | líneas | ~tokens | vs presupuesto de gentle-ai (1000 máx duro) |
| --- | --- | --- | --- |
| `verify-e2e/SKILL.md` | 447 | **~6.700** | **6,7×** |
| `shared/rules/ship-gates.md` | 199 | ~3.300 | — (era ~2.074) |
| `goal/SKILL.md` | 129 | ~2.240 | 2,2× |
| `new-feature/SKILL.md` | 95 | ~1.270 | 1,3× |
| las otras 11 skills | 50–88 | 530–1.180 | en el rango de recomendado a límite |

`find` por `*style*`/`*budget*` en el repo → **0 resultados**: no existe análogo de
`gentle-ai/docs/skill-style-guide.md` (orden de secciones obligatorio, 180–450 objetivo, ≤700
recomendado, 1000 máximo duro, DON'T list).

**Nota justa sobre `verify-e2e`:** ~200 de sus 447 líneas son un harness JS embebido
(`:138-335`, delimitado por `<!-- e2e-ui-ref:start/end -->`) con archivo canónico
(`tools/e2e-ui-ref/run-journey.mjs`) y test de deriva (`tools/test/skill-embed-drift.test.mjs`). El
embed es una **decisión consciente** para ser portable a los tres motores sin depender de un path del
instalador — no un descuido. Pero el coste es real: cada invocación paga ~6,7k tokens, de los cuales
~5k son JavaScript que el modelo debe copiar sin modificar. Candidato de compresión inmediata: el
bloque PERSIST está **duplicado verbatim dentro del mismo archivo** (`:95-104` ↔ `:389-397`, ~450
tokens).

### 3.7 Cuatro incoherencias puntuales (S cada una)

1. `finish-branch/SKILL.md:66,70` apuntan a `goal` **§8** y **§6.5**; `goal/SKILL.md` tiene §0–§4. El
   contenido referido existe (§3 y §2), son punteros obsoletos. El linter no los ve: `SHARED_REF_RE`
   valida paths `shared/**.md`, no anclas `§N`.
2. `check-gates.sh:138` remite a `state.template.md` para restaurar cajas, pero el template no
   contiene la lista `light` (§3.3).
3. **`execution.md:45-46`**: `commit_policy` por defecto es `per-task` — *"implement TDD, run the
   covering tests, **commit**"* — mientras `src/CLAUDE.md:31` y `ship-gates.md:3-4` prohíben
   `git commit` antes de que todas las cajas estén verdes. La entrada de `defer` dice explícitamente
   que *ella* preserva esa regla *"even in subagent-driven mode"*, admitiendo por implicación que el
   default no. Marcado *"(Legacy incremental behavior; unchanged.)"* → deuda conocida, pero ninguna
   regla declara la excepción.
4. `review/SKILL.md:28-30` **hardcodea** `--sandbox read-only` y las tres formas de invocación,
   mientras `council/SKILL.md:43-45` dice explícitamente *"live in one place — `shared/rules/models.md`
   — so use them from there; **do not hard-code them here**"*. Dos skills hermanas con política
   opuesta sobre el mismo dato; `skill-lint.mjs:20-21` pone en cuarentena los model-IDs pero no las
   formas de invocación.

### 3.8 Dogfooding: el propio `.workflow/state.md` no pasa el identity check

`.workflow/state.md:23` en `feat/e2e-spec-bridge` dice `- [ ] Change verified by exercising it` —
wording del perfil **light** — mientras declara `Profile: standard`, cuya ancla canónica es
`e2e verified;E2E verified` (`check-gates.sh:67`). Es el caso de test `'h'`
(`tools/test/check-gates.test.mjs:125-132`).

**Matiz que corrige a uno de los analistas:** el template que se **envía** es correcto
(`src/shared/state.template.md:23` = `E2E verified via verify-e2e (report: …)`). El archivo desfasado
es solo el state local del repo, heredado de una versión anterior. Es el identity check funcionando,
no un defecto del producto. Pero bloquearía tu propio ship en esta branch.

---

## 4. Donde forge-ai está genuinamente por delante de ambos

Verificado, y vale la pena registrarlo para no regresionarlo:

1. **La escalera Verified / Attested / Advisory** (`ship-gates.md:108-144`) sigue siendo el mejor
   artefacto conceptual de los tres repos, y **se reforzó**: ahora enumera las **cinco
   precondiciones** sin las cuales el tier Verified degrada (CODEOWNERS sobre el workflow, CODEOWNERS
   sobre los archivos que definen los tests, dismiss-stale-approvals, strict checks o merge queue,
   bypass deshabilitado para admins), y cierra con dos concesiones que casi nadie escribe: *"this only
   routes the diff to a human code owner — it still depends on that human actually reading the change,
   not rubber-stamping it"* (`:130-132`) y *"Repo/org admins can still bypass branch protection"*
   (`:134`).
2. **"Scope of the guarantee — be precise, not sweeping"** (`:59-72`) publica el hueco residual de su
   propio mecanismo, incluida la vía de bypass que **no** cubre: *"A committed report with a
   hand-typed `VERDICT: PASS` and no verify-e2e run behind it satisfies every check above"*. Ni ccf ni
   gentle-ai hacen esto en ningún archivo. Y se rehúsa consistentemente a decir "proof":
   *"bad-faith-**resistant** (never 'proof')"* aparece tres veces.
3. **Anti-racionalización como ERROR de lint, catálogo completo.** 15/15 skills con
   `## Verification` + `## Common rationalizations` + `## Red flags`, **62 filas + 59 red flags**,
   con `skill-lint.mjs:141-144` impidiendo que una skill nueva se shippee sin ellas. gentle-ai testea
   allowlist/denylist sobre 3 orchestradores; ccf no testea prosa en absoluto. La mejor fila de las
   62 ataca la presión de autoridad, no el error técnico: `fix-bug:65` — *"**It's late / the lead
   said skip the regression test.**" | "Time and authority pressure don't change that an unproven fix
   regresses."*
4. **El problema de las 12 copias de markdown de gentle-ai no existe aquí por construcción.**
   `src/sync.sh:50` es literalmente `cp CLAUDE.md AGENTS.md`; los dos mirrors de skills son dos
   `cp -R` de una fuente. No hay parser, no hay merge, no hay symlink. gentle-ai necesitó
   `boundedreview.go:54-73` (sobreescribir 12 copias en tiempo de instalación) para resolver un
   problema que forge-ai no tiene.
5. **Ninguno de los 3 bugs de installer de ccf aplica, salvo uno.** No hay modo `--global`, no hay
   `jq`, no se mergea JSON del usuario (los engine configs se **generan** desde `src/configs/`), y hay
   4 backups `.pre-forge.bak` reales + un marker de propiedad. El manifest se trata como **untrusted**
   al prunear (rechaza `/`, `..`, no-`.md` — `install.sh:151-155`). El único que sí aplica es
   `--upgrade` sobrescribiendo customizaciones (§2).
6. **CI en Windows nativo**, que es donde gentle-ai falla (su `unit-tests` es ubuntu-only y sus tests
   fallan en macOS ahora mismo). `ci.yml:48-77` corre `install.ps1` + el wrapper npx + `node --test`
   completo bajo semántica nativa de path/shell.
7. **Los skips silenciosos están cerrados a propósito.** `E2E_BROWSER_REQUIRED=1` fuerza la ejecución
   real en CI (`ci.yml:33-35`). Y se usa `node --test tools/test/` (descubrimiento automático), no la
   allowlist hardcodeada de gentle-ai (`-run '^(…)$'`) donde renombrar un test lo saca del gate en
   silencio.
8. **Tests genuinamente adversariales.** `check-gates.test.mjs` (28 tests, 637 L) crea repos git
   reales, symlinks reales, traversal, y **cada test documenta el bypass que cierra** ("*Bypass found
   by adversarial re-review*"). `ci-template.test.mjs` (104 tests) tiene un fixture-mutante negativo
   por cada aserción positiva. `skill-embed-portability.test.mjs` corre `install.sh` de verdad,
   extrae el JS embebido del SKILL.md instalado y lo ejecuta con browser real para probar que no
   depende de `tools/`.
9. **Fallback single-engine con waiver auditable** (`ship-gates.md:92-106`): degrada honestamente en
   vez de volverse insatisfacible. ccf toma la postura opuesta y la paga: *"Codex is mandatory —
   there is no 'codex unavailable' escape"* (`ccf/rules/workflow.md:119`), lo que rompe el harness
   para quien corre un solo CLI.
10. **`/goal` es más disciplinado que el `/goal` de ccf**: dos gates humanos explícitos (no uno),
    preflight de capacidades que HALTa antes de entrar al loop en vez de descubrir el stall a mitad,
    commit **antes** del gate con re-verificación del digest committeado, y `status=halted` terminal
    para la automatización. ccf autoriza el PR sobre trabajo no committeado.

---

## 5. Juicio de posicionamiento

**forge-ai no está reinventando algo que ya perdió. La tesis es defendible y en algunos ejes es la
mejor de las tres.** ccf es el más parecido pero sigue siendo Claude-first con Codex como
subproceso (0 hits de `opencode` y de `AGENTS.md` en todo su repo); gentle-ai resolvió un problema
mayor con una máquina de estados que **sus propios mantenedores puntúan como "Operable: Not for
recovery"**. La combinación de payload pequeño, tres engines de verdad, distribución npm, una sola
fuente de reglas, CI templates para el tier Verified, evals de routing deterministas y honestidad
explícita sobre Attested vs Verified es una diferenciación real que ninguno de los dos tiene.

**Pero las prioridades están invertidas.** El gate E2E tiene rigor de producto maduro mientras el
instalador —la superficie que toca repos de terceros— puede borrar configuración sin backup, y el
pipeline de publicación tiene una inyección de comandos y ningún gate de tests.

**Recomendación sin diplomacia: no adoptar más maquinaria de review del prior art hasta cerrar §2.**
Los huecos de doctrina de §3 son de coste bajo (mayoría markdown, 4–10 líneas cada uno) y pueden ir
en paralelo. Pero mientras el instalador pueda comerse la configuración de un equipo downstream, cada
hora invertida en el breaker es una hora mal asignada. El orden correcto es:

1. **§2 completo** — wizard config persistida, `publish.yml` (env + validación + `npm run check`),
   `.npmignore` para el PNG, backups para `shared/`.
2. **§3.1 + §3.4** — cota del loop y split determinista/inferencial. ~10 líneas de markdown, cierran
   el modo de fallo más caro en tokens.
3. **§3.2 + §3.3** — hacer ejecutable el breaker de `/goal` y cerrar el bypass de `quick-fix`.
4. **§3.6 + §3.7** — guía de presupuesto, comprimir `verify-e2e`, las 4 incoherencias.

---

## 6. Límites de este análisis

- **Los tokens son estimaciones** (`chars/3,7`), no conteos con tokenizador. Líneas, palabras y bytes
  sí son medidos. La clasificación de `verify-e2e` como 6,7× el máximo es robusta; la de `plan`
  (~1.000, en el límite exacto) no lo es.
- **No se ejecutó la suite completa del repo** para respetar el read-only: varios tests escriben
  fixtures y uno crea contenido bajo `.workflow/`. Sí se corrieron `node --test` (162 pass),
  `lint-skills`, `run-evals`, `check-gates.sh` y `npm pack --dry-run`.
- **La reproducción del P1 se hizo sobre un target de scratchpad**, simulando la escritura del wizard
  (que es interactivo). La mitad de `state.template.md` se reprodujo end-to-end; la de `models.md` se
  verificó por lectura del code path (`apply.mjs:49-59` + el `cp` pelado de `install.sh:160-162`).
- **Branch protection / required status checks no son verificables** desde el árbol — mismo límite
  que el research anotó para gentle-ai. Que `ci.yml` gatee no prueba que esté marcado como required.
- **El orden de precedencia de los `deny` en `src/configs/opencode.json`** (force-push declarado
  después de `git push*: ask`) no se pudo confirmar sin la implementación de OpenCode. Queda como
  riesgo declarado, no como bug.
- **No se verificó el comportamiento runtime en los tres engines.** Que el instalador escriba los
  archivos correctos está probado; que Claude Code, Codex y OpenCode los carguen y enruten igual, no.
  El claim *"runs identically"* del `package.json` es más fuerte de lo que hay evidencia para
  sostener; *"same shared discipline, engine-specific capabilities"* sería exacto.

---
