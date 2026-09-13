# Claude → Codex harness migration ledger

Живой журнал инвентаризации и переноса. Каждая подтверждённая находка записывается сюда до следующего исследовательского шага.

## Инварианты

- Переносить наблюдаемое поведение, а не имена Claude-only API.
- Не объявлять механизм перенесённым, пока его не прочитал и не исполнил реальный Codex entrypoint.
- Не перетирать существующие пользовательские изменения в `~/.codex` и `~/AGENTS.md`.
- Не читать и не переносить credentials, tokens, auth state и прочие секреты.
- Общие правила должны действовать для main и всех совместимых Codex agent roles.

Самостоятельный чек: `test -s /home/penis/.codex/claude-harness-migration.md && rg -n '^## (Инварианты|Находки)$' /home/penis/.codex/claude-harness-migration.md` → выводит обе секции и exit code `0`.

## Находки

### F-001 — Граница переноса

- Источник: прямое требование пользователя от 2026-08-23.
- Факт: требуется перенести полезное поведение всего Claude harness в Codex, включая rules, hooks и enforcement; `lint-inject` в Codex подозревается в частичной поломке.
- Решение: сначала построить исполняемую карту Claude ↔ Codex и воспроизвести `lint-inject`; не копировать Claude hook names как будто Codex исполняет их нативно.
- Проверка: итоговая карта обязана для каждого механизма назвать Codex reader/entrypoint и реальную команду end-to-end проверки.

### F-002 — Codex имеет нативные lifecycle hooks

- Источник: официальная документация OpenAI, `https://developers.openai.com/codex/hooks`, строки 772–817 снимка от 2026-08-23.
- Факт: Codex поддерживает `PreToolUse`, `PermissionRequest`, `PostToolUse`, `PreCompact`, `PostCompact`, `UserPromptSubmit`, `SubagentStop`, `Stop`, `SessionStart`, `SubagentStart` и `SessionEnd`.
- Discovery: hooks читаются из `~/.codex/hooks.json`, inline `[hooks]` в `~/.codex/config.toml`, соответствующих project-local файлов и enabled plugins.
- Отличия, важные для переноса: совпавшие hooks из нескольких слоёв суммируются; command-hooks одного события запускаются конкурентно; новый или изменённый unmanaged hook пропускается, пока пользователь не подтвердит trust для его нового hash.
- Решение: переносить совместимые Claude hooks в нативный `~/.codex/hooks.json`; не дублировать тот же hook inline в `config.toml`; после изменения проверять не только JSON, но и trust/runtime delivery.
- Проверка: свежий Codex startup должен перечислить hooks без merge-warning, а реальный lifecycle event должен дать наблюдаемый output/decision от доверенного hook.

### F-003 — Claude hook-конфиг нельзя копировать без адаптера

- Источник: официальная документация OpenAI, `https://developers.openai.com/codex/hooks`, строки 822–961.
- Факт: Codex `hooks.json` имеет уровни event → matcher group → command handlers. Сейчас исполняется только `type: "command"`; `prompt` и `agent` парсятся, но пропускаются. Команда запускается с session `cwd`, большинство hook timeout по умолчанию 600 секунд, `SessionEnd` — 1 секунда и максимум 3.
- Feature gate: hooks включены по умолчанию; канонический ключ отключения — `[features] hooks = false`, `codex_hooks` только deprecated alias.
- Решение: переносить только command hooks, явно задавать короткие timeout и абсолютные user-level пути; Claude JSON output/contracts адаптировать под Codex event schema, а не копировать вслепую.
- Проверка: `codex` принимает итоговый `hooks.json` без configuration warning; каждый handler запускается из произвольного session `cwd`.

### F-004 — Покрытие tool hooks и граница enforcement

- Источник: официальная документация OpenAI, `https://developers.openai.com/codex/hooks`, строки 1005–1047.
- Факт: `PreToolUse`/`PostToolUse` видят shell и unified exec как `Bash`, `apply_patch` как `apply_patch`/`Edit`/`Write`, MCP tools по полному имени, local function tools включая `update_plan`; `spawn_agent` также матчится как `Agent`. Hosted tools не проходят через этот hook path, а специализированные tools могут opt out.
- Решение: `lint-inject` может покрыть `apply_patch` и shell/edit-пути, но не должен заявляться полной security boundary; matcher и extractor обязаны понимать Codex tool names и JSON arguments.
- Проверка: отдельные реальные пробы для `Bash` и `apply_patch` вызывают hook; hosted/web path не используется как отрицательный тест блокировки.

