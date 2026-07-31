# Research: prior art — `claude-codex-forge` vs `gentle-ai`

- **Fecha:** 2026-07-25
- **Pregunta:** ¿qué tiene bueno cada uno y cuál vale más la pena analizar a fondo, para
  informar el diseño de codeforge?
- **Método:** clones shallow analizados en paralelo por tres analistas independientes
  (Codex CLI con reasoning alto + 2 agentes Claude, uno por repo). Claims cruzados y
  spot-checked a mano contra el código. Los tres coincidieron en los hallazgos
  principales sin conocer el output de los otros.
- **Fuentes:** `github.com/pablomarin/claude-codex-forge` @ `80dffe8` (v5.60),
  `github.com/Gentleman-Programming/gentle-ai` @ `e01b114` (post-v2.1.11).

---

## TL;DR

| Pregunta | Respuesta |
| --- | --- |
| ¿Cuál es más comparable a codeforge? | **ccf** — es el mismo producto (skills+hooks+markdown para Claude Code/Codex). Competidor directo. |
| ¿Cuál está mejor construido? | **gentle-ai**, por dos órdenes de magnitud (232k LOC Go, 3.768 tests, CI, releases firmadas). |
| ¿Cuál vale más analizar a fondo? | **Los dos, por razones distintas.** ccf para *copiar mecanismos*; gentle-ai para *copiar doctrina*. Ver "Veredicto". |
| ¿Alguno hace algo que codeforge deba temer? | Sí: ambos atan la evidencia al **contenido** (hash/tree), no al checkbox. Es el techo que `ship-gates.md` ya admite tener. |
| ¿Alguno es multi-engine de verdad? | ccf **no** (0 hits de `opencode` y de `AGENTS.md` en todo el repo). gentle-ai sí, 16 adapters — pero con profundidad muy desigual. |

**Sesgo a corregir de entrada:** el conteo de estrellas invita a estudiar gentle-ai y
descartar ccf. Es al revés en términos de aplicabilidad: ccf tiene 5 estrellas y un
`CHANGELOG` de 931 líneas que es el mejor artefacto de los dos repos, porque documenta
los fallos de campo exactos que un sistema como codeforge va a encontrar.

---

## Escala y salud (medido, no declarado)

| | claude-codex-forge | gentle-ai | codeforge |
| --- | --- | --- | --- |
| Lenguaje | Bash/PowerShell + Markdown | Go 1.25 | Markdown + Shell |
| Código | ~38k líneas (md/sh/ps1/py/json) | 232k LOC Go (62% tests) | 2.746 líneas md + 476 sh |
| Stars / forks | 5 / 3 | 5.051 / 602 | — |
| Commits / autores | 187 / 3 (176 de 1) | 1.332 / 59 (83% de 1 persona) | no es repo git |
| Tests propios | 13 suites shell registradas (14 archivos) | 3.768 funciones `Test*`, mediana ~80% cobertura | **0** |
| CI | **ninguno** (0 archivos en `.github/`) | 3 workflows (ubuntu-only en unit tests) | ninguno |
| Releases | ninguna; versión = heading del CHANGELOG | 19 tags, GoReleaser + firma minisign | `.forge-version` 0.5.1 |
| Bus factor | 1 | ~1 | 1 |

Ambos son proyectos de **una persona en iteración muy intensa** (ccf: 60 minor versions;
gentle-ai: ~32 commits/día y v1.45→v2.1.11 en 15 días). El propio README de gentle-ai
declara su línea RDD **inestable** y recomienda v1.46.0 para instalación estable.

---

## Repo A — `claude-codex-forge` (v5.60)

### Qué es

Un *harness* de ingeniería para **Claude Code**, con Codex CLI como revisor externo
invocado por subproceso. Se distribuye por `git clone` + `setup.sh` (1207 líneas) /
`setup.ps1` (1331), sin build ni runtime — ADR `docs/adr/0003-template-distributed-no-build-step.md`.
Instala 9 hooks × 2 plataformas, 8 slash-commands, 13 rules, 4 agents, 4 skills y 41 docs.

**No es multi-engine.** Verificado: `grep -ril opencode` → 0 hits; `grep -rl 'AGENTS\.md'`
→ 0 hits. No hay `.codex/config.toml` ni escritor de `AGENTS.md`. La versión agnóstica
existe sólo como plan sin empezar (`docs/plans/2026-05-25-agent-agnostic-forge.md`,
13 PRs / 6-10 semanas), y ese plan documenta el bloqueo real: **Codex no soporta
slash-commands de proyecto** ("⚠ FATAL: PR-B3 v1 cannot ship as written", línea 26) y
los hooks de `Stop` corren concurrentes en Codex, rompiendo el ordering
`build-evidence → check-state-updated` del que ccf depende.

### Las ideas que valen (con mecanismo)

