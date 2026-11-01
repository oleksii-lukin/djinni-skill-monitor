# djinni-skill-monitor — SkillRadar

Монитор рынка вакансий djinni.co: сбор, детерминированный парсинг, извлечение навыков,
аналитика комбинаций (skill gap), сигналы конкуренции (отклики, рекрутер, кандидаты).
Профиль пользователя и матчинг — отдельная надстройка (рыночные данные от неё не зависят).

Документация: [`specs/`](specs/README.md) · Лог имплементации: [`specs/implementation/`](specs/implementation/)

## Стек

- Node.js 20+, TypeScript, tsx (запуск TS без сборки)
- PostgreSQL 16 (Docker Compose, порт 5433) + Prisma
- cheerio — детерминированный парсинг HTML; AI SDK (`ai`) — опциональный LLM-слой извлечения

Версия Node закреплена для volta в `package.json` (`"volta": { "node": "24.22.0" }`) —
при наличии volta проект автоматически использует её; иначе нужен Node ≥ 20.

## Одноразовая настройка (только эти две команды запускает пользователь)

```bash
pnpm install          # зависимости (в т.ч. генерация Prisma-клиента)
docker compose up -d  # PostgreSQL на порту 5433
cp .env.example .env  # DATABASE_URL уже настроен под docker-compose
```

Дальше миграции, скрейп и аналитику можно запускать без дополнительной настройки:

```bash
pnpm db:migrate       # prisma migrate dev — создаёт схему
pnpm seed:skills      # загрузка словаря навыков (~200 canonical-записей с алиасами)
```

## Пилот: прогон на реальных данных (порядок действий)

```bash
# 1. Малый прогон: 2 страницы списка (~30 вакансий) + 10 detail-страниц.
#    Пауза 3–8 с (случайная) между запросами — полный цикл ~1-2 мин.
pnpm scrape -- --pages 2 --vacancies 10

# 2. Проверка парсера на семплах (офлайн, без БД) — опционально, полезно при правках парсера
pnpm check:fixtures

# 3. Статистика: «что рядом с React» за 30 дней — ядро сценария skill gap
pnpm stats -- --skills React --window 30 --top 15

# 4. Экспорт аналитического представления (JSON + long-format CSV)
pnpm export -- --window 30

# 5. Добор данных до ~100-200 вакансий: повторять (можно в фоне, не чаще 1 раза в час,
#    TTL списка 1 день не даст переиспользовать устаревший кэш)
pnpm scrape -- --pages 5 --vacancies 25

# 6. После доборов — снова stats/export и разбор реального кейса
#    Несколько навыков объединяются по ИЛИ: вакансия в выборке, если содержит
#    хотя бы один из них («мой стек» — не строгое требование комбинации)
pnpm stats -- --skills React,TypeScript --window 30

# 7. Сигналы конкуренции — «сколько откликнулось и стоит ли подаваться».
#    Detail-сигналы (30-дневная разбивка, активность и ответ рекрутера) уже в БД после parse.
#    apply_stats (профиль кандидатов) — он-деманд, сначала собираем рыночную базу:
pnpm competition -- --window 90 --limit 100 --export   # добор снапшотов + baseline
pnpm competition -- --skills React,TypeScript --window 30 --limit 25   # топ-25 под мой стек
pnpm competition -- --job 834543                       # подробная карточка одной вакансии

# 8. Курация словаря — когда в логе скрейпа/парсинга накопились нераспознанные имена
pnpm parse                                    # перепарсить кэш (убрать шум старого парсера)
pnpm skills:unresolved -- --min-jobs 2 --top 30   # что не резолвится и сколько вакансий
pnpm skills:promote -- --name "Nest.js" --merge-into "NestJS" --apply   # и т.д. по топу
pnpm seed:skills && pnpm parse                # закрепить словарь и пересчитать навыки
```

Файлы для просмотра после прогона:
- `cache/analysis/snapshot-<date>.csv` — таблица вакансия×навык (открывается в Excel/Google Sheets/pandas);
- `cache/analysis/snapshot-<date>.json` — структурированный снапшот;
- `cache/analysis/competition-<date>.csv` — сигналы конкуренции, одна строка = вакансия.

## Команды