### F-005 — Output contract и бюджет Codex hooks

- Источник: официальная документация OpenAI, `https://developers.openai.com/codex/hooks`, строки 1048–1102.
- Факт: command hook получает один JSON object через stdin. Общие поля включают `session_id`, `transcript_path`, `cwd`, `hook_event_name`, `model`; часть событий получает `permission_mode`. Модельный hook output по умолчанию spill-ится примерно после 2500 tokens; `additionalContextLimit` управляет только `additionalContext`.
- Ограничение: transcript format не является стабильным hook API. `SubagentStart` принимает context/system-message shape, но `continue: false` не останавливает субагента.
- Решение: адаптеры должны читать stdin event JSON, выдавать строго поддерживаемый event-specific JSON и держать context коротким; не строить перенос на парсинге transcript, если событие уже несёт нужные поля.
- Проверка: positive fixture Codex event даёт валидный JSON output; oversized fixture либо укладывается в установленный cap, либо наблюдаемо spill-ится без потери пути к полному output.

### F-006 — Plugin hooks имеют совместимость с Claude paths, но требуют trust

- Источник: официальная документация OpenAI, `https://developers.openai.com/codex/hooks`, строки 989–1004.
- Факт: enabled Codex plugin может нести `hooks/hooks.json` или manifest `hooks`; Codex задаёт `PLUGIN_ROOT`/`PLUGIN_DATA` и совместимые `CLAUDE_PLUGIN_ROOT`/`CLAUDE_PLUGIN_DATA`. Установка/enable plugin не доверяет его hooks автоматически.
- Решение: общий переносимый hook bundle лучше оформлять Codex plugin только если ему нужны собственные skills/MCP/assets; глобальные пользовательские hooks остаются в `~/.codex/hooks.json`. В обоих случаях нужен trust/runtime чек.
- Проверка: hook получает корректный root/data path из реального plugin invocation; `/hooks` не показывает pending review перед acceptance.

### F-007 — Injection-rules можно перенести без нового transport protocol

- Источник: официальная документация OpenAI, `https://developers.openai.com/codex/hooks`, строки 1155–1224 и 1387–1416.
- Факт: `SessionStart`, `SubagentStart` и `UserPromptSubmit` принимают plain text на stdout как extra developer context; JSON-вариант использует `hookSpecificOutput.additionalContext`. `SubagentStart.matcher` фильтрует `agent_type`, а event input содержит `agent_id` и `agent_type`.
- Решение: существующий rule selector/core можно переиспользовать, но Claude hook wrappers заменить/адаптировать под Codex stdin. Main delivery идёт через `SessionStart`/`UserPromptSubmit`, role delivery — через `SubagentStart` по реальному `agent_type`.
- Проверка: fresh main и fresh subagent получают уникальные markers из реального `~/.codex/hooks.json`, не из заранее вставленного prompt.

### F-008 — Правильный Codex blocking contract для lint-inject

- Источник: официальная документация OpenAI, `https://developers.openai.com/codex/hooks`, строки 1225–1278.
- Факт: `PreToolUse` получает `tool_name`, `tool_use_id` и `tool_input`; для `Bash` и `apply_patch` проверяемый текст лежит в `tool_input.command`. Plain stdout игнорируется. Блокировка: `hookSpecificOutput.permissionDecision = "deny"`, legacy `{decision:"block"}`, либо exit code `2` с причиной в stderr.
- Опасная несовместимость: неподдерживаемые `ask`, `continue:false`, `stopReason` или `suppressOutput` помечают hook failed, но Codex продолжает tool call.
- Решение: `lint-inject` должен fail/allow только через поддерживаемый PreToolUse shape; обязательно тестировать exit/JSON и факт невыполнения target command/edit.
- Проверка: запрещённый harmless marker-command не создаёт marker-файл; разрешённый command создаёт его; malformed decision демонстрирует fail-open и не используется в production hook.

### F-009 — PostToolUse не заменяет PreToolUse enforcement