1. **Evidencia ligada al hash del artefacto, no al checkbox.**
   `hooks/check-workflow-gates.sh:559-646`. Si el state dice
   `- [x] Plan review loop (N iterations) — PASS`, el hook exige por iteración una línea
   `— codex clean — plan=\`<path>\` — plan_sha=\`<sha256>\`` y **recalcula el sha256 del
   archivo del plan**. Si el plan cambió después de revisarse → bloqueo. Para código el
   binding es `head=<sha>` contra `git rev-parse HEAD` (`:735`). Esto convierte "revisado"
   de afirmación en hecho verificable contra contenido. **Es la mejora más directa sobre
   un ship-gate narrativo.**

2. **Convergence breaker: la única regla de parada dura del análisis.**
   `hooks/lib/review-breaker.sh` + ADR 0009. Incidente real: un branch certificado limpio
   por ambos engines en la iteración 15 llegó a la 25 sin converger (`docs/CHANGELOG.md:77`).
   Mecanismo: *certificación* = primera iteración con ambos engines limpios al mismo head
   (`:60-69`); rondas post-cert = `max(LOOP_N − CERT_N, filas post-cert)` (`:85-87`); trip
   si supera `POST_CERT_REVIEW_ROUND_LIMIT=3` (`:13`, `:89`). Sólo lo libera un humano con
   una línea ligada al head. Y **detecta la evasión**: borrar el contador poniendo
   `Code review loop — N/A:` también dispara el breaker (fail-closed, `:56-58`).

3. **Bloqueo de comandos-ship compuestos.**
   `check-workflow-gates.sh:81-109`. `git commit -m x && git push` validaría la evidencia
   contra el HEAD **pre-commit**, pasaría, y luego el push shippearía el HEAD nuevo sin
   segundo chequeo. ccf normaliza separadores (incl. los `\n` literales del fallback sin
   jq → `;`) y bloquea si hay un verbo-ship después de un separador. Tolera prefijos de env
   (`FOO=bar git push`) y opciones globales (`git -C dir commit`).

4. **Carve-out docs-only que no muta el estado.**
   `check-workflow-gates.sh:284-363`. Si el staged diff es **sólo** documentación, se salta
   los gates **sin escribir nada** en state.md — las casillas siguen `- [ ]`, así que el
   push del código real sigue bloqueado. Declina el carve-out ante `-a/--amend/--include/
   --patch/-i` porque esas formas comprometen contenido invisible en el diff staged.
   Resuelve un incentivo real de corrupción del registro (marcar 4 gates `N/A` para poder
   commitear un docs checkpoint, y que nadie los reabra).

5. **Merge de settings add-only con reconstrucción de orden semántico.**
   `scripts/merge-settings.py:51-129`. El orden de los hooks de `Stop` es semántico
   (`build-evidence` escribe un fingerprint que `check-state-updated` lee), así que un
   merge que apendea rompe el sistema. Reconstruye la lista en orden de template,
   sustituyendo por identidad `(type, command, prompt)`, y detecta cambios *solo de orden*
   para no saltarse el write. Backup timestamped antes de tocar nada.

6. **Estado volátil deliberadamente fuera del contexto auto-cargado.**
   ADR `0001-volatile-state-not-auto-loaded.md`. `.claude/local/state.md` es gitignored
   **y no auto-cargado**; los hooks lo parsean por shell y el agente lo lee on-demand.
   Rechazaron explícitamente `CLAUDE.local.md` (el mecanismo auto-cargado de Anthropic)
   porque el estado de ayer re-entrando al contexto de hoy causó que Claude citara PRs ya
   mergeados como abiertos con `main` 97 commits atrás.

7. **Patrón dos-archivos para output de subproceso.**
   `commands/codex.md:73,99`. `--output-last-message /tmp/codex_response.txt` para el
   veredicto limpio, y `> /tmp/codex_response_full.txt 2>&1` para el transcript forense que
   **nunca entra al contexto**. Antes de esto un usuario recibió un review de **1.9 MB** en
   contexto (`docs/CHANGELOG.md:105`). Si el veredicto sale vacío se considera fallo y se
   prohíbe inventar conclusión.

8. **Workarounds con criterio de retirada explícito.**
   `hooks/lib/codex-pty.sh:23`: *"RETEST CRITERION: drop this shim once codex 0.128+ is
   empirically confirmed clean"*. Un shim con fecha de caducidad documentada, no deuda
   perpetua.

9. **El `CHANGELOG` como artefacto de ingeniería.** 931 líneas; cada entrada es
   síntoma de campo → causa raíz → fix mínimo → test discriminante → residuales aceptados
   a propósito. v5.60 se descubrió corriendo su propio `--upgrade` (dogfooding real).

### Debilidades reales (verificadas, no inferidas)

- **El gate E2E falla abierto en cualquier repo que no integre en `main`/`master`.**
  `check-workflow-gates.sh:438` sólo prueba `git merge-base HEAD main || … master`. Sin
  match → gate saltado en silencio. Reproducido con fixture: repo que integra en `dev`
  con la casilla marcada y sin reporte → `rc=0`; el mismo estado con el branch renombrado
  a `main` → `rc=2`. Y el repo **ya tiene** `hooks/lib/default-branch.sh` que resuelve
  `origin/HEAD`; `check-state-updated.sh:164` lo usa, `check-workflow-gates.sh` no.
  **codeforge está objetivamente por delante aquí** (`check-gates.sh:166-177` prueba
  `dev/main/master/origin/*` y elige el merge-base más cercano).
