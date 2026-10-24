# Design — дизайн экранов SkillRadar

Папка дизайна: промпты для Google Stitch и итоговые макеты.

## Файлы

| Файл | Содержание |
|---|---|
| [ui-prompts.md](ui-prompts.md) | Техдок: общий стиль + промпты для всех экранов + варианты |

## Структура папок

Каждый экран — отдельная подпапка, внутри две:

- **`main/`** — итоговый целевой дизайн (один или несколько финальных вариантов, которые
  принимаем в работу).
- **`extra/`** — детали, альтернативные решения, референсы для рассмотрения (включая
  вариации: тёмная тема, slide-over и т.п.).

Файлы из Stitch кладёт пользователь. Пустые папки содержат `.gitkeep`.

| Экран | Папка | Промпт |
|---|---|---|
| Overview «Мой стек → пробелы» | `01-overview/` | [ui-prompts.md §1](ui-prompts.md) |
| Stack detail | `02-stack-detail/` | [ui-prompts.md §2](ui-prompts.md) |
| Technology page | `03-technology/` | [ui-prompts.md §3](ui-prompts.md) |
| Profile & skills | `04-profile/` | [ui-prompts.md §4](ui-prompts.md) |
| Vacancies feed | `05-vacancies/` | [ui-prompts.md §5](ui-prompts.md) |
| Vacancy detail | `06-vacancy-detail/` | [ui-prompts.md §6](ui-prompts.md) |

## Связи

- Логика и данные экранов: [../06-skill-gap-analysis.md](../06-skill-gap-analysis.md),
  [../05-data-model.md](../05-data-model.md).
- Функциональные требования: [../03-requirements.md](../03-requirements.md) (FR-19…25).
