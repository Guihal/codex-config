# Agent Guides for Codex

`agent-state@personal` сохраняет reusable micro-skills и гайды в папке сессии.
Текущие цели, прогресс и статус остаются в разговоре/control state. Содержимое
файлов не пересжимается в summary.

## Тулы

- `agent_state_note(title, body, shared=false, note_id?)`: создать файл или
  отредактировать существующий own файл по `note_id` (индексу файла). Содержимое:
  когда применять, процедура, ошибки, проверка будущего действия.
- `agent_state_checkpoint(content)`: необязательный совместимый concise guide
  для старых клиентов. Наличие якоря не требуется. Старые записи сохраняются.
- `agent_state_read()`: разрешённые файлы, optional guide и токеновая статистика.
  `agent_state_read(note_id, cursor?)`: полное содержимое страницами. При правке
  файла старый курсор отвергается; чтение нужно начать заново.
- `agent_state_history(query, cursor?, limit?)`: буквальный поиск в собственном
  оригинальном rollout, включая историю до компакта. Не regex и не shell.

После save/edit продолжать задачу. Отдельное подтверждение или перечитывание
записи агентом не требуется. Тул сам выполняет atomic write/fsync/read-back;
ошибка записи возвращается как ошибка тула. Sid и пути конструирует код:
MCP использует только Codex `_meta.threadId`, hook — `agent_id ?? session_id`.
Никаких sid/path аргументов и newest-session guessing.

## Инжект и ремайндер

Все разрешённые guide-файлы передаются единому `buildInjection({files,maxBytes,
preamble})`. Обычный предел — **80000 байт UTF-8**, включая инструкции, заголовки
и пути. Сборка последовательная в памяти: полное содержимое, если помещается;
иначе UTF-8 safe обрезка и `INJECTION TRUNCATED` с полными путями всех обрезанных
или пропущенных файлов. Оригиналы не изменяются. Если даже пути не помещаются,
возвращается явная ошибка. Для native SubagentStop reason действует отдельный
лимит9KiB через ту же абстракцию.

Перед компактным порогом английский императив:
`YOU MUST SAVE IMPORTANT REUSABLE GUIDES NOW using agent_state_note ... Then CONTINUE THE TASK.`
Save trigger —80% от консервативного кандидата порога. Read-only lookup учитывает
root config, system/managed config, ancestor CLI flags, selected profile file,
trusted project candidates, каталог модели и post-turn threshold. Если порог
не найден —80% declared window; без численного значения — cadence fallback.
Изменение модели/порога перевзводит ремайндер. Большой несэмплированный tool
output также требует сохранения. Плагин не меняет native compact algorithm.

Это **UNCALIBRATED**, а не утверждение о точном эффективном пороге thread:
UI/runtime/cloud overrides и baseline для `body_after_prefix` не раскрываются
хуками. Более ранние config candidates могут дать более ранний ремайндер.
Сбой config lookup явный и не мешает сохранению гайдов.

Хуки: SessionStart, SubagentStart, UserPromptSubmit, PostToolUse, PreCompact,
PostCompact, SubagentStop. На старте/resume/compact/user prompt, каждые5 tools,
после save/edit и при approaching cutoff инжектятся оригинальные файлы.
PreCompact не создаёт отдельного recovery index и не требует authored anchor;
проверяет доступность разрешённых оригиналов. Реальная ошибка binding/storage
или corrupt optional guide остаётся явной; PreCompact может остановить компакт.

Root получает файлы до следующего inference на SessionStart(compact).
Codex0.159.1 пропускает SessionStart после child compact: первый child inference
или tool может предшествовать восстановлению. PostToolUse возвращает файлы
для следующего inference; final-only SubagentStop выдаёт bounded continuation
и требует новую генерацию. Это ограничение native event lifecycle, не гарантия
доставки перед первым child inference. Code Mode nested UUID не считаются
model response-item IDs; плагин не вмешивается в native tool authorization.

## Токены и scope

`agent_state_read().usage.latest` содержит exact `input_tokens`,
`cached_input_tokens`, `output_tokens`, `reasoning_output_tokens`, `total_tokens`,
response/turn ID и timestamp последнего **own upstream response** из
`token_usage_record.payload.usage`. Cumulative thread totals не равны заполнению
контекста. Cached input входит в input, reasoning входит в output. Свежий local
output не является exact sample; freshness/unsampled bytes возвращаются отдельно.
Также: `node scripts/probe.mjs tokens` использует runtime `CODEX_THREAD_ID`.

Child видит own файлы и только `shared:true` файлы непосредственного родителя.
Optional parent guide private; grandparent и unrelated actors не читаются.
History исключает inherited prefix по trusted SubagentStart floor; без floor
fail-closed. Full-access shell сам имеет права ОС, это не OS sandbox.

## Хранение и установка

`${XDG_STATE_HOME:-~/.local/state}/codex-agent-state/sessions/<sha256(actor)>/`:
guide files в `notes/`, reader metadata в `state.json`, optional legacy guide в
`checkpoint.json`. `recovery.json` не создаётся и не используется. Старые файлы
не удаляются. Dirs0700/files0600; symlinks отвергаются. Note max128KiB,
optional guide8KiB, read page8KiB, max4096 files/actor.

Rollout scanner ограничен8MiB/call с2MiB look-ahead; JSON parse max2MiB/row.
Большие строки пропускаются порциями без материализации. Coverage/skip paths
явные; pre-gap exact sample сбрасывается. Pending catch-up: `usage.latest=null`.
Original rollout только читается. Guide writes не зависят от oversized rows.

Linux `flock` на постоянном private inode `mutex` освобождается ядром при смерти
процесса. Wait1.2s; legacy gate может добавить1.2s. Proven-dead owner recoverable
под mutex; live/unknown owner не крадётся по возрасту. Не удалять live mutex.
Runtime: Node built-ins, Python3.11+ stdlib (TOML config lookup), util-linux flock.

Source: `/home/penis/.codex/personal-marketplace/plugins/agent-state`.
Install: `codex plugin add agent-state@personal --json`. После изменений bump
manifest, reinstall, проверить current hook hashes через `/hooks`.
Fresh frontend/process нужен для нового MCP inventory; hot reload не обещается.
Runtime files/cache/sessions не входят в authored configuration repository.

## Проверки

`node --test tests/*.test.mjs`: persistence/edit/cursors, UTF-8 injection budget,
scope, exact usage, config candidates, concurrent writes/crash recovery, I/O
failure, oversized rollout и final-only generation.
`node scripts/probe.mjs integration`: disposable app-server/synthetic Responses
fixture для lifecycle. Synthetic transport evidence не доказывает выбор тула
реальной моделью. После upgrades повторить проверку installed event contracts.
Hooks reference: https://learn.chatgpt.com/docs/hooks.
Native experimental context management не включается этим плагином.
