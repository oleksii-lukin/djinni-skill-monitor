# 07 — Сигналы конкуренции по вакансии

## 1. Зачем

Скилл-сет и опыт — половина решения «подаваться или нет». Вторая половина — **сколько людей
уже откликнулось и насколько жив рекрутер**. Раньше проект видел только просмотры и отклики
за всё время; скрытая статистика кандидатов и активность рекрутера не собирались.

Результат этапа: по любой вакансии — абсолютные значения (сколько откликов, темп, активность
рекрутера) **и сравнение с рынком** (перцентиль среди активных вакансий с данными).
**Профиль пользователя не используется**: сравнение вакансий между собой, не с пользователем.
Матчинг и рекомендации «подходит/не подходит» — отдельный этап (specs/01, 05).

## 2. Источники (verified 2026-11-01)

| Источник | Сигналы | Цена |
|---|---|---|
| Detail-страница, `#job-publication-info` | `За 30 днів` / `За весь час`: просмотры · отклики; `Активність рекрутера`; `Відповідали …` + точный timestamp в tooltip | бесплатно, из уже скачанного HTML (`pnpm parse`) |
| `GET /api/jobs/<id>/?apply_stats` | `total_applicants`, распределения `experience_dist` / `salary_dist` / `english_dist`, `top_skills` конкурентов | 1 запрос на вакансию, с TTL |

Эндпоинт `apply_stats` — тот же, который вызывает кнопка «Огляд кандидатів»; публичный,
без авторизации. Скрыт за кнопкой только в UI. Семплы: `cache/research/applicant-stats-*.json`.

Оговорки данных: `percent` в распределениях djinni — нормировка на максимум, не доля;
суммы `experience_dist`/`salary_dist` бывают меньше `total_applicants`; `total_applicants`
со страницей `repliesCount` может расходиться (разное время снимка). Подробно —
[02-site-research.md §3.1](02-site-research.md).

## 3. Что храним

- **В `JobPosting`** (из detail-страницы): `views30d`, `replies30d`, `recruiterActivity`
  (enum VERY_HIGH/HIGH/MEDIUM/LOW/UNKNOWN), `recruiterLastResponseAt`, `recruiterResponseLabel`.
- **`JobApplicantStats`** — 1:1 с вакансией, последний снапшот `apply_stats`: скаляр
  `totalApplicants`, четыре JSON-массива как есть, `rawJson` (аудит), `fetchedAt`.
  История не хранится — только последний снимок; TTL `COMPETITION_TTL_HOURS` (default 24 ч).

Сырые данные и перепарсинг. У detail-страниц сырые HTML живут в `RawHtmlStore`
(`RAW_STORE=db|fs`) и `pnpm parse` перечитывает их без сети. У `apply_stats` такой схемы
нет: снапшот пишется напрямую в `JobApplicantStats`, а `rawJson` — **только аудит**,
команды перепарсинга из него не существует. Правки нормализаторов меток (`experienceBucket`,
`salaryRange`, `englishRank`) на уже собранных снапшотах применяются только при следующем
доборе — тогда JSON перечитывается из сети. Перепарсинг `rawJson` — отдельная задача
(~30 строк: читать колонку, гонять через `parseApplicantStats`, обновлять строки).

Схема: [05-data-model.md](05-data-model.md).

## 4. Метрики

На вакансию:

- `ageDays` — от `datePosted` (для lifetime-темпа); `lastActivityAt = max(datePosted, updatedAtDjinni)`
  — для свежести (вакансия может быть старой, но поднятой обновлением);
- `lifetimeAppsPerDay = totalApplicants / max(ageDays, 1)`;
- `recentAppsPerDay = replies30d / 30`, если есть; иначе lifetime;
- `appsPerDay` = `recentAppsPerDay ?? lifetimeAppsPerDay` — главный показатель конкуренции;
- `replyRate = replies30d / views30d`, иначе all-time;
- `pool` (из `apply_stats`): доля кандидатов с опытом 5+ лет, медианный опыт, топ English,
  медиана зарплатных ожиданий, топ-5 навыков конкурентов.

**Рынок (baseline)** — все активные вакансии с `JobApplicantStats`, а не только выборка:
медиана/p25/p75/p90 для `appsPerDay`, `totalApplicants`, `replyRate`. Перцентиль вакансии —
доля вакансий с тем же или меньшим значением. При `n < 10` перцентили и зависимые флаги
выключаются (печается `no-baseline`) — сравнение с маленькой выборкой врёт.

## 5. Флаги