- Источник: официальная документация OpenAI, `https://developers.openai.com/codex/hooks`, строки 1319–1360.
- Факт: `PostToolUse` видит `tool_response`, включая non-zero Bash, но не может отменить side effects. `decision:"block"` заменяет model-visible result/feedback; для nested code-mode promise это rejection уже после выполнения.
- Решение: lint/policy, который должен предотвращать запись или команду, живёт в synchronous `PreToolUse`; post-edit lint может быть `PostToolUse`, но только как feedback с последующим исправлением.
- Проверка: PreToolUse negative case не создаёт side effect; PostToolUse fixture явно считается диагностикой, не превентивной защитой.

### F-010 — Stop/SubagentStop могут перенести completion gates

- Источник: официальная документация OpenAI, `https://developers.openai.com/codex/hooks`, строки 1417–1464.
- Факт: `Stop` и `SubagentStop` требуют JSON при exit `0`; `{decision:"block", reason}` не блокирует навсегда, а продолжает main/subagent новым prompt. Есть `stop_hook_active`, позволяющий не зациклить continuation. `continue:false` от любого matching hook имеет приоритет.
- Решение: Claude completion/verifier hooks переносимы только с явным loop guard по `stop_hook_active`; plain-text Claude output для этих событий недопустим.
- Проверка: один failing completion fixture вызывает ровно одну continuation, второй проход с `stop_hook_active:true` завершается без цикла.

### F-011 — Нативный `/import` задаёт контрольный список переноса

- Источник: текущий официальный Codex manual, секция `Import from another agent`, строки 28936–29037; source URL `https://learn.chatgpt.com/docs/import.md`.
- Факт: Codex CLI умеет импортировать из Claude Code instruction files, `settings.json`, skills, plugins, project memories, MCP config, hooks, slash commands и subagents. Заявленные destinations: `AGENTS.md`, `config.toml`, Codex skills/plugins/memories/MCP/hooks/subagents.
- Ограничение: `/import` недоступен во время running task, remote session или подключения к local app-server daemon. После импорта документация требует отдельно проверить permissions, auth-dependent MCP, hooks с отличающимся поведением, plugins и argument/path interpolation.
- Решение: использовать этот перечень как completeness checklist текущего ручного проверяемого переноса; не считать auto-import доказательством runtime parity.
- Проверка: финальная карта содержит решение и end-to-end check для каждой из десяти заявленных категорий либо явное обоснование `не переносить`.

### F-012 — Глобальный Codex instruction root — `~/.codex`, не домашний каталог

- Источник: текущий официальный Codex manual, секция `Custom instructions with AGENTS.md`, строки 21962–22114.
- Факт: Codex один раз на run/session строит chain. Глобально читает первый непустой `~/.codex/AGENTS.override.md` либо `~/.codex/AGENTS.md`. Затем от project root до cwd берёт максимум один instruction file на директорию: override, `AGENTS.md`, затем configured fallbacks. Ближний файл имеет приоритет. Default combined cap — 32 KiB.
- Следствие: `/home/penis/AGENTS.md` действует как project/cwd guidance только при работе в этом дереве; для действительно глобального поведения нужен `/home/penis/.codex/AGENTS.md`. `CLAUDE.md` Codex не читает без явного `project_doc_fallback_filenames`.
- Решение: durable cross-project agreements переносить в `~/.codex/AGENTS.md`; project-specific Claude instructions оставлять на соответствующем уровне; dynamic cadence не пытаться имитировать AGENTS-файлом.
- Проверка: fresh `codex --ask-for-approval never "Summarize the current instructions."` из внешнего временного project path перечисляет глобальные правила; запуск из nested path показывает root→cwd precedence.

### F-013 — Claude agent markdown требует конвертации в Codex agent TOML