| Команда | Что делает |
|---|---|
| `pnpm scrape -- --pages N --vacancies N` | Сбор: N страниц списка + N detail-страниц (очередь: новые → изменённые → просроченные по TTL) |
| `pnpm scrape -- --pages 2 --vacancies 10 --dry-run` | Тот же прогон без записи в БД/кэш (отчёт) |
| `pnpm parse` | Перепарсинг кэшированных detail-HTML без сети (после правок парсера/словаря) |
| `pnpm extract:llm [-- --limit N] [--job ID]` | LLM-добор навыков по кэшу: только вакансии с < порога навыками (`LLM_ENABLED=1`) |
| `pnpm check:fixtures` | Офлайн-проверка парсеров на семплах `cache/research/` |
| `pnpm seed:skills` | Загрузка/обновление словаря навыков в БД |
| `pnpm skills:unresolved [-- --window N] [--min-jobs N] [--top N] [--status active\|all] [--export]` | Отчёт нераспознанных навыков: варианты слиты, число вакансий/доля/источники, вердикт (алиас/составной/похоже/шум/новый) |
| `pnpm skills:promote -- --name X (--category CAT [--aliases a,b] \| --merge-into Y \| --drop) [--apply]` | Курация словаря: запись в `dictionary.ts` + БД; без `--apply` — dry-run |
| `pnpm stats -- --skills React[,TypeScript] [--window 7\|30\|90] [--top N] [--include-unresolved]` | share=P(X\|S), lift, пробелы, глобальные частоты; навыки объединяются по ИЛИ |
| `pnpm competition -- --skills React[,TypeScript] [--window N] [--limit N] [--export]` | Сигналы конкуренции: сколько откликнулось, темп, рекрутер, перцентиль к рынку (+ добор `apply_stats` по TTL) |
| `pnpm export [-- --window N] [--include-unresolved]` | Снапшот JSON + CSV (аналитическое представление) |
| `pnpm db:studio` | Prisma Studio — просмотр БД |

Флаги скрейпера: `--pages` (default 5), `--vacancies` (default 5), `--list-ttl-days`
(default 1), `--detail-ttl-days` (default 7), `--keywords <список|none>` (категории
фильтра на один запуск), `--dry-run`.

Флаги `competition`: `--job <ids>` (одна/несколько вакансий), `--skills <список>` (ИЛИ, как
в `stats`), `--category`, `--window` (default 30), `--limit` (default 20, max 500),
`--ttl-hours` (default 24), `--force`, `--no-fetch`, `--dry-run`, `--export`,
`--sort opportunity|competition|fresh|applicants`. Подробнее: [specs/07-competition-signals.md](specs/07-competition-signals.md).

`stats` и `export` по умолчанию считают только канонические навыки: неканонические
(`isCanonical=false`) — сырьё для курации, они засоряют топы и пробелы. Вернуть их —
флаг `--include-unresolved`.

## Курация нераспознанных навыков

Имена, которых нет в словаре, скрейп/парсинг/LLM сохраняют как `Skill(isCanonical=false)`
и печатают в лог. В конце прогона — итоговая подсказка со ссылкой на отчёт. Цикл курации:

```bash
# 1. Свежий перепарсинг кэша — убирает шум старого парсера («2 роки», «6 місяців»)
pnpm parse

# 2. Отчёт: что не резолвится, в скольких вакансиях, какой вердикт
pnpm skills:unresolved -- --min-jobs 2 --top 30
pnpm skills:unresolved -- --window 30 --export   # JSON/CSV в cache/analysis/ для разбора

# 3. Промоушен по топу (dry-run показывает diff словаря и план БД, --apply пишет)
pnpm skills:promote -- --name "Nest.js" --merge-into "NestJS" --apply    # вариант → canonical
pnpm skills:promote -- --name "Three.js" --category FRONTEND --aliases "ThreeJS" --apply  # новый
pnpm skills:promote -- --name "2 роки" --drop --apply                    # шум парсера

# 4. Закрепить: словарь в БД + пересчёт навыков по кэшу
pnpm seed:skills && pnpm parse
```

Когда курировать: после прогона, где в логе появились нераспознанные имена, либо планово —
когда в `--min-jobs 2` набралось достаточно повторяющихся кандидатов (единичные вхождения
обычно мусор или разовые технологии, их можно игнорировать). Частота — раз в несколько
прогонов, словарь статичен и растёт линейно.

Вердикты отчёта:

- **алиас** — имя уже есть в словаре в другом написании (`Nest.js` → `NestJS`);
- **составной** — метка из нескольких навыков (`Jira & Confluence` → `Jira + Confluence`);
- **похоже** — fuzzy-кандидат (Левенштейн), решение за куратором;
- **шум** — артефакт парсера (длительности), удаляется `--drop`;
- **новый** — действительно отсутствует в словаре, добавляется `--category`.

Категории `--category`: `LANGUAGE, FRONTEND, BACKEND, DATABASE, CLOUD, DEVOPS, TOOL,
TESTING, DOMAIN, CONCEPT, OTHER`.

## Фильтр категорий («Розробка»)

Список обходится с фильтром категорий djinni — повторяющимися GET-параметрами
`primary_keyword` (мультивыбор из категории фильтра на сайте). Это сузит ~6135
вакансий всего сайта до ~256 в выбранном наборе:

```bash
# дефолтный набор (env не задан): JavaScript + Angular, Markup, React.js, Svelte, Vue.js,
# Fullstack, Node.js, No Code, React Native
FILTER_PRIMARY_KEYWORDS="..."   # .env: список через запятую; "none" или пусто — без фильтра
pnpm scrape -- --keywords React.js,Fullstack   # разовый оверрайд без правки .env
```

Смена фильтра инвалидирует кэш списка (fingerprint в `ListCacheState` / `list-state.json`).
Если в кэше собран полный список (`ids >= totalCount`, напр. 256/256), повторные прогоны в
течение TTL с любым `--pages` идут из кэша без запросов. В логе прогона печатается активный
набор категорий, общий счётчик «всего вакансий с фильтром» (контроль против 256 на сайте)
и выход из обхода по достижении конца списка (djinni за концом отдаёт повторяющиеся страницы).

## Защита от перегрузки djinni.co

- **Случайная пауза 3–8 с** между запросами (равномерно из `[SCRAPE_DELAY_MIN_MS, SCRAPE_DELAY_MAX_MS]`) —
  разброс интервалов маскирует скрейпер под нерегулярный трафик лучше фиксированной паузы;
- экспоненциальный backoff на 429/403/5xx (10–160 с, до 5 попыток);
- честный User-Agent с указанием бота (переопределяется `SCRAPE_USER_AGENT`);
- `robots.txt` уважается: `/jobs/` разрешён, запрещённые пути не запрашиваются; `/api/jobs/<id>/?apply_stats`
  (`pnpm competition`) — не запрещён, но идёт с теми же паузами 3–8 с и backoff;
- каждый запрос логируется в RunLog (`pagesFetched`, `requestsMade`, …).

## TTL-кэш

- **Страницы списка — 1 день.** Нумерация страниц сдвигается при любых изменениях на djinni,
  поэтому инвалидация общая: либо весь список свежий, либо перескачиваем. Состояние —
  `cache/scrape/list-state.json`.
- **Детали вакансии — 7 дней** (конфигурируемо `--detail-ttl-days`). Приоритетнее признака
  «вакансия обновлена на djinni» (`updatedAtDjinni` из блока «Оновлено …»): если обновление
  новее нашей копии — перекачиваем досрочно.
- Сырой HTML сохраняется всегда (`cache/scrape/{list,detail}/`) — `pnpm parse` перечитывает
  его без повторных запросов.

## Сигналы конкуренции

Отвечает на «стоит ли подаваться» — сколько людей уже откликнулось и насколько жив рекрутер.
**Без профиля пользователя**: сравниваются вакансии между собой, а не с вашим стеком.

Два источника:

- **Detail-страница, бесплатно** — разбивка `За 30 днів` (просмотры · отклики), `Активність
  рекрутера` (4 уровня), `Відповідали …` с точным timestamp из tooltip. Заполняются обычным
  `pnpm scrape` / `pnpm parse` (по кэшу — без сети).
- **`GET /api/jobs/<id>/?apply_stats`** — публичный JSON без авторизации (то, что скрыто за
  кнопкой «Огляд кандидатів»): `total_applicants` + распределения кандидатов по опыту,
  English и зарплатным ожиданиям + топ-навыки конкурентов. Качается **только для шортлиста**
  командой `pnpm competition`, с TTL 24 ч и обычными паузами 3–8 с.