- **Frescura por mtime, no por git** (`:456-474`, `stat -c %Y`). Un `git clone` o
  `checkout` resetea todos los mtimes → todos los reportes parecen frescos. Peor:
  `setup.sh:538-544` crea `tests/e2e/reports/.gitignore` con `*`, así que **la evidencia
  a la que el gate se liga nunca llega al PR** y ningún humano puede verla.
- **Falsos positivos de los guardrails de Bash.** `check-bash-safety.sh:57` matchea
  `/dev/tcp/` en cualquier parte del comando → `grep -rn "/dev/tcp/" .` es imposible para
  el agente. También bloquea `pip install requests` y `npm install -g @openai/codex`, que
  es literalmente el paso 3 del quick-start de su propio README. Llevan v5.56, v5.57 y
  v5.60 consecutivas arreglando esta clase.
- **Inyección de comandos vía heredoc sin quotear.** `scripts/migrate-continuity.sh:187-209`
  usa `<<EOF` (delimitador sin quotes) interpolando texto leído de `CONTINUITY.md`. Una
  fila de tabla con `$(...)` **se ejecuta** durante `--migrate`. Input alcanzable por
  cualquiera que pueda landear un commit.
- **`--global` muere en silencio.** `setup.sh:237` es `MERGED=$(jq … 2>/dev/null)` bajo
  `set -e`: con un `~/.claude/settings.json` malformado jq falla, el script aborta ahí, y
  el fallback a python3 más el consejo "install jq or python3" son **código muerto**.
- **El merge global destruye hooks del usuario** con tres semánticas distintas
  (jq `*` recursivo / python `existing['hooks'] = template['hooks']` / PS `Add-Member -Force`)
  y sin backup — y los tres imprimen *"your settings preserved"*.
- **Markdown como base de datos.** 757+599+253 líneas de bash parseando checkboxes con
  awk/grep/sed. Los anclajes (`^## Workflow$`) son frágiles por construcción: ya se
  quemaron cuando prettier corrompió los backticks escapados (v5.56) y cuando un CRLF hizo
  que el anclaje no matcheara → **todos los gates saltados en silencio**.
- **Sin CI, y el ADR afirma lo contrario.** 0 archivos trackeados en `.github/`, pero
  `docs/adr/0005-hard-platform-parity-rule.md` dice *"Cross-platform bugs surface in CI,
  not in the field"*. La paridad `.sh`↔`.ps1` se verifica por **grep de strings**, no por
  comportamiento — el propio CHANGELOG lo admite (`:101`).
- **Una suite de 459 líneas nunca corre.** `tests/template/test-codex-pty.sh` no está en el
  array `SUITES` de `run-all.sh:18-32` (13 registradas, 14 archivos). Por eso el CHANGELOG
  dice "13-suite green": la pieza más dependiente del entorno queda fuera del runner.
- **Los gates siguen siendo *attested*, no *verified*.** El hook valida el **formato** de
  `codex clean — head=<sha>` y que el head coincida; no valida que Codex haya corrido. Un
  agente que escriba la línea con el head correcto pasa. La única excepción real es
  `plan_sha` (ligado a contenido). Misma garantía que codeforge con ~10× la complejidad.
- **Codex obligatorio, sin fallback single-engine.** Si Codex no está, `/goal` se detiene.
  Rompe el harness para quien corre un solo CLI.

---

## Repo B — `gentle-ai` (post-v2.1.11)

### Qué es

**No** es un instalador de agentes: es un **configurador de ecosistema** en Go. Detecta qué
agentes de IA tienes y les escribe configuración — persona, memoria (Engram vía MCP),
skills, Spec-Driven Development, routing de modelos y un sistema de review "bounded".
Distribución: Homebrew tap, `curl|bash`, `go install`, binarios GoReleaser (linux+darwin
sólo; Windows exige build desde Go, y falla cerrado de forma verificable).

Multi-engine real: `agents.Adapter` es una interfaz de 25 métodos
(`internal/agents/interface.go:20-60`) con **16 implementaciones** registradas en
`factory.go:25-42`. Las diferencias entre engines están **declaradas como datos** —
`SystemPromptStrategy` con 6 variantes y `MCPStrategy` con 5 (`internal/model/types.go:101-138`)
— con motores de merge por formato que preservan comentarios (`filemerge/toml.go` 818 LOC,
`yaml.go` 422). Esto sí modela Claude, Codex y OpenCode como targets distintos en vez de
asumir que compartir markdown basta.

### Las ideas que valen (con mecanismo)

