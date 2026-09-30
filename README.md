# Codex configuration

Авторские настройки Codex, роли агентов, навыки и локальный marketplace.
Каталог отражает текущие исходники на 2026-10-01; описание не обещает
автоматическую установку или переносимость машинных настроек.
Источники: [config.toml](config.toml),
[marketplace](personal-marketplace/.agents/plugins/marketplace.json),
манифесты и README расширений. Правила работы: [AGENTS.md](AGENTS.md).

## Расширения

| Расширение | Краткое описание | Исходники / состояние |
| --- | --- | --- |
| agent-state | Сохраняет и редактирует гайды сессии; возвращает оригиналы после компакта, напоминает сохранить важное и показывает токеновую статистику. | [README](personal-marketplace/plugins/agent-state/README.md); включено |
| control-task | Хранит одну каноническую задачу на сессию; напоминает обновлять её после сообщений пользователя, сохраняет отдельный bootstrap субагентов. | [README](personal-marketplace/plugins/control-task/README.md); включено |
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
  Playwright, Web Inspector и Browser Inspector запускаются через `npx`;
  Context7/Swatchdog используют внешние сервисы.
- Для локальных расширений нужны Node.js; agent-state дополнительно использует
  Python3.11+ и util-linux `flock`. Внешние graph/Pi runtimes устанавливаются отдельно.

Не записывать literal credentials в `config.toml`: использовать переменные
окружения или credential stores. [Корневой allowlist](.gitignore) исключает
сессии, history, SQLite, memories, OAuth, installed caches и credentials.
Архив исходников создаётся из commit, без `.git` и данных работающих сессий.

Локальный marketplace регистрируется через
`codex plugin marketplace add /путь/к/personal-marketplace`;
plugin устанавливается командой `codex plugin add agent-state@personal --json`
(имя заменить для других plugins). После установки проверить `/hooks` и начать
новую сессию; работающие процессы могут сохранять прежний inventory.

самостоятельный чек: `python3 -c 'import json,pathlib; r=pathlib.Path("."); m=json.loads((r/"personal-marketplace/.agents/plugins/marketplace.json").read_text()); t=(r/"README.md").read_text(); assert all(p["name"] in t for p in m["plugins"]); print("OK: every marketplace extension is described")'` + ожидаемый вывод: `OK: every marketplace extension is described`
