# Codex configuration

Авторские настройки Codex, роли агентов, навыки и локальный marketplace.
Каталог отражает текущие исходники на 2026-10-01; описание не обещает
автоматическую установку или переносимость машинных настроек.
Источники: [config.toml](config.toml),
[marketplace](personal-marketplace/.agents/plugins/marketplace.json),
манифесты и README расширений. Правила работы: [AGENTS.md](AGENTS.md).

Правило первичного понимания, первого ответа и пересмотра по источникам находится
в [AGENTS.md, Start from the task and available skills](AGENTS.md#start-from-the-task-and-available-skills).
После изменения этого файла начать новый Codex run/session, чтобы загрузить правила;
работающая сессия может сохранять прежний snapshot.

## Расширения

| Расширение | Краткое описание | Исходники / состояние |
| --- | --- | --- |
| agent-state | Сохраняет только переиспользуемые микроскиллы; возвращает оригиналы после компакта, напоминает сохранить важное и показывает токеновую статистику. | [README](personal-marketplace/plugins/agent-state/README.md); включено |
| control-task | Хранит основную задачу и её требования, без состояния выполнения; обновляется только после сообщений пользователя, сохраняет отдельный bootstrap субагентов. | [README](personal-marketplace/plugins/control-task/README.md); включено |
| reasoning-poison | Независимые напоминания проверять рассуждения, держать цель пользователя и читать источники проекта; каденции 5/13/17 вызовов. | [README](personal-marketplace/plugins/reasoning-poison/README.md); включено |
| project-structure | Инжектит ограниченное дерево проекта и предоставляет read-only инструмент `project_tree`. | [README](personal-marketplace/plugins/project-structure/README.md); включено |
| codebase-project-graph | Кэш архитектуры и read-only поиск/обход графа зависимостей кода. | Внешний репозиторий; здесь только ссылка, включено |
| codex-guardrails | Исторический набор поведенческих правил, lint-inject и runtime guards. | [README](personal-marketplace/plugins/codex-guardrails/README.md); исходники сохранены, сейчас не установлен |
| searxng | Заготовка plugin; собственный список MCP-серверов пуст. Рабочий поиск отдельно подключён в `config.toml`. | [Манифест](personal-marketplace/plugins/searxng/.codex-plugin/plugin.json); сейчас не установлен |

Состояние установки проверено через `codex plugin list --json` на Codex0.159.1.
Содержимое установленных сторонних plugins и bundled skills не хранится здесь.

## Общий набор и зависимости

- `.agents`: общие пользовательские навыки и ссылка на этот marketplace.
- `harness-lib`: общие task/design workflows, проверка канона и обработка verdict.
  Реальный каталог на исходной машине — `~/harness-lib`, без точки.
- `skills/task` ссылается на `harness-lib`; graph plugin ссылается на отдельный
  `~/plugins/codebase-project-graph`, который не входит в набор этих трёх репозиториев.
- `config.toml` содержит машинные абсолютные пути, trust и full-access настройки.
  Перед использованием на другой машине адаптировать пути и внешние MCP:
  Figma bridge, computer-use, SearxNG и desktop Node REPL требуют отдельных runtime.
  Web Inspector подключён через небольшой Rust stdio/Unix adapter к общему Bun host;
  отдельные MCP Playwright и Browser Inspector удалены по запросу пользователя;
  Context7/Swatchdog используют внешние сервисы.
- Для локальных расширений нужны Node.js; agent-state дополнительно использует
  Python3.11+ и util-linux `flock`. Внешние graph/Pi runtimes устанавливаются отдельно.

Web Inspector на 2026-10-21 использует immutable Bun generation и транспорт из
`/home/penis/projects/mcode-shared-mcp`; команды сборки, provenance и проверок
описаны в [README транспорта](/home/penis/projects/mcode-shared-mcp/README.md#codex-stdio-transport).
Существующие `--no-save-session --cdp-port 0`, таймауты и tool policies сохранены.
Один короткий Bun helper вычисляет endpoint исходным mcode helper и завершается;
на соединение остаётся один Rust transport, а совместимые соединения делят Bun
backend. Cwd/argv/env остаются частью authority. Два потока одного native Codex
app-server проверены с одним backend; разные app-server могут иметь разные PATH
и поэтому отдельные backend. Чужое окружение ради объединения не отбрасывается.
После последнего подключения backend освобождает браузеры и завершается.
Новая конфигурация применяется к новым подключениям; работающие сессии не
перезапускались. Native проверка: `bun /home/penis/projects/mcode-shared-mcp/tests/codex-native.mjs --installed`.

Не записывать literal credentials в `config.toml`: использовать переменные
окружения или credential stores. [Корневой allowlist](.gitignore) исключает
сессии, history, SQLite, memories, OAuth, installed caches и credentials.
Архив исходников создаётся из commit, без `.git` и данных работающих сессий.

Figma Bridge с2026-10-21 также подключён через тот же Rust stdio/Unix transport
к общей Bun реализации из `mcode-shared-mcp/deployments/figma-<digest>`.
Исходники, provenance и проверки описаны в
[README транспорта](/home/penis/projects/mcode-shared-mcp/README.md#u9-mig-001--figma-bridge-shared-bun-host).
Поддерживаемые поля command/args/env и таймауты сверены с установленным CLI и
[официальной документацией MCP](https://learn.chatgpt.com/docs/extend/mcp?surface=cli).
`required=true`,30/360-секундные таймауты и tool approval policies сохранены.
Два native Codex-подключения с одинаковой authority делят один Bun backend;
на каждое соединение нужен небольшой Rust adapter. Cwd/env по-прежнему
разделяют несовместимые authority. Listener запускается первым корректным
tool call, pin/cache/change-clear принадлежат логическому клиенту, последний
lease освобождает listener и host. ZCode сохраняет прежний Node stdio-вход.
Проверка actual Codex с двумя ephemeral threads прочитала без изменений
SECTION`1468:22` файла`5GBEdaoJ3nB5eMqWjXNt0m`, page`1326:768`, и проверила
invalid input, peer survival, SIGTERM/SIGKILL, final exit и restart.

Локальный marketplace регистрируется через
`codex plugin marketplace add /путь/к/personal-marketplace`;
plugin устанавливается командой `codex plugin add agent-state@personal --json`
(имя заменить для других plugins). После установки проверить `/hooks` и начать
новую сессию; работающие процессы могут сохранять прежний inventory.

самостоятельный чек: `bun /home/penis/projects/mcode-shared-mcp/figma/native-codex.mjs` + ожидаемый вывод: `Native Codex Figma: 2 passed`, один Bun backend и два Rust transport adapters.

Codebase Memory с2026-10-22 MSK подключён к immutable Bun facade через тот же
Rust transport. Явное `mcp_servers.codebase-memory-mcp` перекрывает только запуск
этого plugin MCP: сохранены его прежние installed-plugin cwd,
`PROJECT_GRAPH_ALLOWED_ROOT`, полный положительный allowlist11 tools,
20/60-секундные таймауты и четыре approval policies. CBM plugin entrypoint и
другие его потребители сохранены. После обновления plugin/native executable
перепроверить pinned cwd и пересобрать generation.

Два совместимых Codex подключения делят один Bun host и один исходный native
`codebase-memory-mcp --tool-profile=analysis` frontend; на stream остаётся один
небольшой Rust adapter. Native authenticated daemon остаётся своим владельцем
данных. Dispatch ограничен8 native requests/12MiB, typed IDs и cancellation
разделены по stream. Native JSON body ограничен10485743 UTF-8 bytes
(17 служебных bytes входят в10MiB IPC frame); превышение не закрывает peer.
Concurrent reconnect ждёт актуальную closing generation.
Каталог, prompts/resources/protocol/errors обслуживает
native backend. `CBM_ALLOWED_ROOT` ограничивает индексирование, а чтение других
сохранённых graph projects остаётся допустимым. Новые mutating tools не
появились. Подробности и provenance: [README транспорта](/home/penis/projects/mcode-shared-mcp/README.md#u10--cbm-analysis-facade).

самостоятельный чек: `bun /home/penis/projects/mcode-shared-mcp/cbm/native-codex.mjs` + ожидаемый вывод: `Native Codex CBM: 2 passed`, реальные graph queries, invalid input, сохранённый cwd, peer survival, SIGTERM/SIGKILL и restart.

Project Graph с2026-10-22 MSK подключён к общей Bun factory через Rust transport.
Явный `mcp_servers.project-graph` сохраняет прежние plugin cwd, root,20/120s
таймауты, запрет parallel calls и auto approval policy. Per-stream runtime
использует исходные domain/repository/cache/compiler owners; графы разных cwd
выбираются через существующий `codex/sandbox-state-meta.sandboxCwd`.
В debug API `mcpServer/tool/call` это supported `_meta` нужно передавать явно:
одного threadId при проверке было недостаточно. Обычный fallback cwd сохраняется.
Launch PWD явно равен фактическому host cwd; прочее окружение продолжает
разделять authority. Подробности: [Graph transport](/home/penis/projects/mcode-shared-mcp/README.md#u11--project-graph-bun-factory).

самостоятельный чек: `bun /home/penis/projects/mcode-shared-mcp/graph/native-codex.mjs` + ожидаемый вывод: `Native Codex Graph: 2 passed`, catalog6, отдельные workspace/cache и корректное завершение/restart.

Computer Use с2026-10-22 MSK сохраняет прежний Bun SCENE proxy и его command/args,
30/120s таймауты и все tool approval policies. Его supported CUSP_BIN/CUSP_BIN_ARGS
теперь выбирают существующий Rust stdio/Unix adapter к общему Rust desktop host.
Исходный native ELF и другие потребители не менялись. Один свежий
ComputerUseLinux::default() на stream сохраняет отдельные node/portal caches;
совместимые подключения делят один Rust backend. На Codex connection остаются
существующий Bun SCENE frontend и небольшой Rust adapter. Различающиеся cwd/env
по-прежнему разделяют authority, поэтому mcode и Codex не обязаны делить один PID.
Source/provenance и команды: [Native Rust desktop host](/home/penis/projects/mcode-shared-mcp/README.md#u12--native-rust-desktop-host).
Actual app-server read-only checks проверяют catalog18, живое accessibility tree,
снимки, native invalid-parameter errors, peer survival, SIGTERM/SIGKILL и restart.
Desktop input/window movement не выполнялись; SCENE mutation logic проверена
прежними mock tests и сохранением исходников proxy.

самостоятельный чек: `bun /home/penis/projects/mcode-shared-mcp/computer-use/native-codex.mjs` + ожидаемый вывод: `Native Codex desktop: 2 passed`, один Rust backend, два transport adapters и два Bun SCENE frontends.