- Источник: текущий официальный Codex manual, секция `Multi-agent operations`, строки 1938–2375.
- Факт: personal custom agents лежат в `~/.codex/agents/*.toml`, project agents — `.codex/agents/*.toml`. Обязательные поля: `name`, `description`, `developer_instructions`; можно задавать `model`, `model_reasoning_effort`, `sandbox_mode`, `mcp_servers`, `skills.config`. Имя внутри TOML — source of truth.
- Наследование: sandbox/approval live overrides родителя применяются к child; остальные неуказанные settings наследуются. Explicit spawn и `[agents]` defaults участвуют в выборе model/effort, но agent-file overrides имеют приоритет.
- Решение: содержимое `.claude/agents/*.md` не копировать как файлы; для каждой полезной роли создать/обновить Codex TOML с минимальным role-specific `developer_instructions`, сохранив общие правила в global AGENTS/hooks, чтобы не дублировать их по ролям.
- Проверка: `spawn_agent` по каждому перенесённому `name` стартует нужную роль; `SubagentStart` получает тот же `agent_type`; read-only роли реально не пишут.

### F-014 — Codex `.rules` не заменяет semantic injection-rules

- Источник: текущий официальный Codex manual, секция `Rules`, строки 27939–28074.
- Факт: `~/.codex/rules/*.rules` — экспериментальный Starlark execpolicy для решений `allow`/`prompt`/`forbidden` по argv-prefix при запросе запуска вне sandbox. Это механическое управление командами, а не developer-context rules и не lint файлов.
- Решение: Claude semantic `injection-rules/rules/*.json` переносить через lifecycle hooks; подтверждённые command safety policies — отдельно в Codex `.rules` с `match`/`not_match`. Не смешивать два значения слова "rules".
- Проверка: `codex execpolicy check --pretty --rules <file> -- <command>` подтверждает каждый prefix rule; semantic marker появляется только через hook delivery, не через execpolicy.

### F-015 — Codex config разделяет user-only и project-safe ключи

- Источник: текущий официальный Codex manual, `Configuration Reference`, строки 10909–11370.
- Факт: `features.hooks` включает lifecycle hooks; `developer_instructions` может добавлять developer context; `[agents]`, `mcp_servers`, `skills.config` имеют собственные нативные секции. Project-local `.codex/config.toml` игнорирует host-owned/provider/notification/telemetry keys, включая `notify`, `profile`, `profiles`, `model_provider(s)` и `otel`.
- Решение: Claude user-level settings разнести по назначению: глобальные notification/provider settings только в `~/.codex/config.toml`; repo-owned agents/MCP/hooks могут жить в trusted `.codex/`; durable prose — в AGENTS, не в бесконечной строке `developer_instructions`.
- Проверка: `codex` стартует без ignored-key warnings; project config не используется для user notification/provider behavior.

### F-016 — Локальное состояние уже частично импортировано, но hooks отсутствуют

- Источник: `find`/`git rev-parse` по `/home/penis/.claude` и `/home/penis/.codex` от 2026-08-23.
- Факт: `/home/penis/.claude` — отдельный git repository. `/home/penis/.codex` и `/home/penis` не находятся в git repository. В Codex уже есть `AGENTS.md`, 13 custom agent TOML и два execpolicy файла (`claude-import.rules`, `default.rules`), но `~/.codex/hooks.json` и user hook scripts в найденной карте отсутствуют.
- Claude source: 12 role markdown, `settings.json`, injection-rules hooks, lint-inject batch/worker и TS implementation, project-structure, context-mode heal, TDAI memory hooks, `rules/code.md`.
- Решение: считать перенос частично выполненным и делать semantic diff, а не повторный blind import. Для `~/.codex` до каждой правки нужен recoverable backup/record, поскольку git rollback там отсутствует.
- Проверка: после переноса `find ~/.codex` показывает hooks и все выбранные роли; backup manifest позволяет восстановить каждый изменённый pre-existing файл.

### F-017 — Дополнительные обязательные категории от пользователя

- Источник: уточнение пользователя от 2026-08-23.
- Факт: `task` skill уже переписан; переносить нужно его текущую версию. Образ ideal agent также переносится, но адаптируется под Codex-specific semantics. Memory rules требуется переписать, а не копировать.
- Решение: сначала определить актуальные source-of-truth paths и readers для `task`, `ideal-agent` и Claude/Codex memory; deprecated/retired task copies исключить. Для ideal-agent заменить Claude tool/hook vocabulary на Codex contracts. Для memory описать реальные capture, recall, compaction и session boundaries Codex.
- Проверка: fresh Codex запускает актуальный task workflow; main и subagent демонстрируют ideal-agent markers/decision behavior; memory positive/negative scenarios проходят через реальные Codex entrypoints.

