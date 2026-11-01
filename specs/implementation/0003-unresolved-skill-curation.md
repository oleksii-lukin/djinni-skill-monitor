# 0003 — Нераспознанные навыки: отчёт и курация словаря

- **Status**: accepted
- **Дата**: 2026-11-01
- **Ветка/этап**: F1+ (качество данных; словарь — единственный источник истины)

## Context

Нераспознанные имена (`Skill(isCanonical=false)`) накапливались с пилота: на 1058 активных
вакансий — **385 нераспознанных навыков (725 связей, 250 вакансий)** при 162 канонических.
Они сохранялись в БД (не терялись), но:

1. **Агрегации не было** — только построчная печать в лог `scrape`/`parse`/`extract:llm`,
   комментарий в `dictionary.ts` ссылался на несуществующий `stats:unresolved`;
2. **Причины смешаны** — пробелы словаря (`Nest.js` ≠ алиас `NestJS`), составные метки
   (`Jira & Confluence`), шум парсера (`2 роки` из `more_skills_exp`) и реальные новые
   навыки (`Three.js`, `Pixi.js`) — без классификации непонятно, что курировать;
3. **Аналитика засорена** — `stats`/`export` считали неканонические вместе с каноническими,
   в топах плавали «2 роки», «Маркетинг», «Комунікація».

Требования: отчёт «навык N — в X вакансиях» по всем вакансиям; безопасное добавление
в словарь; чистые топы в аналитике.

## Decision

Источник истины — `dictionary.ts` (как и раньше): курация пишет в исходник, затем
`seed:skills` + `parse`. Никакого авто-слияния fuzzy-кандидатов — решение за куратором.

| Команда | Режим | Действие |
|---|---|---|
| `pnpm skills:unresolved [--window N] [--min-jobs N] [--top N] [--status] [--export]` | read-only | агрегат нераспознанных: варианты сливаются по `suggestionKey`, число вакансий/доля/источники/вердикт |
| `pnpm skills:promote --name X --category CAT [--aliases a,b] [--apply]` | новый навык | запись в curated-блок `SKILL_DICTIONARY` + `Skill.isCanonical=true` |
| `pnpm skills:promote --name X --merge-into Y [--apply]` | слияние | алиас в `CURATED_ALIASES` + перенос связей на канонический Skill |
| `pnpm skills:promote --name X --drop [--apply]` | шум | удалить Skill и связи |

Ключевые решения:

- **Dry-run по умолчанию**: без `--apply` печатается diff словаря и план БД — промоушен
  редактирует исходник кода, поэтому запись только по явному флагу.
- **Два curated-блока** в `dictionary.ts` с маркерами: `CURATED_ADDITIONS` (новые записи)
  и `CURATED_ALIASES` (алиасы к существующим canonical) — `promote` вставляет строку после
  маркера, не редактируя существующие строки. `buildSkillLookup()` и `seed` работают через
  `skillDictionaryWithCuratedAliases()` — алиасы не теряются.
- **Классификация отчёта**: `alias` (строгий/loose-lookup) → `split` (метка из нескольких
  резолвящихся частей) → `similar` (Левенштейн ≤ порога по длине ключа) → `noise`
  (длительности «2 роки») → `new`. Looseness — только в отчёте: экстракция остаётся
  строгой (детерминизм).
- **Приоритет источников при переносе связей** — как в `extract.ts`
  (`structured > extra > keyword > llm`), `isRequired` по ИЛИ, годы — максимум.
- **Аналитика только каноническая**: `stats`/`export` фильтруют `isCanonical=false`,
  возврат старого поведения — `--include-unresolved`.
- **Парсер**: шаг 3 `parseSkillsBlock` (свёрнутый `more_skills_exp`) больше не берёт
  `detail-rows__value` как навык — утечка «2 роки»/«6 місяців» закрыта.
- **Подсказка в логе парсера**: если за прогон встретились нераспознанные имена,
  `scrape`/`parse`/`extract:llm` печатают итог со ссылкой на `skills:unresolved`.

## Consequences / Trade-offs

- **Курация ручная по приоритету**: отчёт сортирует по числу вакансий — единичные
  вхождения можно игнорировать, повторяющиеся (`--min-jobs 2`) курировать планово.
- **`--drop` не лечит источник**: если шум пришёл из бага парсера — он починен, после
  `pnpm parse` не вернётся; иначе djinni пересоздаст имя при следующем парсинге.
- **Исторические шумовые связи** остаются в БД до `pnpm parse` (перепарсинг кэша
  пересчитывает навыки всех вакансий).
- **Лицензия на запись в код**: `promote` редактирует `dictionary.ts` текстом — идемпотентно
  (повторный запуск пропускает существующие записи), маркеры обязаны сохраняться.
- **Словарь растёт линейно**, LLM-нормализация нераспознанных — возможный следующий шаг,
  в эту итерацию не входит.

## Изменённые файлы (этап)

- `src/parser/parse-detail.ts` — фильтр `detail-rows` в шаге `more_skills_exp`
- `src/skills/dictionary.ts` — `CURATED_ALIASES`, маркеры, `skillDictionaryWithCuratedAliases()`
- `src/skills/unresolved.ts` — классификация (новый)
- `src/skills/report-unresolved.ts` — CLI отчёта (новый)
- `src/skills/promote.ts` — CLI курации (новый)
- `src/skills/seed.ts`, `src/parser/check-fixtures.ts` — merged-словарь
- `src/scraper/scrape.ts`, `src/parser/run-parse.ts`, `src/skills/run-extract-llm.ts` —
  итоговая подсказка по нераспознанным
- `src/analysis/{stats,export}.ts` — `--include-unresolved`
- `package.json`, `README.md`, `specs/README.md`

## Порядок прогона (см. README, «Курация нераспознанных навыков»)

1. `pnpm parse` — убрать исторический шум старого парсера;
2. `pnpm skills:unresolved -- --min-jobs 2 --top 30` — топ кандидатов (+ `--export`);
3. `pnpm skills:promote … --apply` по топу (dry-run → apply);
4. `pnpm seed:skills && pnpm parse` — закрепить словарь и пересчитать навыки;
5. `pnpm stats -- --skills React --window 30` — топы без мусора.