1. **Las reglas en markdown son artefactos testeados — con denylist de frases-escapatoria.**
   `internal/assets/assets_test.go:11-125`. Además de una allowlist (cada orchestrator debe
   contener 12 frases obligatorias), hay `TestOrchestratorsRejectDelegationBypassLanguage`:
   una **denylist de prosa que le daría al agente una salida retórica** (`"why delegation
   would be unsafe or wasteful"`, `"delegate one writer or continue inline only if"`), con
   comparación por palabras normalizadas para atrapar paráfrasis. Es decir: **testean el
   prompt contra su propia tendencia a racionalizar.** ~2.150 líneas de aserciones sobre
   markdown + 83 goldens.

2. **Review acotado: presupuestos monótonos que hacen imposible el loop.**
   `compact.go:24` (`MaxCompactCorrectionAttempts = 1`) + spec en
   `openspec/specs/review-findings-ledger/spec.md`. Como máximo **una** transacción de
   corrección, **un** batch de refuter, exactamente **dos** ejecuciones de juez ciegas.
   Los contadores **sólo suben** (`store.go:851-865`) y los gates **no pueden crear
   presupuesto nuevo**. Ataca el modo de fallo más caro de un review con LLM.

3. **El refuter: los hallazgos del reviewer son *claims*, no verdades.**
   Sólo `BLOCKER|CRITICAL` entran a clasificación; `WARNING|SUGGESTION` quedan congelados
   como `info` y **no pueden consumir presupuesto**. Un hallazgo severo **determinista** (un
   comando que falla lo prueba) va directo a `corroborated`. Todo hallazgo severo
   **inferencial** pasa por un refuter adversarial que devuelve
   `corroborated|refuted|inconclusive`. Evidencia insuficiente → escala terminalmente sin
   retry. Es la mejor respuesta vista al problema de falsos positivos de un reviewer LLM.

4. **Clasificación de riesgo determinista en código, no en el prompt.**
   `internal/reviewtransaction/risk.go`: `LargeChangeLines = 400` (`:15`, comparado en
   `:117`); `ClassifyRisk` → 0 / 1 / 4 lentes (`:103-127`); señales de hot-path
   `auth|update|security|payments` (`:786-806`); riesgo de process-boundary por `git grep`
   de `subprocess|exec` con cap de 8 MiB. Detalle fino y correcto: **los goldens generados
   se excluyen del umbral de 400 líneas pero se incluyen en la identidad del target**.

5. **El receipt content-bound: el gate se ata a Git, no a un checkbox.**
   `receipt.go:29-49`. El receipt ata `BaseTree`, `InitialReviewTree`, `FinalCandidateTree`
   (OIDs de Git), `PathsDigest`, `FixDeltaHash`, `PolicyHash`, `LedgerHash`, `EvidenceHash`.
   Cómo congela el candidato sin tocar el índice real (`snapshot.go:701-812`): copia el
   índice a un temp, setea `GIT_INDEX_FILE`, `git add -u` + untracked declarados, y
   `git write-tree` — e incluso **preserva el mtime del índice original** para derrotar la
   heurística "racily clean" de Git. Y el gate **discrimina el tipo de deriva** (`:198-240`):
   mismatch de tree/paths → `scope-changed`; mismatch de base/policy/evidence → `invalidated`.
   La distinción `initial_review_tree` vs `final_candidate_tree` registra *qué se revisó* vs
   *qué se envía*.

6. **Fuente canónica única que sobreescribe las copias por engine.**
   `internal/components/sdd/boundedreview.go:54-73`. Lo que digan las 12 copias por engine
   bajo `#### Review Execution Contract` se **descarta y reemplaza** en tiempo de
   instalación por el asset canónico `skills/_shared/review-ledger-contract.md`. Los cuerpos
   de los 4 subagentes reviewer se **generan en Go** desde un mapa de roles, conservando sólo
   el frontmatter nativo de cada engine.

7. **Capacidades de testing detectadas, no asumidas.** `openspec/config.yaml` es el output
   de `/sdd-init`: `strict_tdd: true`, `detected: "2026-05-05"`, runner, layers unit/
   integration/e2e con `available: true|false`, y `linter.available: false` con nota honesta.
   En vez de asumir que el proyecto tiene tests, **los detecta y condiciona el modo TDD
   estricto a esa detección**.

8. **Presupuesto de tokens explícito para skills.** `docs/skill-style-guide.md` encuadra la
   skill como *"runtime instruction contract for an LLM, not human-facing documentation"*,
   impone orden de secciones (Activation Contract → Hard Rules → Decision Gates → Execution
   Steps → Output Contract → References) y fija **180-450 objetivo, ≤700 recomendado, 1000
   máximo duro**, con un DON'T list ("Explain history, motivation, or tutorial background").

9. **Evidencia con frontmatter trazable.** Los `verify-report.md` de `openspec/changes/*`
   llevan `evidence_revision: sha256:…`, `test_command`, `test_exit_code`,
   `test_output_hash: sha256:…`, `requirements: 5/5`. El `review-ledger.md` lleva
   `target_revision` y filas `id|lens|location|severity|status|evidence`.

10. **`docs/audits/` — los mantenedores auditan su propio producto con cifras.** El mejor
    artefacto del repo (265KB en 3 días). Ver abajo.

