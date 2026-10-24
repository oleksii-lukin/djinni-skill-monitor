// Seed-таксономия навыков: canonical-имя + алиасы (EN/UA-формы djinni) + категория.
// Курационный словарь: точные именаdjinni из cache/research + распространённые стеки.
// Нераспознанные имена создаются в БД как Skill(isCanonical=false) и попадают в
// отчёт `stats:unresolved` для ручного пополнения словаря.
import type { SkillCategory } from "@prisma/client";

export interface SkillDictEntry {
  name: string; // canonical
  category: SkillCategory;
  aliases: string[];
}

export const SKILL_DICTIONARY: SkillDictEntry[] = [
  // Языки
  { name: "JavaScript", category: "LANGUAGE", aliases: ["JS", "ECMAScript", "Java Script"] },
  { name: "TypeScript", category: "LANGUAGE", aliases: ["TS"] },
  { name: "Python", category: "LANGUAGE", aliases: ["Python 3", "Python3"] },
  { name: "Java", category: "LANGUAGE", aliases: ["Java SE", "Java 17", "Java 21"] },
  { name: "C#", category: "LANGUAGE", aliases: ["CSharp", "C sharp", "C#/.NET"] },
  { name: "C++", category: "LANGUAGE", aliases: ["CPP", "C plus plus"] },
  { name: "C", category: "LANGUAGE", aliases: [] },
  { name: "Go", category: "LANGUAGE", aliases: ["Golang"] },
  { name: "Kotlin", category: "LANGUAGE", aliases: ["Kotlin/JVM"] },
  { name: "Swift", category: "LANGUAGE", aliases: [] },
  { name: "PHP", category: "LANGUAGE", aliases: ["PHP 8", "PHP8"] },
  { name: "Ruby", category: "LANGUAGE", aliases: [] },
  { name: "Rust", category: "LANGUAGE", aliases: ["Rustlang"] },
  { name: "Dart", category: "LANGUAGE", aliases: [] },
  { name: "Scala", category: "LANGUAGE", aliases: [] },
  { name: "Elixir", category: "LANGUAGE", aliases: [] },
  { name: "Erlang", category: "LANGUAGE", aliases: [] },
  { name: "Groovy", category: "LANGUAGE", aliases: [] },
  { name: "SQL", category: "LANGUAGE", aliases: ["SQL початковий рівень", "T-SQL"] },
  { name: "HTML", category: "FRONTEND", aliases: ["HTML5"] },
  { name: "CSS", category: "FRONTEND", aliases: ["CSS3", "SASS", "SCSS", "LESS", "Tailwind CSS", "Tailwind", "TailwindCSS"] },

  // Frontend
  { name: "React", category: "FRONTEND", aliases: ["ReactJS", "React.js", "React JS"] },
  { name: "Next.js", category: "FRONTEND", aliases: ["NextJS", "Next", "Next JS"] },
  { name: "Vue.js", category: "FRONTEND", aliases: ["Vue", "VueJS", "Vue JS"] },
  { name: "Nuxt.js", category: "FRONTEND", aliases: ["Nuxt", "NuxtJS"] },
  { name: "Angular", category: "FRONTEND", aliases: ["Angular 2", "Angular2"] },
  { name: "AngularJS", category: "FRONTEND", aliases: ["Angular 1"] },
  { name: "Svelte", category: "FRONTEND", aliases: ["SvelteKit"] },
  { name: "Redux", category: "FRONTEND", aliases: ["Redux Toolkit", "RTK"] },
  { name: "React Native", category: "FRONTEND", aliases: ["RN"] },
  { name: "Flutter", category: "FRONTEND", aliases: [] },
  { name: "jQuery", category: "FRONTEND", aliases: ["JQuery"] },
  { name: "Webpack", category: "FRONTEND", aliases: [] },
  { name: "Vite", category: "FRONTEND", aliases: [] },
  { name: "GraphQL", category: "CONCEPT", aliases: ["Apollo GraphQL", "Apollo Client", "Apollo Server"] },
  { name: "REST API", category: "CONCEPT", aliases: ["REST", "RESTful", "REST APIs", "REST-сервіси", "Розробка API"] },
  { name: "gRPC", category: "CONCEPT", aliases: ["GRPC"] },
  { name: "WebSocket", category: "CONCEPT", aliases: ["WebSockets", "Socket.IO", "SocketIO"] },

  // Backend
  { name: "Node.js", category: "BACKEND", aliases: ["NodeJS", "Node", "Node JS"] },
  { name: "NestJS", category: "BACKEND", aliases: ["Nest", "Nest JS"] },
  { name: "Express", category: "BACKEND", aliases: ["Express.js", "ExpressJS"] },
  { name: "Spring", category: "BACKEND", aliases: ["Spring Framework"] },
  { name: "Spring Boot", category: "BACKEND", aliases: ["SpringBoot", "Springboot"] },
  { name: "Hibernate", category: "BACKEND", aliases: [] },
  { name: "Django", category: "BACKEND", aliases: ["Django REST Framework", "DRF"] },
  { name: "Flask", category: "BACKEND", aliases: [] },
  { name: "FastAPI", category: "BACKEND", aliases: ["Fast API"] },
  { name: "Laravel", category: "BACKEND", aliases: [] },
  { name: "Symfony", category: "BACKEND", aliases: [] },
  { name: ".NET", category: "BACKEND", aliases: [".NET Core", ".NET 8", "DotNet", "ASP.NET", "ASP.NET Core", "ASP.NET MVC"] },
  { name: "Ruby on Rails", category: "BACKEND", aliases: ["Rails", "RoR"] },
  { name: "Phoenix", category: "BACKEND", aliases: ["Phoenix Framework"] },
  { name: "Micronaut", category: "BACKEND", aliases: [] },
  { name: "Quarkus", category: "BACKEND", aliases: [] },
  { name: "Kafka", category: "BACKEND", aliases: ["Apache Kafka"] },
  { name: "RabbitMQ", category: "BACKEND", aliases: [] },
  { name: "Celery", category: "BACKEND", aliases: [] },
  { name: "Microservices", category: "CONCEPT", aliases: ["Microservices Architecture", "Мікросервіси", "Мікросервісна архітектура"] },
  { name: "Domain Driven Design", category: "CONCEPT", aliases: ["DDD", "Domain-Driven Design"] },
  { name: "CQRS", category: "CONCEPT", aliases: [] },
  { name: "Event Driven Architecture", category: "CONCEPT", aliases: ["EDA", "Event-Driven"] },

  // Database
  { name: "PostgreSQL", category: "DATABASE", aliases: ["Postgres", "PostgresSQL", "PG"] },
  { name: "MySQL", category: "DATABASE", aliases: ["MySQL 8"] },
  { name: "MongoDB", category: "DATABASE", aliases: ["Mongo", "MongoDB Atlas"] },
  { name: "Redis", category: "DATABASE", aliases: ["Redis Cache"] },
  { name: "MS SQL", category: "DATABASE", aliases: ["MSSQL", "Microsoft SQL Server", "SQL Server"] },
  { name: "Oracle", category: "DATABASE", aliases: ["Oracle DB", "Oracle Database"] },
  { name: "Elasticsearch", category: "DATABASE", aliases: ["Elastic", "Elastic Stack", "ELK"] },
  { name: "Cassandra", category: "DATABASE", aliases: [] },
  { name: "DynamoDB", category: "DATABASE", aliases: ["Amazon DynamoDB"] },
  { name: "ClickHouse", category: "DATABASE", aliases: [] },
  { name: "Firestore", category: "DATABASE", aliases: ["Firebase Firestore"] },
  { name: "SQLite", category: "DATABASE", aliases: [] },
  { name: "Liquibase", category: "DATABASE", aliases: [] },
  { name: "Flyway", category: "DATABASE", aliases: [] },

  // Cloud
  { name: "AWS", category: "CLOUD", aliases: ["Amazon Web Services", "Amazon AWS"] },
  { name: "GCP", category: "CLOUD", aliases: ["Google Cloud", "Google Cloud Platform", "Google Cloud Platform (GCP)"] },
  { name: "Azure", category: "CLOUD", aliases: ["Microsoft Azure"] },
  { name: "DigitalOcean", category: "CLOUD", aliases: ["Digital Ocean"] },
  { name: "Heroku", category: "CLOUD", aliases: [] },
  { name: "Vercel", category: "CLOUD", aliases: [] },
  { name: "Lambda", category: "CLOUD", aliases: ["AWS Lambda"] },

  // DevOps
  { name: "Docker", category: "DEVOPS", aliases: ["Docker Compose", "Dockerfile"] },
  { name: "Kubernetes", category: "DEVOPS", aliases: ["K8S", "K8s"] },
  { name: "Terraform", category: "DEVOPS", aliases: [] },
  { name: "Ansible", category: "DEVOPS", aliases: [] },
  { name: "Jenkins", category: "DEVOPS", aliases: [] },
  { name: "GitLab CI", category: "DEVOPS", aliases: ["GitLab CI/CD", "GitLab Pipelines", "GitLab"] },
  { name: "GitHub Actions", category: "DEVOPS", aliases: ["Github Actions", "GitHub CI"] },
  { name: "CircleCI", category: "DEVOPS", aliases: [] },
  { name: "ArgoCD", category: "DEVOPS", aliases: ["Argo CD"] },
  { name: "Prometheus", category: "DEVOPS", aliases: [] },
  { name: "Grafana", category: "DEVOPS", aliases: [] },
  { name: "Nginx", category: "DEVOPS", aliases: ["NGINX", "Nginx Ingress"] },
  { name: "Helm", category: "DEVOPS", aliases: [] },
  { name: "CI/CD", category: "DEVOPS", aliases: ["CI CD", "Continuous Integration", "Continious Delivery", "Continious Integration", "Налаштування CI/CD", "Побудова CI/CD"] },
  { name: "Linux", category: "DEVOPS", aliases: ["Ubuntu", "Debian", "CentOS", "RHEL"] },
  { name: "Git", category: "TOOL", aliases: ["GitFlow", "Github", "Bitbucket"] },

  // Testing
  { name: "JUnit", category: "TESTING", aliases: [] },
  { name: "TestNG", category: "TESTING", aliases: [] },
  { name: "pytest", category: "TESTING", aliases: ["PyTest", "py.test"] },
  { name: "Jest", category: "TESTING", aliases: [] },
  { name: "Cypress", category: "TESTING", aliases: [] },
  { name: "Playwright", category: "TESTING", aliases: ["Microsoft Playwright"] },
  { name: "Selenium", category: "TESTING", aliases: ["Selenium WebDriver"] },
  { name: "REST Assured", category: "TESTING", aliases: ["RestAssured"] },
  { name: "Postman", category: "TESTING", aliases: [] },
  { name: "JMeter", category: "TESTING", aliases: ["Apache JMeter"] },
  { name: "xUnit", category: "TESTING", aliases: ["NUnit", "MSTest"] },
  { name: "Appium", category: "TESTING", aliases: [] },
  { name: "Allure", category: "TESTING", aliases: ["Allure Report", "Allure Reports"] },

  // AI/ML
  { name: "OpenAI", category: "TOOL", aliases: ["OpenAI API", "ChatGPT API", "GPT-4", "GPT-4o", "LLM OpenAI"] },
  { name: "LangChain", category: "TOOL", aliases: [] },
  { name: "LangGraph", category: "TOOL", aliases: [] },
  { name: "Pinecone", category: "DATABASE", aliases: [] },
  { name: "RAG", category: "CONCEPT", aliases: ["Retrieval Augmented Generation", "Retrieval-Augmented Generation"] },
  { name: "Machine Learning", category: "CONCEPT", aliases: ["ML", "Машинне навчання"] },
  { name: "Deep Learning", category: "CONCEPT", aliases: ["DL"] },
  { name: "PyTorch", category: "TOOL", aliases: ["Torch"] },
  { name: "TensorFlow", category: "TOOL", aliases: [] },
  { name: "Hugging Face", category: "TOOL", aliases: ["HuggingFace", "HF"] },
  { name: "AI Agents", category: "CONCEPT", aliases: ["Agentic AI", "AI-агенти", "AI Agent", "Agent Systems", "Agentic Systems"] },
  { name: "Prompt Engineering", category: "CONCEPT", aliases: ["Prompts", "Промпт-інжиніринг"] },
  { name: "Vector Databases", category: "DATABASE", aliases: ["Векторні бази даних", "Vector DB"] },

  // Auth & services
  { name: "JWT", category: "CONCEPT", aliases: [] },
  { name: "OAuth", category: "CONCEPT", aliases: ["OAuth2", "OAuth 2.0"] },
  { name: "Keycloak", category: "TOOL", aliases: [] },
  { name: "Auth0", category: "TOOL", aliases: [] },
  { name: "Stripe", category: "TOOL", aliases: [] },
  { name: "Firebase", category: "CLOUD", aliases: ["Firebase Auth"] },
  { name: "Twilio", category: "TOOL", aliases: [] },

  // Tooling & process
  { name: "Jira", category: "TOOL", aliases: [] },
  { name: "Confluence", category: "TOOL", aliases: [] },
  { name: "Figma", category: "TOOL", aliases: [] },
  { name: "Scrum", category: "CONCEPT", aliases: [] },
  { name: "Kanban", category: "CONCEPT", aliases: [] },
  { name: "Agile", category: "CONCEPT", aliases: [] },
  { name: "OOP", category: "CONCEPT", aliases: ["Object Oriented Programming", "Об'єктно-орієнтоване програмування", "Обєктно-орієнтоване програмування"] },
  { name: "SOLID", category: "CONCEPT", aliases: ["SOLID principles", "SOLID-принципи"] },
  { name: "Design Patterns", category: "CONCEPT", aliases: ["Патерни проектування", "Патерни проєктування"] },
  { name: "Algorithms", category: "CONCEPT", aliases: ["Алгоритми", "Data Structures & Algorithms", "Структури даних та алгоритми"] },
  { name: "Clean Code", category: "CONCEPT", aliases: [] },
  { name: "Code Review", category: "CONCEPT", aliases: ["Рев'ю коду", "Ревю коду", "Peer Review"] },

  // Domain (частые на djinni)
  { name: "Fintech", category: "DOMAIN", aliases: ["FinTech", "Фінтех", "Банківські системи"] },
  { name: "E-commerce", category: "DOMAIN", aliases: ["Ecommerce", "E-commerce platforms", "Комерційні проекти"] },
  { name: "Healthcare", category: "DOMAIN", aliases: ["MedTech", "HealthTech"] },
  { name: "GameDev", category: "DOMAIN", aliases: ["Game Development", "Ігри", "Геймдев"] },
  { name: "Cybersecurity", category: "DOMAIN", aliases: ["InfoSec", "Інформаційна безпека", "Кібербезпека", "Безпека"] },

  // UA-формы djinni из cache/research
  { name: "Розробка ПЗ", category: "CONCEPT", aliases: ["Розробка програмного забезпечення"] },
  { name: "Ручне тестування", category: "TESTING", aliases: ["Manual Testing"] },
  { name: "Автоматизоване тестування", category: "TESTING", aliases: ["Автоматизоване ТЗ", "Automated Testing", "Тестова автоматизація", "Тестування ПЗ"] },
  { name: "Тестова документація", category: "TESTING", aliases: ["QA documentation", "Тест-кейси", "Тесткейси"] },
  { name: "Робота з БД", category: "DATABASE", aliases: [] },
  { name: "Розробка API", category: "CONCEPT", aliases: [] },
  { name: "Архітектура ПЗ", category: "CONCEPT", aliases: ["Архітектура програмного забезпечення", "Software Architecture"] },
  { name: "Проєктна документація", category: "CONCEPT", aliases: ["Проектна документація"] },
  { name: "Управління командою", category: "CONCEPT", aliases: ["Team Leadership", "Лідерство в команді", "Керівництво командою"] },
  { name: "Робота з клієнтами", category: "CONCEPT", aliases: ["Клієнт-орієнтованість", "Client Facing"] },
  { name: "Data Analysis", category: "CONCEPT", aliases: ["Аналіз даних", "Data Analytics"] },
  { name: "Power BI", category: "TOOL", aliases: [] },
  { name: "Tableau", category: "TOOL", aliases: [] },
  { name: "Excel", category: "TOOL", aliases: ["MS Excel", "Google Sheets"] },
];

/**
 * Построить карту нормализации: lowercase-алиас/имя → canonical-вход.
 * Конфликты: первый вхождение в словаре выигрывает (словарь курируется вручную).
 */
export function buildSkillLookup(): Map<string, SkillDictEntry> {
  const lookup = new Map<string, SkillDictEntry>();
  for (const entry of SKILL_DICTIONARY) {
    const keys = [entry.name, ...entry.aliases].map((k) => normalizeSkillKey(k));
    for (const key of keys) {
      if (!key) continue;
      if (!lookup.has(key)) lookup.set(key, entry);
    }
  }
  return lookup;
}

/** Нормализация имени для сопоставления: lowercase, без лишних пробелов/точек на конце. */
export function normalizeSkillKey(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[.,;:]+$/g, "")
    .trim();
}