### F-018 — Codex hooks уже приходят из plugins

- Источник: безопасно просмотренная структура `~/.codex/config.toml` от 2026-08-23.
- Факт: включены `codex-guardrails@personal`, `project-structure@personal` и `codebase-project-graph@personal`. В `[hooks.state]` уже есть trusted hashes для guardrails `PreToolUse`, `SessionStart`, `SubagentStart`, двух `PostToolUse`, `UserPromptSubmit`, `SubagentStop`, `Stop`; project-structure и project-graph тоже поставляют hooks.
- Поправка к F-016: отсутствует отдельный user `~/.codex/hooks.json`, но plugin-bundled Codex hooks реально настроены и trusted.
- Решение: сначала аудировать и исполнять существующий `codex-guardrails` plugin; не создавать параллельный глобальный lint/injection stack, пока не доказан gap.
- Проверка: найти enabled plugin root/manifest, сопоставить каждый trusted hook id с command и прогнать реальные события.

### F-019 — Codex guardrails rule corpus отстал и имеет другую таксономию

- Источник: `find` + `comm` между enabled `codex-guardrails/0.1.0+codex.20260814041909/rules` и `/home/penis/.claude/mcp/injection-rules/rules`.
- Факт: Codex plugin содержит 17 правил со старыми именами (`accuracy`, `code-file-size`, `config-extract`, `verify-before-done` и др.). Текущий Claude corpus содержит 23 пронумерованных правила `00…62`, включая новый ideal-agent-derived набор `00-whole-before-parts`, `20-invariants-first`, `22-simulate-first`, `25-simplest-stable` и др. Совпадающих filenames нет.
- Решение: старый Codex corpus не наращивать поверх нового. Нужна Codex-specific rebuild/mapping: перенести смысл текущих 23 правил, слить только остающиеся Codex-specific enforcement contracts и обновить `rule-distribution.json`, parser/tests/hooks согласованно.
- Проверка: mapping ledger покрывает 17 старых и 23 новых файла без silently dropped смысла; repository tests подтверждают единственный активный corpus.

### F-020 — Текущий Codex guardrails — отдельная старая реализация

- Источник: полный read `.codex-plugin/plugin.json`, `hooks/hooks.json`, `package.json`, `rule-distribution.json` из enabled `codex-guardrails/0.1.0+codex.20260814041909`.
- Факт: plugin заявляет "port of Pi/Claude", использует один `injection-rules.mjs` на SessionStart/SubagentStart/UserPromptSubmit/PostToolUse/Stop/SubagentStop, отдельный Bash line guard на PreToolUse и lint только на PostToolUse `^apply_patch$`. Rule cadence задаётся старым диапазоном `6…52`, context limit для startup rules выставлен 24000 tokens.
- Решение: считать это baseline для воспроизведения дефектов, но не source-of-truth для нового переноса.
- Проверка: перед заменой сохранить manifest/hash и реальные baseline outputs; после замены старые rule names и старый router больше не загружаются.

### F-021 — Пользователь потребовал clean-room derivation из Claude

- Источник: прямое уточнение пользователя от 2026-08-23: "с нуля выводим ... воспроизводим все из клода тут".
- Факт: существующие Codex-specific guardrails/rules/task/memory/lint решения не должны влиять на целевую семантику.
- Граница: unrelated Codex product configuration (auth, model, browser/MCP connectors, trusted projects) не относится к harness clone и сохраняется.
- Решение: единственный behavioral source-of-truth — текущий Claude harness; Codex добавляет только обязательные adapter details: event schemas, config/manifest, trust, agent TOML и verification paths.
- Проверка: provenance каждого нового behavioral rule ведёт к Claude file/section; Codex-only старое правило без Claude provenance отсутствует либо явно оставлено как transport/safety requirement.

### F-022 — У установленного guardrails отсутствует обновляемый local source