### Debilidades reales

- **El "gate" no bloquea nada, y no hay hook.** Verificado: cero instalación de git hooks,
  ningún `core.hooksPath`, nada en `.github/workflows/` que llame a `review validate`. El
  spec lo dice: *"Gentle AI installs the rules; it does not create Git hooks, daemons, event
  listeners, or agent processes."* El enforcement es un subcomando + **texto de prompt**
  pidiéndole al agente que lo llame. **Mismo tier que codeforge**, con validación mucho más
  fuerte *dentro* de ese tier: si lo llamas, no se le puede mentir (re-deriva de Git vivo y
  compara con `reflect.DeepEqual`, `gate.go:184-187`).
- **Docs que documentan código inexistente — el peor caso.** El commit más nuevo del repo
  (`e01b114`) añade `docs/testing-agents-deterministically.md`, que describe en presente
  indicativo un suite E2E que **no existe**: verificado independientemente, cero hits de
  `e2e/organicruntime/`, `TestRealOpenCodeOrganicRuntimeJourneys`,
  `GENTLE_AI_REAL_AGENT_E2E` y del job de CI `organic-runtime-e2e` en `.go`, `.yml` y `.sh`.
  `git show --stat` confirma que el commit tocó **sólo** ese doc y `README.md`. Su propio
  hedge dice que lo no probado es "que un modelo vivo reproduzca las llamadas" — nunca
  revela que **nada corre**. `docs/trigger-rules.md:92-95` también afirma un binding
  (`post-sdd-phase` tras `design` → `judgment-day`) que el código contradice
  (`internal/catalog/triggers.go:56-64`: `Phases: ["apply"] → Run: ["review-start"]`).
- **El repo no pasa sus propios tests en macOS, y CI no testea macOS.** Ejecutado:
  `reviewtransaction` timeout a 600s, `internal/cli` FAIL a 582s, más fallos en
  `sddstatus`, `update` y `communitytool`. El de `update` es inequívoco:
  `declare: -A: invalid option` — arrays asociativos de bash 4 en un macOS con bash 3.2.
  El job `unit-tests` corre **sólo ubuntu** (`ci.yml:28-47`) y darwin es plataforma
  oficialmente distribuida (Homebrew tap).
- **Sin `-race` en ningún sitio**, en un codebase cuyos invariantes centrales son locking,
  CAS y concurrencia. Sin gate de cobertura. `go vet` sólo en el preflight de release.
- **El job `windows-runtime` corre una allowlist hardcodeada de 22 tests** en un `-run
  '^(…)$'`. Go sale 0 cuando un patrón `-run` no matchea nada → un test renombrado deja de
  ser gate **en silencio**.
- **Deriva por 12 copias de markdown.** 12 orchestrators de 35-45KB, ~95% idénticos sin
  fuente compartida (`gemini` y `qwen`: ~400 líneas cada uno). Síntoma visible:
  `internal/assets/claude/sdd-orchestrator.md:1` todavía dice
  `# Agent Teams Lite — Orchestrator Instructions`, el nombre del proyecto archivado que
  este supersede. Los tests de contrato mitigan pero no previenen: iteran engines
  hardcodeados, así que un engine #17 no haría fallar nada.
- **El README promete subagentes que no se escriben.** Dice "Full (native sub-agents)" para
  Gemini CLI, VS Code Copilot y Qwen Code, pero los tres adapters devuelven
  `SupportsSubAgents() == false`, por lo que el inyector nunca corre. Sólo 4 agentes reciben
  subagentes de verdad (claude, cursor, kimi, kiro).
- **`docs/architecture.md:35-36` omite el paquete más grande del repo** (`reviewtransaction`,
  52k LOC). La doc de arquitectura precede a ~la mitad del código.
- **`upgrade` permanentemente roto para quien instaló con `--method go`**
  (`internal/update/upgrade/executor.go:613-630`: la rama `InstallGoInstall` requiere
  `GoImportPath != ""` y ningún tool del registry lo setea → cae a binary → trust anchor
  `UNSET` → `ErrReleaseTrustUnavailable`).
