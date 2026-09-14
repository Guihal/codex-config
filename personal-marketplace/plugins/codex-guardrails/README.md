# Codex Guardrails

Нативные Codex-адаптации выбранных локальных Pi guardrails: injection rules
и lint-inject. Изменения политики относительно Pi отмечаются явно.

## Ограничение строк команд удалено

С версии 0.1.1 plugin не ограничивает количество строк в Bash-команде.
По запросу пользователя удалены `bash-line-guard.mjs`, его регистрация
`PreToolUse`, старые тесты ограничения и соответствующая запись доверия
в репозиторном `config.toml`. Injection rules и lint-inject сохранены.
Ограничения других плагинов и самого Codex этой правкой не меняются.

Оценка следующих переносов из Pi и Claude: [PORTABILITY.md](PORTABILITY.md).
Это рекомендации, а не список дополнительно включённых расширений.

## Установка и проверка

После установки новый или изменившийся command hook нужно просмотреть и явно
доверить через `/hooks`. Запуск с обходом hook trust не требуется.

Проверка из каталога plugin:

```bash
node --test tests/*.test.mjs
python3 /home/penis/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py /home/penis/plugins/codex-guardrails
```

`tests/hook-registration.test.mjs` проверяет отсутствие старого ограничителя
и сохранение регистрации lifecycle/линтера. Это не end-to-end проверка Codex.
Обновление репозитория само по себе не обновляет отдельную установленную копию
plugin: она должна использовать обновлённые исходники.

Auditor extension в этот plugin не переносится и не изменяется. Auditor
существует в Codex только как роль субагента.

## Injection rules

Это stateful-порт реального `/home/penis/.pi/agent/extensions/injection-rules.ts`,
а не одноразовый startup prompt. Каталог содержит 17 активных правил из
`/home/penis/.claude/mcp/injection-rules/rules`; policy body сохранены, а имена
ролей и runtime-тулов адаптированы к Codex.

Lifecycle:

- `SessionStart` и `SubagentStart` добавляют standing body. `startup`/`clear`
  сбрасывают session state, `resume`/`compact` сохраняют cadence и buffers.
- `UserPromptSubmit` захватывает user text, обслуживает input-clock и добавляет
  standing body на каждый самостоятельный model turn. Маркер lifecycle не даёт
  задублировать его сразу после `SessionStart`/`SubagentStart`.
- `PostToolUse` захватывает tool response. `Stop`/`SubagentStop` захватывают
  assistant text, двигают turn-clock и планируют reminders на следующий вход.
- Поддержаны Pi schema `apply`, `send_on_start`, `window`, `every_n_turns`,
  `priority`, `on_user_end`, `every_input`, semantic `any/all/none/source`,
  cooldown и canonical/legacy hint modes. Exclusion всегда сильнее wildcard.
- State хранится атомарно под `PLUGIN_DATA`, раздельно по хешу session и actor;
  межпроцессная блокировка защищает параллельные hook-вызовы. Semantic debug
  пишется в `rules-debug.jsonl`.

Codex не передаёт `agent_id` в обычный `PostToolUse`, поэтому такой tool output
нельзя надёжно приписать субагенту: без явных actor fields он относится к main.
Hint notify выводится через `systemMessage` вместе со следующим входом, а не
мгновенным Pi UI toast. `project-structure` этим plugin не меняется.

## Lint inject

После `apply_patch` plugin извлекает добавленные, обновлённые и перемещённые
файлы и запускает холодные линтеры из исходного Pi registry. Сохранены 17
языковых планов, парсеры, project-local binary resolution, configless PATH
fallback, `lint-inject.config.ts` и ограниченные отчёты. Результат добавляется
как advisory context и не отменяет правку.

Если найден бинарь, но в Git-проекте нет обязательного конфига, hook создаёт
маркированный Pi-дефолт для ESLint, TypeScript, stylelint или markdownlint.
Пользовательские конфиги всегда приоритетнее. Дефолт существует только пока
работает соответствующий линтер, скрывается точечным блоком в
`.git/info/exclude` и удаляется последним владельцем. Атомарное создание,
root-lock и PID/token leases защищают параллельные одноразовые hook-процессы от
перезаписи пользовательского файла и преждевременного cleanup.

`tsc/vue-tsc --watch` адаптирован в bounded cold `--noEmit --pretty false`:
типовые диагностики сохраняются, но демон не остаётся сиротой после завершения
одноразового Codex command hook. Не переносятся межвызовный backoff/batching и
lint на read: отдельного Read tool здесь нет. После failed Update существующий
неизменённый файл может быть проверен повторно, поскольку стабильного
success-поля для apply_patch hook не документировано.

Сам lint выполняется в worker thread. До завершения всех project-hook вызовов
действует отдельный watchdog 1 с: он прерывает не только async timeout, но и
синхронный CPU-loop в `lint-inject.config.ts`, после чего основной hook остаётся
fail-open и возвращает диагностический advisory context.