- Источник: `/home/penis/.agents/plugins/marketplace.json` и `find` по `~/.agents`/`~/.codex/plugins`.
- Факт: marketplace объявляет `codex-guardrails` как local source `./plugins/codex-guardrails`, но такого source directory в найденном marketplace tree нет. Существует только installed cache `~/.codex/plugins/cache/personal/codex-guardrails/...`; `~/.agents` также не git repository.
- Следствие: правка cache не является воспроизводимым переносом и последующее reinstall/update потеряет изменения.
- Решение: clean-room plugin должен иметь новый реальный personal marketplace source directory и manifest; затем его нужно установить/активировать штатным Codex plugin flow, сохранив cache только как baseline evidence.
- Проверка: marketplace source path существует, plugin validation проходит, reinstall создаёт cache из source и реальные hooks запускаются из нового version/hash.

### F-023 — Актуальный task source новее Codex task-simple/task-complex

- Источник: `stat` + `sha256sum` пяти task paths от 2026-08-23.
- Факт: актуальный `/home/penis/.agents/skills/task/SKILL.md` изменён 2026-08-18 и имеет 14987 bytes. Codex copies `~/.codex/skills/task-simple` и `task-complex` датированы 2026-08-02 и существенно отличаются. `config.toml` содержит disabled `skills.config` для несуществующих `/home/penis/.agents/skills/task-simple|task-complex/SKILL.md`.
- Решение: source-of-truth для нового Codex task workflow — текущий `.agents/skills/task/SKILL.md` и прямо указанные им зависимости; старые `~/.codex/skills/task-*` удалить/заменить после mapping, мёртвые config entries убрать.
- Проверка: новый Codex skill trigger идёт в текущий contract, отсутствуют deprecated duplicate task skills и config paths существуют.

### F-024 — Новый task contract отделяет общий цикл от runtime adapter

- Источник: полный read текущего `/home/penis/.agents/skills/task/SKILL.md`.
- Факт: актуальный task — единый gated RLM cycle: crystal gate → fresh planner loop → reviewer set → single worker → critic → verifier acceptance → machine finish. Единственное предусмотренное различие runtime вынесено в таблицу `## Runtime`, но сейчас в ней есть только Pi и Claude Code; Codex отсутствует.
- Дополнительные gaps: skill требует role `planner`, которой нет в найденном `~/.codex/agents`; delegation boundary и path examples жёстко ссылаются на `~/.claude`; references используют `${CLAUDE_SKILL_DIR}`; pre-check требует canonical symlink через `~/harness-lib/bin/harness-canon-check`.
- Решение: не возвращать старый `task-simple/task-complex`. Добавить Codex runtime adapter к единому current task contract, Codex planner role и Codex paths/tools, сохранив crystal/verdict/acceptance invariants без semantic упрощения.
- Проверка: `harness-canon-check` видит Codex entrypoint как symlink к canon; реальный trivial и standard Codex task проходят machine-recorded crystal, plan, implementation и acceptance gates.

### F-025 — Task roles должны быть независимы от verdict history

- Источник: прямое уточнение пользователя от 2026-08-23.
- Инвариант: critic не получает прежние critic/verifier/architect verdicts. Planner также не получает verdict feedback/history; он видит только текущие разрешённые артефакты и заново выводит требуемую ревизию. Verifier самостоятельно выводит acceptance criteria из crystal + plan + implementation и не наследует критерии/выводы critic. Crystal-reviewer видит только crystal.
- Разрешённый контекст: crystal-reviewer — current crystal; planner до implementation — current crystal + current plan, после implementation при перепланировании — current crystal + current plan + current implementation evidence; critic/verifier — current crystal + accepted/current plan + current implementation evidence.
- Запрещённый контекст: прошлые verdict files, синтез verdict feedback, `HISTORY` unresolved points и подсказки вида "исправь замечание X".
- Решение: task loop маршрутизирует только статус gate (`ok`/`not ok`) и запускает fresh-context role заново; содержание предыдущего verdict не попадает в следующий role packet. Verifier contract требует секцию independently-derived acceptance criteria.
- Проверка: instrumented task probe записывает role packet manifests; grep не находит verdict/history paths в planner/critic/verifier packets, а verifier report содержит собственные критерии, трассируемые к REQ и observable behavior.

### F-026 — Canon-check пока ложно зелёный для Codex