- **`scripts/install.sh` nunca verifica la firma minisign** (`grep -c -i minisign` → 0);
  sólo compara SHA256 contra un `checksums.txt` del mismo release. El aparato de trust
  anchors existe sólo en el self-updater Go. El README está redactado para cubrirse ("el
  *upgrader* verifica la firma"), pero la ruta de instalación recomendada es materialmente
  más débil.

### El artefacto más valioso de gentle-ai: su propia autopsia

`docs/audits/2026-07-21-rdd-system-audit.md` es el documento más creíble de los dos repos.
Los mantenedores publican sus propias cifras: 59 archivos Go de review en producción /
22.432 LOC, **19 operaciones `gentle-ai review` visibles al usuario**, **9 verbos de
recuperación** (`invalidate`, `abandon`, `recover`, `reclaim`, `reconcile-authority`,
`dispose-result`, `quarantine-legacy`, `quarantine-legacy-fix-scope`, `repair-legacy-alias`).

Su veredicto (`:15-17`): el kernel de confianza es *"materially safer than an ordinary
best-effort review script"*, pero el producto *"has become a distributed state machine whose
correct recovery depends on knowledge that ordinary users and agents cannot reasonably
possess"*. Puntúan **Operable: "Not for recovery."** Y la frase que resume todo:

> *"a system that only says 'stop' when its consumer lacks enough data to recover is safe
> without being operable."*

El diagnóstico de por qué (`2026-07-23-organic-recovery-implementation-plan.md:54-65`):

> *"It also turned internal safety machinery into a user-visible ceremony… Users who were
> satisfied with 'build this for me' encounter review vocabulary, repeated prompts, and
> non-convergent flows after the implementation is already correct."*

Y cuantifican por qué parchear no sirve: **90 PRs, 499 aristas de solapamiento, 74 PRs en un
componente de colisión, 16 PRs que requieren descomposición.** Su postura: *"Pause
issue-by-issue recovery fixes."* Su §8.1 es una kill list de 12 filas que incluye
*"Duplicate prompt/protocol injection and provider semantic copies"* — o sea, ellos mismos
planean matar el problema de las 12 copias de markdown.

**Esto es la lección más importante del research entero.** No es una idea a copiar: es un
resultado experimental. gentle-ai llevó "rigor verificable" hasta el final y publicó que se
pasó de la raya. Cualquier mecanismo de los de abajo que codeforge adopte debe pasar el
filtro *"¿esto añade vocabulario que el usuario tiene que aprender para recuperarse?"*

---

## Convergencia y divergencia entre los tres analistas

**Coincidieron los tres, sin verse:**

- La idea central de ambos repos es la misma: **atar la evidencia al contenido**
  (`plan_sha` en ccf, tree OIDs en gentle-ai). Es el techo que codeforge tiene hoy.
- Ambos repos tienen brechas doc↔código, y la de gentle-ai es peor (un suite E2E
  inexistente descrito en presente).
- Ambos son bus factor ~1 en iteración muy intensa.
- Ninguno logra enforcement duro contra un agente que quiera saltárselo: los dos son
  *attested*, igual que codeforge.

**Divergieron en la recomendación, y la divergencia es informativa:**

- **Codex** recomendó **ccf** para aplicación inmediata, porque comparte las restricciones
  (markdown, estado legible, hooks opcionales) y sus mecanismos se transplantan sin
  introducir un binario.
- El analista de **ccf** encontró que ccf tiene bugs serios, que **no es multi-engine en
  absoluto**, y que codeforge ya está por delante en varios puntos concretos (detección de
  branch base, frescura por git, reportes commiteados y visibles en el PR, whitelist de path
  con rechazo de symlink, skills 15× más cortas).
- El analista de **gentle-ai** argumentó que las mejores ideas de gentle-ai
  (presupuestos acotados, split determinista/inferencial, tests de contrato sobre markdown
  con denylist, presupuesto de tokens por skill) son **puro markdown y por tanto tan
  transplantables como las de ccf** — lo que contradice la premisa de Codex.

La síntesis: **Codex tenía razón sobre los mecanismos y el analista de gentle-ai tenía razón
sobre la doctrina.** Son categorías distintas y no compiten.

---

## Veredicto: cuál analizar a fondo

**Respuesta corta: ccf para mecanismos, gentle-ai para doctrina. Y el orden de lectura
importa.**

**1. Lee primero `ccf/docs/CHANGELOG.md` completo (931 líneas). Es la lectura de mayor ROI
del research entero.** No por las ideas, sino porque es un registro de los fallos de campo
exactos que un ship-gate en markdown produce: prettier corrompiendo backticks escapados,
CRLF haciendo que un anclaje `^## Workflow$` no matchee y **todos los gates se salten en
silencio**, `git commit && git push` validando el HEAD anterior, guardrails de regex con
falsos positivos en tres versiones consecutivas, un review de 1.9 MB entrando al contexto.
codeforge tiene la misma arquitectura y por tanto la misma lista de fallos por delante. Es
prior art negativo, que es el más barato de consumir.

**2. Luego `gentle-ai/docs/audits/` (3 documentos, 265KB).** Es el único de los dos que ya
llegó al final del camino "más rigor" y publicó el resultado: *safe without being operable*.
Léelo como un límite superior, no como una guía.

**3. Después, quirúrgicamente, tres archivos de gentle-ai:** `internal/assets/assets_test.go`
(tests de contrato sobre markdown con denylist), `internal/reviewtransaction/risk.go`
(clasificación de riesgo determinista con umbral numérico) y `docs/skill-style-guide.md`
(presupuesto de tokens por skill). Los tres son conceptos que caben en markdown+shell.

**No** vale la pena estudiar a fondo: el CAS store, los dos FSM, los 16 adapters, ni los
20 JSON Schemas de `review-integration`. Copiar esa arquitectura trasladaría exactamente la
complejidad que un sistema de disciplina en markdown existe para evitar — y sus propios
mantenedores lo dicen.

---

## Backlog para codeforge, ordenado por valor/esfuerzo

### 1. Tests de contrato sobre el propio markdown — **S** · el mejor ratio del análisis

Origen: `gentle-ai/internal/assets/assets_test.go:11-125`.

**Verificado hoy en codeforge:** `CLAUDE.md` == `AGENTS.md` byte a byte, y las 14 skills
están duplicadas idénticas en `.claude/skills/` y `.agents/skills/`. Es la garantía central
del sistema ("no symlinks, no drift") y **no hay ni una aserción que la proteja**. Un
`shared/scripts/check-rules.sh` (~150 líneas de shell) que:

1. Verifique la igualdad byte a byte de los pares duplicados.
2. Valide que `.forge-manifest` lista todos los `shared/rules/*.md` presentes (hoy 12 y 12,
   pero es coincidencia no verificada).
3. **Allowlist:** `state.template.md` debe tener exactamente los 6 boxes del perfil
   `standard` que `check-gates.sh:57` ya asume — hoy está codificado en dos sitios sin
   cross-check.
4. **Denylist:** frases que le dan al agente una salida retórica. `ship-gates.md` está lleno
   de hedges legítimos; hay que trazar la línea entre "matiz honesto" y "escapatoria" y
   luego testearla.

### 2. Ligar la evidencia de review a un hash de contenido — **S/M**

Origen: `ccf/hooks/check-workflow-gates.sh:559-646` (la forma simple) +
`gentle-ai/receipt.go:198-240` (discriminar `scope-changed` de `invalidated`).

Hoy `check-gates.sh` cuenta checkboxes para los items de review; el binding a artefacto sólo
existe para E2E. Añadir:

- Plan: `- [x] Design review iteration N — <engine> clean — plan=\`docs/plans/x.md\` —
  plan_sha=\`<sha256>\`` → recalcular y comparar.
- Código: `- [x] Code review iteration N — <engine> clean — head=\`<sha>\`` → comparar con
  `git rev-parse HEAD`.

Ya tienes el patrón exacto implementado para E2E (`check-gates.sh:89-195`): son ~40 líneas de
shell para dos gates más. Cierra el agujero de "reviso el plan, luego lo reescribo, y la
casilla sigue marcada". Nota honesta: si el agente escribe el reporte, puede escribir el
hash — la ganancia es **contra error, no contra mala fe**. El upgrade real a *verified* sigue
siendo CI, como `ship-gates.md` ya dice.

### 3. Convergence breaker con adjudicación humana ligada al head — **S/M**

Origen: `ccf/hooks/lib/review-breaker.sh:60-91` + ADR 0009.

`severity.md` dice "repite hasta que un pase salga sin P0/P1/P2" — **sin techo**. Con
revisores estocásticos eso no siempre converge (el incidente de ccf: iteración 15 → 25, medio
día perdido). Transplante: contador en `.workflow/state.md`; `check-gates.sh` computa
certificación y rondas post-cert; si supera 3, falla con instrucciones de escalar; liberación
sólo por línea humana ligada al head; y un `N/A:` que borre el contador **dispara** el
breaker (fail-closed). Encaja limpio porque `check-gates.sh` ya es el punto único de verdad.

### 4. Presupuestos acotados + split determinista/inferencial — **S**, puro markdown

Origen: `gentle-ai/compact.go:24` + `openspec/specs/review-findings-ledger/spec.md`.

En `shared/rules/severity.md`: separar hallazgos **deterministas** (hay un comando que falla
que lo prueba) de **inferenciales** ("creo que esto race-ea"). Los deterministas van directo
a fix; sólo P0/P1 inferenciales requieren segundo pase; P2/P3 se registran como `info` y **no
bloquean ni consumen iteración**. En `ship-gates.md`: cota de **1 ronda de corrección**; si
tras ella siguen P0/P1, el estado es `escalated` → humano, no otra ronda. Es la contrapartida
doctrinal del #3 y se refuerzan.

### 5. Bloqueo de comandos-ship compuestos — **S**

Origen: `ccf/hooks/check-workflow-gates.sh:72-109`.

El agujero existe hoy en el Tier C de codeforge: `claude-gate-hook.sh:20-23` hace
`case "$input" in *'git commit'*|*'git push'*|…)` — un `git commit -m x && git push` valida
los gates una vez y shippea. La normalización de separadores + detección de verbo-ship
post-separador son ~15 líneas.

### 6. Umbral de riesgo determinista para elegir el perfil de gate — **S/M**

Origen: `gentle-ai/internal/reviewtransaction/risk.go:15,103-127`.

Reemplazar "`<3` files, no behavior risk" (juicio del agente, hoy en `workflow.md`) por un
umbral computable por `check-gates.sh` con `git diff --numstat` contra la base que **ya**
auto-detecta: `<50` líneas y ningún path hot → `light`; `>400` o cualquier path que matchee
`auth|security|payment|migration` → `standard`. Con el carve-out fino de gentle-ai: excluir
goldens/snapshots/lockfiles del umbral **pero incluirlos en la identidad del árbol**.

### 7. Presupuesto de tokens por skill — **S**

Origen: `gentle-ai/docs/skill-style-guide.md`.

Medido: las skills de codeforge van de 456 a 1.064 tokens y `ship-gates.md` ronda 2.074.
gentle-ai fija 180-450 objetivo / 1000 máximo duro y lo justifica: la skill es un *contrato de
instrucciones en runtime para un LLM*, no documentación para humanos. Contraste útil: la
skill `new-feature` de codeforge son 86 líneas y su equivalente en ccf son **1310**. Estás en
el lado bueno; el valor es fijar el límite por escrito antes de que se erosione.

---

## Lo que explícitamente NO copiar

- **Los 9 checks de `check-bash-safety` de ccf.** Falsos positivos verificados
  (`grep "/dev/tcp/"`, `pip install`, `npm i -g`) y tres versiones consecutivas arreglando
  esa clase. Guardrails por regex sobre líneas de shell son un pozo.
- **El shim PTY de 267 líneas de ccf.** codeforge ya resuelve openai/codex#19945 sólo con
  flags (`< /dev/null` + `--output-last-message`): mismo problema, coste 10× menor.
- **Commands de 1300 líneas.** Un modelo lee 86 líneas; a las 1310 empieza a derivar.
- **Codex obligatorio sin fallback.** El "Single-engine fallback" de `ship-gates.md` (con
  waiver auditable) es mejor diseño que el de ccf.
- **Markdown mergeado por parsers propios.** codeforge hace bien en escribir archivos
  propios y no mergear `opencode.json` / `config.toml`; gentle-ai necesitó 1.240 LOC de
  parsers para eso.
- **El CAS store, los FSM, los 16 adapters y los 20 JSON Schemas de gentle-ai.** Meses de Go
  y bugs de plataforma — sus tests fallan en macOS ahora mismo.

---

## Lo que codeforge ya hace mejor que ambos

Registrado para no regresionarlo mientras se adoptan las ideas de arriba:

1. **La escalera Verified / Attested / Advisory** (`shared/rules/ship-gates.md:107-124`) es
   el mejor artefacto conceptual de los tres repos. Obliga a *"Never present an attested
   checkbox as if it were verified"*, y `check-gates.sh:11-17` repite la advertencia en el
   código. ccf tiene la misma limitación real pero su maquinaria proyecta más certeza de la
   que da; gentle-ai borró security theater de su threat model (bien) pero luego shippeó un
   doc que describe tests inexistentes (mal).
2. **Detección de branch base robusta** (`check-gates.sh:166-177`): prueba
   `dev/main/master/origin/*` y elige el merge-base más cercano. ccf hardcodea `main`/`master`
   y **falla abierto** en repos que integran en `dev`.
3. **Frescura por git, no por mtime** (`check-gates.sh:179-188`): inmune a resets de mtime por
   clone/checkout. Y los reportes **se commitean** en `docs/e2e/reports/` → visibles en el PR.
   ccf los gitignora, así que su evidencia nunca llega al revisor humano.
4. **Whitelist de path + rechazo de symlink** para el reporte E2E (`check-gates.sh:128-145`),
   antes de comprobar existencia. ccf sólo hace glob.
5. **Multi-engine de verdad** — que es exactamente lo que ccf lleva un plan de 13 PRs sin
   empezar.
6. **Operabilidad.** 67 archivos y 2.746 líneas de markdown; se entiende el sistema completo
   en 5 minutos. Es la propiedad que gentle-ai perdió y cuya pérdida sus propios
   mantenedores puntúan como *"Operable: Not for recovery."*
7. **`quick-fix`** — rampa por tamaño de tarea. Es justo el fallo que el audit de gentle-ai
   denuncia: *"simple doc work launching the same verification as executable behavior."*
8. **Secciones "Common rationalizations" / "Red flags"** en cada skill. Es la misma intuición
   que la denylist de gentle-ai, pero en prosa: la idea #1 la convertiría en test.

---

## Límites de este research

- **Ambos clones son shallow.** "Ausente en HEAD" es certero; "nunca existió" no. Las cifras
  de commits vienen de la API de GitHub (187 y 1.332), no del clone.
- **No se ejecutó la suite de ccf completa** (sólo `test-lint.sh`, 40/40 pass, y hooks contra
  fixtures). La de gentle-ai sí se ejecutó, sobre una copia: 5 paquetes fallando en macOS.
- **Branch protection / required status checks** de gentle-ai no son verificables: los
  settings del repo no están en el árbol.
- **Comportamiento runtime de los 16 harnesses de gentle-ai** no verificado — requeriría los
  16 instalados. Que los adapters escriban los archivos correctos sí está testeado por
  goldens; que cada harness los cargue, no.
- **Si las 12 copias de orchestrator de gentle-ai son semánticamente equivalentes**: se midió
  solapamiento de líneas, no semántica. Es precisamente el riesgo residual que su diseño
  deja abierto.
- **Ningún consumidor externo de `review-integration/v1`** pudo verificarse; todos los que
  referencian los `$id` son del propio CLI.