У detail-страниц сырые HTML лежат в `RawHtmlStore` (`RAW_STORE=db|fs`) и `pnpm parse`
перечитывает их без сети. У JSON-снапшотов такой схемы нет: сырой ответ сохраняется в
колонке `JobApplicantStats.rawJson`, но только как аудит-след — команды перепарсинга из
него не существует, поэтому правки нормализаторов применяются при следующем доборе из сети.

```bash
pnpm competition -- --skills React,TypeScript --window 30 --limit 25  # шортлист + добор
pnpm competition -- --job 834543                                      # карточка одной вакансии
pnpm competition -- --window 90 --limit 100 --export                   # собрать рыночную базу
pnpm competition -- --skills React --no-fetch --export                 # без сети
```

Выход: таблица с темпом откликов (`/день`), перцентилем к рынку, рекрутером и флагами
(`low-competition`, `high-competition`, `fresh`, `responsive-recruiter`, `silent-recruiter`,
`experienced-pool`, …) либо подробная карточка вакансии. Экспорт `--export` →
`cache/analysis/competition-<date>[-skills].{json,csv}` (одна строка = вакансия).

Перцентили и `opportunityScore` появляются, когда в БД ≥ 10 снапшотов (`pnpm competition`
печатает `no-baseline` и подсказку, пока данных мало). Формулы метрик и флагов —
[specs/07-competition-signals.md](specs/07-competition-signals.md).

## Извлечение навыков (четыре слоя)

1. **djinni_structured** — блок «Необхідний досвід з навичками» (навык + годы опыта);
2. **djinni_extra** — доп. навыки через запятую + свёрнутые `more_skills_exp`;
3. **description_keyword** — словарное сопоставление по тексту описания (EN/UA, границы слов);
   вносит только навыки из словаря, вес nice-to-have;
4. **llm_description** (опционально, ADR 0002) — вызывается **только** когда первые три слоя
   дали меньше `LLM_EXTRACT_THRESHOLD` навыков: ~52% detail-страниц djinni не имеют блока
   «Навыки», их требования живут в свободном тексте. LLM возвращает структурированный JSON
   (AI SDK, zod-схема), имена проходят через словарь; неизвестные — `Skill(isCanonical=false)`.

Нераспознанные имена не теряются: создаются как `Skill(isCanonical=false)`, печатаются в лог
(в конце прогона — итоговая подсказка с отчётом) и курируются командами
`pnpm skills:unresolved` / `pnpm skills:promote` (см. «Курация нераспознанных навыков»).

### LLM-слой: включение и провайдеры

Один OpenAI-совместимый фасад, переключается в `.env`:

```bash
LLM_ENABLED=1
LLM_API_KEY=<ключ>                 # Zen: https://opencode.ai/auth (есть бесплатные модели)
LLM_BASE_URL=https://opencode.ai/zen/v1   # или OpenRouter/OpenAI/Gemini-compat
LLM_MODEL=deepseek-v4-flash-free   # любая chat-completions модель провайдера
```

Локальный вариант — LM Studio: `LLM_BASE_URL=http://localhost:1234/v1`, любой непустой
`LLM_API_KEY`. Дополнительно: `LLM_EXTRACT_THRESHOLD` (default 1 — гейт «навыков < N»),
`LLM_CONCURRENCY` (3), `LLM_MAX_ATTEMPTS` (2), `LLM_TIMEOUT_MS` (60000).

Прогон по кэшу (без скрейпа, лимитирует платные вызовы):

```bash
pnpm extract:llm -- --limit 5    # smoke-тест: 5 вакансий
pnpm extract:llm                 # полный проход (вакансии-«нулевики»)
```

Стоимость: ~1–2k токенов на вакансию — пройти 250 кэшированных вакансий на бесплатной/mini-модели
— в пределах $0.01–0.5; итоговый расход токенов печатается в конце прогона.

## Два представления данных (решение 2026-10-24)

1. **Приложение (Postgres/Prisma)**: `JobPosting`, `Skill`, `JobSkillRequirement`,
   `JobApplicantStats`, `RunLog` — нормализованные данные для будущего UI и матчинга.
2. **Аналитика (файлы)**: `cache/analysis/snapshot-*.json` + long-format CSV — плоское
   представление «вакансия × навык» для статистики, pandas, кластеризации, LLM-экспериментов;
   `competition-*.json/csv` — одна строка = вакансия со всеми сигналами конкуренции.

Пользовательский профиль — НЕ в рыночной БД: привязка профиля к рынку будет отдельной
надстройкой (MatchResult и др. — specs/05).