- Источник: реальный `/home/penis/harness-lib/bin/harness-canon-check` (exit `0`), `stat` entrypoints и полный read скрипта.
- Факт: default `ENTRY_POINTS` перечисляет только `.claude`, `.pi` и `.agents`; `.codex/skills/task` отсутствует. Поэтому check зелёный, хотя Codex canonical symlink отсутствует и рядом существуют legacy directories `task-simple`/`task-complex`.
- Решение: добавить Codex entrypoint в canonical invariant, переместить legacy Codex directories в recoverable backup вне active skills и создать `.codex/skills/task` symlink на canon.
- Проверка: до фикса explicit `HARNESS_CANON_ENTRIES` с Codex path падает; после фикса default check проходит и `readlink -f ~/.codex/skills/task` равен canon.

### F-027 — Role-isolation fix должен применяться и к Claude runtime

- Источник: прямое уточнение пользователя от 2026-08-23.
- Факт: canonical task skill уже общий для `.claude`, `.pi` и `.agents`; если verdict/history routing нарушает F-025, это дефект общего/Claude workflow, а не только отсутствующий Codex adapter.
- Решение: сначала исправить canonical skill, references, role prompts и harness packet builders так, чтобы Claude тоже не передавал verdict history и verifier независимо выводил acceptance; затем подключить Codex к тому же исправленному contract.
- Проверка: Claude runtime packet fixtures и реальный gate probe подтверждают разрешённый artifact-only context; canonical symlink check остаётся зелёным для существующих runtimes.

### F-028 — Общий task действительно передаёт запрещённую verdict history

- Источник: полный read текущих `SKILL.md`, `references/reviewers.md`, `references/acceptance.md`, `references/reporting.md` и `references/crystal.md` в `/home/penis/harness-lib/skills/task`.
- Воспроизведённый дефект: planner revision packet получает пути к verdict-файлам и текст `Verdict responses`; reviewer contract получает `HISTORY`; verifier получает `verdict log` и explicit acceptance feedback; crystal-reviewer получает накопленный `CRYSTAL_REVIEWS`. Это прямо нарушает F-025 и затрагивает общий Claude/Pi runtime.
- Допустимое исключение: implementation report остаётся текущим evidence-артефактом и может быть передан planner/critic/verifier; он не должен включать или встраивать чужие verdicts.
- Решение: удалить verdict/history/feedback payloads из role call contracts, запускать каждый reviewer fresh, а при отрицательном gate передавать следующей роли только факт необходимости нового прохода и разрешённые текущие артефакты. Verifier обязан заново вывести критерии приемки из crystal + plan + implementation evidence.
- Самостоятельный чек: статический packet-contract probe должен завершиться `exit 0` и вывести `role isolation: ok`; отрицательные fixtures с `HISTORY`, `CRYSTAL_REVIEWS`, `verdict log` или verdict path в reviewer input должны завершиться ненулевым кодом.

### F-029 — Утечка закреплена и в Claude/Codex role definitions

- Источник: `rg` по `/home/penis/.claude/agents/{critic,crystal-reviewer,planner,verifier}.md` и read текущих `/home/penis/.codex/agents/{critic,crystal-reviewer,verifier}.toml`.
- Воспроизведённый дефект Claude: `critic.md` принимает `HISTORY`, `ADDITIONAL`, revision history и earlier verdicts; `crystal-reviewer.md` принимает `CRYSTAL_REVIEWS`; `planner.md` в revise-mode принимает `VERDICTS`; `verifier.md` принимает `REVIEWS` и требует учитывать прежние reviewer issues.
- Воспроизведённый дефект Codex: `critic.toml` прямо инструктирует ревью против `HISTORY`/`ADDITIONAL`; `crystal-reviewer.toml` разрешает `ADDITIONAL`; role `planner.toml` отсутствует. `verifier.toml` уже ближе к требуемой изоляции, но его output grammar расходится с общим machine verdict parser.
- Решение: переписать общие Claude role definitions и новые Codex TOML из одного artifact-only contract. Operational metadata (`PHASE`, `VERDICT_FILE`, output path, iteration id) допускается только как транспорт и не может содержать semantic feedback. Project rules роли получают через собственный runtime instruction layer, а не через выборочный parent summary.
- Самостоятельный чек: role-definition probe выводит `claude roles: isolated`, `codex roles: isolated`, `codex planner: present`; запрещённые input names и команды чтения verdict history отсутствуют в semantic sections.
