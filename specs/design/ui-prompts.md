# UI-промпты для Google Stitch

Техдок: готовые промпты для генерации дизайнов экранов SkillRadar.
Принадлежность: продукт — SkillRadar (см. [../06-skill-gap-analysis.md](../06-skill-gap-analysis.md)).

## Как пользоваться

1. В [Google Stitch](https://stitch.withgoogle.com/) создать проект типа **Web**.
2. Один экран — один промпт: скопировать блок → вставить → сгенерировать.
3. Вариации генерировать через функцию вариаций в Stitch, меняя тему/лейблы (см. §Варианты).
4. Итоговые файлы из Stitch положить в папку экрана:
   - `main/` — итоговый целевой дизайн (один или несколько финальных вариантов);
   - `extra/` — детали, альтернативные решения, референсы.
5. Дизайны и спеки согласованы с FR-19…25 (`03-requirements.md`).

## Общий стиль (добавлять в начало каждого промпта)

```
Shared style:
- Product: SkillRadar — job-market intelligence dashboard for software engineers, powered by djinni.co vacancy data.
- Desktop web app, 1440×900, light theme.
- Aesthetic: modern developer tool — clean, calm, information-dense but airy (inspired by Linear, Vercel, PostHog).
- Typography: Inter. Headings semibold; numbers use tabular figures.
- Colors: app background #FAFAF9; cards #FFFFFF with 1px #E7E5E4 border, 12px radius, subtle shadow; text #1C1917 primary / #78716C secondary; accent indigo #4F46E5; success #16A34A; warning #D97706; danger #DC2626.
- Charts: flat horizontal bars with percentage labels; no 3D, no gradients.
- Layout: 240px left sidebar, 64px top bar, 24px gutters, 12-column content grid.
- Use realistic sample data, no lorem ipsum.
- Accessible: WCAG AA contrast, visible focus states.
```

## Промпт 1 — Overview «Мой стек → пробелы» (папка `01-overview/`)

```
Design the main overview screen of SkillRadar.
Left sidebar (240px): logo "SkillRadar"; nav items Overview (active, indigo highlight), Vacancies, Technologies, Profile, Settings; at the bottom a small Telegram connection status card ("Telegram connected · daily digest").
Top bar: page title "Skill gaps", subtitle "djinni.co · last 30 days · 6,214 vacancies analyzed"; a segmented control 7d | 30d | 90d with 30d selected; a refresh icon button; user avatar.
Content, two columns: main area (8 cols) and right rail (4 cols).
Pinned card at the top of the main area: "My skill set" with chips React, TypeScript, C#, a "+ Add skill" ghost chip and a small "Edit profile" link.
Main area, one section per user skill — show the section for "React": headline "React", subtitle "1,840 vacancies · 29% of market", green trend badge "+4% vs previous 30 days".
Under it, a horizontal row of 3 combo cards:
1. "React + NestJS + PostgreSQL + AWS" — 18% of React jobs, 331 vacancies, avg 3.4 yrs, salary tier $$$; a small fit ring "2/4 skills" and amber text "You're missing: NestJS, AWS".
2. "React + TypeScript + Next.js" — 15%, 276 vacancies, label "frontend-only", fit "3/4", missing "Next.js".
3. "React + .NET / C#" — 6%, 110 vacancies, fit "1/4", missing "C#, .NET, SQL Server".
Below the combos, a 2×2 grid of category panels with flat horizontal bar charts and percentages:
- Backend frameworks: NestJS 31%, Express 22%, .NET 15%, Django 6%, Laravel 5%
- Databases: PostgreSQL 44%, MongoDB 19%, MySQL 12%, Redis 9%
- Cloud & CI/CD: Docker 52%, AWS 38%, GitHub Actions 27%, Kubernetes 18%, GCP 11%
- Auth & services: JWT 33%, Stripe 12%, Auth0 8%, Keycloak 6%, Firebase 5%
Right rail: card "Your top gaps" — ranked list with percentages: NestJS 31% (badge "quick to learn"), PostgreSQL 24%, AWS 22%, Next.js 15%; a "See all gaps" button. Below it a secondary card "Recommended next stack" highlighting one combo.
Interactions: hover states on combo cards and bars; clicking a combo navigates to stack detail; clicking a category bar filters vacancies.
```

## Промпт 2 — Stack detail (папка `02-stack-detail/`)

```
Design the stack detail screen of SkillRadar for the stack "React + NestJS + PostgreSQL + AWS".
Breadcrumb: Overview / React / React + NestJS + PostgreSQL + AWS.
Header block: the four skill chips as the title; a metrics row with 331 vacancies, 18% of React jobs, avg experience 3.4 yrs, salary tier $$$, green trend "+2%".
Below the header, a "Your fit" card: circular progress showing 50% ("2 of 4 skills"), green check chips for React and TypeScript, amber chips for missing NestJS and AWS with "learn in ~6–8 weeks" labels; primary CTA "See vacancies you'd qualify for".
Tabs: Vacancies (active) | Skills breakdown | Companies.
Vacancy list: filter bar (work format, experience, English, salary, sort by newest) and 8 compact rows. Each row: job title, company name and logo, "2 days ago", salary ("$$$" or "$3,000–4,500"), small skill chips with green check for matched skills and amber plus for missing ones, English level, location, and a secondary "Open on djinni ↗" button.
Right rail: card "Related stacks" with 3 mini-cards (React + Express + MongoDB 9%, React + NestJS + GraphQL 4%, React + Vue + Django 2%); below, card "Top companies hiring" with 5 company rows and vacancy counts.
Interactions: hovering a row highlights it; clicking a row opens a slide-over panel with vacancy details; matched/missing skill chips are visually distinct.
```

## Промпт 3 — Technology page (NestJS) (папка `03-technology/`)

```
Design the technology detail screen of SkillRadar for "NestJS".
Breadcrumb: Technologies / Backend frameworks / NestJS.
Header: technology logo placeholder, name "NestJS", category chip "Backend framework", two-line description; stats row: 412 vacancies in 30 days, green trend "+12%", avg experience 3.1 yrs, median salary tier $$$.
Section "Learning path by level": three equal columns Junior / Middle / Senior. Each column is a card with: a one-line focus ("Build CRUD APIs with modules and DI"), a bullet list of 4–6 topics, typical stack chips, and estimated time. Junior example topics: modules, controllers, providers, validation pipes; Middle: guards, interceptors, TypeORM/Prisma, testing; Senior: microservices, CQRS, performance, architecture.
Section "Popular combinations with NestJS": two flat horizontal bar lists — "Frontend" (React 41%, Angular 18%, Vue 9%) and "Data & infra" (PostgreSQL 38%, MongoDB 22%, Redis 17%, Docker 45%).
Section "Where to learn": 3 link-out cards with external-link icons — "roadmap.sh · NestJS roadmap", "Official documentation · docs.nestjs.com", "GitHub · nestjs/nest". Small caption "Links open in a new tab".
Section "Latest vacancies with NestJS": 5 compact rows (title, company, date, salary tier, "Open on djinni ↗").
Interactions: collapsible learning-path columns; clicking a combination bar filters vacancies below; link cards show hover elevation.
```

## Промпт 4 — Profile & skills (папка `04-profile/`)

```
Design the profile and skills screen of SkillRadar.
Two-column layout: form on the left (7 cols), sticky "Market fit" preview card on the right (5 cols).
Left column, card "Your skills": rows for React (level segmented control Middle selected, years 3), TypeScript (Middle, 3), C# (Junior, 1); each row has a remove icon; below, an "Add skill" input with autocomplete dropdown showing suggestions with market context (e.g. "NestJS — required in 31% of React jobs", "PostgreSQL — 24%"). A muted hint: "Skills are used only for your personal gap analysis."
Card "Preferences": desired directions as multi-select chips (Full-stack selected, Frontend, Backend, DevOps), English level select (B2 selected), work format (Remote selected), optional salary expectation input.
Card "Integrations": Telegram row — green dot, "@username", toggle on, "Send daily digest at 09:00"; BYOK API keys row — provider select (OpenAI / Anthropic / Google), masked key "sk-…7f2a", "Test connection" secondary button, caption "Keys are encrypted and used only for your analysis. You pay your provider directly."
Right column sticky card "Market fit": a big score "72% match with 1,840 React vacancies", three mini stats (skills covered 12/16, top gap NestJS, trend +4%); a short list of 3 recommended skills with percentages; CTA "Open skill gaps".
Bottom sticky save bar: "You have unsaved changes" text, Discard and Save buttons.
Interactions: skill rows expand when editing; suggestions show market percentages; connection test shows inline success/error state.
```

## Промпт 5 — Vacancies feed (папка `05-vacancies/`)

```
Design the vacancy feed screen of SkillRadar.
Top bar: title "Vacancies for you", subtitle "Updated 12 min ago · 6,214 vacancies analyzed"; segmented filters: All | Fits | Almost fits (Almost fits selected); secondary filters for window, direction, work format.
Two-column layout: vacancy list (8 cols) and right rail (4 cols).
List items are cards, each with: job title, company and logo, posted date, salary ("$$$" or "$3,000–5,500"), tags (Remote, B2 English, 3+ yrs), and on the right a fit badge — green "92% fit" for matching jobs, amber "Almost · missing 1 skill" for close ones with the missing skill as a small chip ("NestJS · quick to learn"). Each card has secondary actions "Open on djinni ↗", a bookmark icon and a dismiss icon.
Show 6 cards, a mix: 2 green fits, 4 almost-fits with different missing skills.
Right rail: card "Notification settings" — Telegram toggle on, digest frequency select (Daily), time picker 09:00, "Send only almost-fit alerts" checkbox unchecked; card "Saved searches" with 2 items ("React + NestJS · 30 days", "C# fullstack · 7 days"); card "Why these matches?" with a short explanation and a "Tune matching" link.
Interactions: hovering a card lifts it slightly; clicking the fit badge opens a popover with matched/missing skills breakdown; dismiss animates the card out.
```

## Промпт 6 — Vacancy detail (папка `06-vacancy-detail/`)

```
Design the vacancy detail screen of SkillRadar for one job posting.
Breadcrumb: Vacancies / Senior Full-Stack Engineer (React / NestJS).
Header: job title "Senior Full-Stack Engineer (React / NestJS)"; company logo and name "TechFlow" with a small verified badge; meta line "Remote · Ukraine, EU · Posted 2 days ago · 156 views · 11 replies"; salary "$$$ · $4,000–5,500". Primary button "Open on djinni ↗"; secondary icon buttons: bookmark, dismiss, copy link.
Fit summary card directly under the header: large circular progress "87% fit"; inside, three columns — "You match" with green chips React, TypeScript, PostgreSQL, Docker; "Missing" with amber chips NestJS ("quick to learn · ~2 weeks") and AWS ("~4 weeks"); "Why this fits" with a one-line explanation. Secondary button "See gap analysis".
Tabs: Overview (active) | Match analysis | Company.
Overview tab, two columns: job description (8 cols) and a sticky sidebar (4 cols).
Description: rendered posting with clear headings "About the role", "Responsibilities", "Requirements", "Nice to have", "What we offer"; readable line length; bullet lists; subtle dividers.
Sticky sidebar cards:
1. "Requirements" — structured rows: experience "3+ years" with a small progress bar, English B2, employment Full-time, domain Fintech; a small table of skills with required years: React 3 yrs, TypeScript 2 yrs, NestJS 2 yrs, PostgreSQL 3 yrs; additional skills as chips: AWS, Docker, Redis, GitHub Actions.
2. "Company" — logo, name, short description, link "View company".
3. "Similar vacancies" — 3 compact rows with match badges (94%, 81%, 76%) and salary tiers.
Preview of "Match analysis" tab content: side-by-side comparison of your profile vs requirements — matched skills with green checks, missing skills with amber plus and estimated learning time each.
Interactions: a sticky "Apply on djinni" bar appears at the bottom while scrolling; hovering a missing-skill chip shows a tooltip linking to the technology learning page; clicking "See gap analysis" opens a slide-over panel; bookmark/dismiss update state instantly.
```

### Вариант slide-over вместо страницы (тоже в `extra/`)

```
Instead of a full page, design a right-side slide-over panel (640px wide) over a dimmed vacancy feed. Same content structure: header with title, company, fit summary, tabs, description and requirements; sticky footer with "Open on djinni" and "Save".
```

## Варианты (модификаторы стиль-блока)

- **Тёмная тема**: заменить в shared style `light theme` → `dark theme`,
  палитру на `#0C0A09` фон / `#1C1917` карточки / `#292524` границы / `#FAFAF9` текст.
- **Русские лейблы**: добавить в промпт строку `All UI copy in Russian.`
- **Мобильный Telegram-дайджест**: отдельный промпт (не готов) — mobile-формат, уведомление
  о вакансии с fit и missing skills.

## Статус экранов

| Экран | Папка | Промпт | Дизайн |
|---|---|---|---|
| Overview «Мой стек → пробелы» | `01-overview/` | готов | ожидает |
| Stack detail | `02-stack-detail/` | готов | ожидает |
| Technology page | `03-technology/` | готов | ожидает |
| Profile & skills | `04-profile/` | готов | ожидает |
| Vacancies feed | `05-vacancies/` | готов | ожидает |
| Vacancy detail (+slide-over) | `06-vacancy-detail/` | готов | ожидает |
| Telegram-дайджест (mobile) | — | TBD | — |
