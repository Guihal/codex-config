# Project Structure for Codex

Codex-адаптация актуального Pi-extension
`~/.pi/agent/extensions/project-structure.ts`.

- На обычном старте показывает `Project: <cwd>` и инжектит дерево.
- После compaction инжектит дерево без повторного уведомления и сброса счётчика.
- Повторяет инжект каждый десятый root prompt.
- Каждый новый subagent получает собственный initial tree, не меняя root-счётчик.
- `project_tree` показывает любой каталог; относительный `path` считается от
  активного Codex cwd.

Глубина по умолчанию читается из `pj-tree.conf` активного cwd (`depth=0..30`),
иначе равна 2. Явный `depth` инструмента имеет приоритет. Hook ограничен 12000
символами, MCP — 40000.

Фильтрация намеренно повторяет Pi, а не `.gitignore`: сначала применяется
глобальный snapshot `assets/project-structure.ignore`, затем
`project-structure.ignore` из корня запрошенного дерева. Паттерны сопоставляются
с basename одного сегмента; `*`, `?`, классы, trailing `/` и `!` поддерживаются,
последнее совпадение побеждает.

## Проверка

```bash
node --test tests/*.test.mjs
python3 ~/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py .
```