| Флаг | Условие |
|---|---|
| `low-competition` | `appsPerDay` ≤ p25 и вакансии ≥ 3 дней |
| `high-competition` | `appsPerDay` ≥ p75 |
| `high-interest` | `replyRate` ≥ p75 и ≥ 3 откликов за 30 дней |
| `fresh` | `lastActivityAt` ≤ 3 дней |
| `stale-listing` | `lastActivityAt` > 21 дня |
| `responsive-recruiter` | активность HIGH/VERY_HIGH **или** ответ ≤ 7 дней |
| `silent-recruiter` | активность LOW **или** ответ > 30 дней, и не responsive |
| `experienced-pool` | ≥ 50% откликнувшихся с опытом 5+ лет (при n ≥ 5) |
| `zero-applicants` | откликнувшихся 0 |
| `no-apply-stats` | снапшота `apply_stats` нет, но detail-страница сигналы даёт (сравнение — только по ним) |
| `no-data` | нет ни `apply_stats`, ни просмотров/откликов на detail-странице |
| `stats-stale` | снапшот старше 2×TTL |

`responsive-recruiter` имеет приоритет над `silent-recruiter`: быстрый ответ важнее общей
активности («низкая активность + ответил 3 дня назад» = responsive).

`opportunityScore` — «легче/выгоднее податься», **не** «подходит по стеку»:

```
0.40 * (1 - competitionPercentile)
+ 0.25 * freshness          # clamp01(1 - дней_с_обновления / 30)
+ 0.20 * recruiterScore     # VERY_HIGH 1, HIGH .75, MEDIUM .5, LOW .25, UNKNOWN .5
+ 0.15 * (1 - volumePercentile)
```

При `n < 10` score не считается (null).

## 6. Команда

```bash
pnpm competition -- --skills React,TypeScript --window 30 --limit 25  # шортлист + добор
pnpm competition -- --job 834543                                      # карточка одной вакансии
pnpm competition -- --window 90 --limit 100 --export                   # сбор рыночной базы
pnpm competition -- --skills React --no-fetch --export                 # только из БД, без сети
```

Флаги: `--job <ids>`, `--skills <names>` (OR, как в `stats`), `--category <djinni>`,
`--window <дней>` (default 30), `--limit <n>` (default 20, max 500 — прогон на ~50 вакансий
≈ 4–5 мин при паузе 3–8 с), `--ttl-hours <n>` (default 24), `--force`, `--no-fetch`,
`--dry-run`, `--export`, `--sort opportunity|competition|fresh|applicants`.

Выборка «актуальных»: `status = ACTIVE` и (`datePosted >= since` **или** `updatedAtDjinni >= since`)
— иначе вакансии, поднятые обновлением, выпадают из окна из-за старой даты публикации.

Выход: таблица (`#`, вакансия, обновлена, отклики, за 30 дн., /день, перцентиль, рекрутер, флаги)
или карточка вакансии при одиночном `--job`. Экспорт `--export`:
`cache/analysis/competition-<date>[-skills].{json,csv}` — CSV: одна строка = вакансия.

Сбор `apply_stats` — только для устаревших/отсутствующих снапшотов шортлиста, с TTL; общие
паузы 3–8 с и backoff на 429/403/5xx — как у скрейпа.

## 7. Ограничения

- **Снапшот, не история**: тренд «отклики растут» недоступен — только последний снимок.
- **Без профиля**: «выгодно податься» = мало конкурентов + свежая + живой рекрутер.
  Совпадение со стеком/опытом — следующий этап.
- **Baseline мал на старте**: перцентили появляются после ~10 доборов; до этого печается
  `no-baseline` и только абсолютные значения.
- **Сравнение глобальное**: нет среза по категории/уровню опыта — разные ниши сравниваются
  между собой. При необходимости — `--baseline category` отдельным шагом.
- **`total_applicants` vs `repliesCount`**: возможен расхождение из-за времени снимка
  или перевыпуска вакансии; показываем оба и не смешиваем.
- **Сигналы detail-страницы стареют вместе с TTL деталей (7 дней)**: `replies30d`,
  активность и ответ рекрутера обновляет `pnpm scrape`/`pnpm parse`. Свежий `apply_stats`
  не освежает их — в карточке показывается `detail-кэш`, чтобы это было видно.
- **404 на `apply_stats`**: вакансия без статистики не помечается EXPIRED (семантика
  эндпоинта не документирована) — пропускается с пометкой в логе.

## 8. Что дальше (вне скоупа этапа)

- Профиль пользователя и матчинг (specs/01 FR-9–12, 05 Profile/MatchResult).
- История снапшотов → тренды конкуренции.
- `pnpm competition:reparse` — пересчёт метрик из колонки `rawJson` без сети (сейчас
  `rawJson` только аудит; см. §3 и ADR 0004).
- Срез baseline по категории/уровню/бренду компании.
- Публикация сигналов в вебе/боте (specs/04).
