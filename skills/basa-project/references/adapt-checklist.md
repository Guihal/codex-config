# Подрезка шаблона под проект — чек-лист

## Переписать

| Файл | Что сделать |
| --- | --- |
| `package.json` | `name` = slug, `description` = проект; добавить `build:pages` с явным списком страниц |
| `README.md` | имя проекта, команды, состав страниц; демо-описание шаблона убрать |
| `src/js/main.ts` | первый реальный блок проекта вместо пустого файла |
| `src/scss/main.scss` | подключение стилей проекта; сохранить `@use './utils'` и `autoscale` |
| `index.html` | заголовок и точка монтирования под проект |
| `AGENTS.md` | только если поменялась структура проекта; Tilda-раздел не удалять |

## Удалить

- `docs/refactor/**` — 23 документа рефакторинга шаблона, к проекту не относятся;
- демонстрационные модули, которых нет в проекте (например `favoriteProducts/`,
  если избранное не нужно);
- упоминания шаблонного roadmap в `README.md`.

## Никогда не удалять

- `src/js/utils/**` — 16 утилит (`elementReady`, `reactive`, `escapeHTML`, …);
- SCSS-систему: `_vars`, `_mixins`, `_functions`, `_global`, `utils/`, `plugins/_autoscale.scss`;
- `vite.config.ts`, `vitest.config.ts`, `tsconfig.json`, `.prettierrc`;
- `tests/**` — каркас тестов (smoke/unit/dom);
- `plugins/vite-build-counter.ts` и `build-counter.json`;
- Tilda-раздел в `AGENTS.md` и `references/tilda-rules.md` этого скилла.

## Проверка после подрезки

1. `pnpm install --frozen-lockfile` — проходит.
2. `pnpm build` — `app/index.html`, `app/css/index.css`, при непустом `main.ts` — `app/js/*.js`.
3. `pnpm test` — 27/27.
4. `git status` — изменения только в перечисленных файлах.
5. В `README.md` и в отчёте человеку есть сниппет с `type="module"`.
