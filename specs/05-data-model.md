# 05 — Модель данных (draft, Prisma-ориентированная)

Сущности и связи на этапе проектирования. Имена таблиц/полей — английские; конкретные
типы (Prisma) будут уточнены при реализации. Все пользовательские сущности содержат `userId`
(фаза 1 — один пользователь, но поле присутствует сразу).

> **Имплементация F1 (2026-10-24)**: в БД реализовано рыночное подмножество —
> `JobPosting`, `Skill`, `JobSkillRequirement`, `RunLog` — **без `userId`** (профильная
> надстройка отдельная система, см. `specs/implementation/0001-market-pipeline.md`).
> `Skill.aliases` — Postgres массив строк; `Skill.category` — enum; `SkillSource` — enum
> (`DJINNI_STRUCTURED` / `DJINNI_EXTRA` / `DESCRIPTION_KEYWORD` / `LLM_DESCRIPTION` —
> добавлено ADR 0002). `SkillPairStat`,
> `SkillCategoryBaseline`, `StackCombo` — агрегаты, в F1 не создаются: считаются on-the-fly
> (`pnpm stats`) и экспортируются снапшотами.

## Сущности

### User
- `id`, `telegramChatId`, `telegramUsername`, `contacts` (JSON/text — TBD фаза 5)
- `createdAt`, `updatedAt`

### Profile (профиль пользователя)
- `userId` (→ User)
- `desiredDirections` (JSON: направления, напр. «Java Backend», «React Frontend»)
- `experienceYears` (число), `englishLevel` (enum A1–C1)
- `workFormat` (enum: remote/hybrid/office) — предпочтения
- `updatedAt`

### ProfileSkill
- `profileId` (→ Profile), `skillId` (→ Skill)
- `level` (enum: aware/familiar/proficient/advanced — TBD)
- `years` (опыт с навыком, optional)
- уникальность: (profileId, skillId)

### JobPosting (одна вакансия)
- `id` (числовой id Djinni, уникальный), `slug`, `url`
- `title`, `company`, `companyUrl`, `logoUrl`
- `category` (Djinni category: Architect, QA…), `industry`
- `description` (полный текст), `descriptionRaw` (HTML — опционально)
- `datePosted`, `validThrough`, `updatedAtOnDjinni` (если есть)
- `employmentType`, `workFormat` (remote/hybrid/office), `location`, `countries`
- `experienceRequiredYears` (из структурированного блока / JSON-LD)
- `englishLevel` (enum), `salaryTier` (enum $–$$$$), `salaryMin`, `salaryMax`, `salaryCurrency`
  (из `baseSalary`, если есть)
- `viewsCount`, `repliesCount`, `replies30d` (опционально)
- `rawHtmlPath` (путь к сырому HTML — опционально)
- `parsedAt`, `normalizedAt` (LLM-нормализация выполнена)
- `status` (enum: active/expired)

### JobSkillRequirement (навык вакансии)
- `jobId` (→ JobPosting), `skillId` (→ Skill)
- `yearsRequired` (optional), `isRequired` (must-have vs nice-to-have)
- уникальность: (jobId, skillId)

### Skill (таксономия)
- `id`, `name` (canonical, напр. «Spring Boot»), `aliases` (JSON: варианты написания)
- `category` (enum: language/framework/database/cloud/devops/tool/domain… — TBD)
- `createdAt`, `updatedAt`

### SkillAggregate (предвычисленная карта навыков)
- `skillId` (→ Skill), `direction` (категория/фильтр, напр. «java-backend»)
- `period` (месяц/неделя — TBD), `jobCount`, `share` (доля вакансий)
- `avgExperienceYears`, `experienceHistogram` (JSON)
- `englishLevelHistogram` (JSON), `workFormatHistogram` (JSON)
- уникальность: (skillId, direction, period)

### MatchResult (матчинг вакансия ↔ профиль)
- `jobId` (→ JobPosting), `profileId` (→ Profile)
- `score` (число 0–1), `verdict` (enum: fit/almost_fit/no_fit)
- `missingSkills` (JSON: список skillId + оценка «быстро освоить» — TBD)
- `reasoning` (текст обоснования, опционально)
- `computedAt`

### Notification
- `userId`, `jobId`, `matchResultId`, `channel` (enum: telegram), `sentAt`, `status`
- для дедупликации: уникальность (userId, jobId)

### RunLog (лог сбора/анализа)
- `id`, `startedAt`, `finishedAt`, `type` (enum: ingest/normalize/aggregate/match)
- `pagesFetched`, `jobsNew`, `jobsUpdated`, `jobsExpired`, `llmCalls`, `llmTokens`
- `status` (enum: ok/error), `error` (текст, опционально)

### ApiKey (BYOK)
- `userId` (→ User), `provider` (TBD), `keyEncrypted` (зашифрованное значение), `keyHint`
  (для отображения, напр. «sk-…abc»), `createdAt`, `lastUsedAt`

### SkillPairStat (пары навыков, основа share/lift)
- `skillAId`, `skillBId` (→ Skill), `window` (enum: 7d/30d/90d)
- `jobCountBoth`, `jobCountA` (вакансии с обоими / с A), `shareAtoB` (= P(B|A))
- `lift` (сравнение с baseline), `weightMust`, `weightNice` (суммарные веса)
- уникальность: (skillAId, skillBId, window)

### SkillCategoryBaseline (baseline-частоты для lift)
- `skillId` (→ Skill), `window`, `shareGlobal` (P(X) в окне), `jobCount`
- уникальность: (skillId, window)

### StackCombo (найденная комбинация, кандидат)
- `skillIds` (JSON: список skillId), `metrics` (share, lift, count, avgExperience, salaryTier)
- `gapTemplate` (JSON: типовой gap), `version`, `computedAt`
- полезен для кэша/ML; в MVP может считаться on-the-fly (TBD)

### Technology (каталог технологий)
- `id`, `slug`, `name`, `category` (→ таксономия Skill), `description`
- `levels` (JSON: junior/middle/senior — что учить)
- `externalLinks` (JSON: roadmap.sh, official docs — только ссылки)

### TechnologyResource (ресурсы технологии)
- `technologyId` (→ Technology), `type` (enum: roadmap/official-docs/repo/course/article),
  `url`, `title`, `level` (optional)

### UserStack / SavedView (сохранённая выборка)
- `userId` (→ User), `name`, `skillIds` (JSON), `window` (7d/30d/90d),
  `weights` (must/nice), `supportThreshold`, `updatedAt`

## Связи (сводка)

```
User 1─n Profile 1─n ProfileSkill n─1 Skill
User 1─n ApiKey
User 1─n Notification n─1 JobPosting
User 1─n UserStack n─1 Skill
JobPosting 1─n JobSkillRequirement n─1 Skill
JobPosting 1─n MatchResult n─1 Profile
Skill 1─n SkillAggregate
Skill 1─n SkillPairStat (skillA/skillB)
Technology 1─n TechnologyResource
```

## TBD

- Точная таксономия Skill (категории, canonical имена).
- Формат `missingSkills` и критерий «быстро освоить» (TBD в 03-requirements FR-12).
- `period` для агрегатов и стратегия пересчёта.
- Формат `contacts` (фаза 5).
- Режим шифрования ApiKey.
- `SkillPairStat`: считать на лету vs предвычислять; как обрабатывать малые окна (7d).
- `Technology.levels`: точный формат уровней и полей.
- Кэш roadmap.sh в личном режиме (лицензия — personal use only).
- Версионирование кластеров (фаза 2, ML-слой).
