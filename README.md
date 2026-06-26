# Telegram Reminder Bot

Локально-запускаємий Telegram-бот на NestJS, що надсилає нагадування за JSON-конфігом. Перший use case — нагадування про прийом ліків з підтвердженням і повторами.

## Швидкий старт

1. **Створити бот** через [@BotFather](https://t.me/BotFather) → отримати токен.
2. **Дізнатись свій `telegramId`** — написати [@userinfobot](https://t.me/userinfobot).
3. **Установити залежності:**
   ```bash
   npm install
   ```
4. **Налаштувати:**
   ```bash
   cp .env.example .env             # вписати TELEGRAM_BOT_TOKEN
   cp config.example.json config.json   # вписати свій telegramId та reminders
   ```
5. **Запустити:**
   ```bash
   npm run start:dev
   ```
6. **Перевірити у Telegram:** `/start` → отримати привітання; `/next` → побачити розклад на сьогодні; чекати найближчого `time` — мають прийти inline-кнопки.

## Команди боту

- `/start` — перевірка авторизації + привітання
- `/next` — список нагадувань на сьогодні (поділених на «вже минули» / «ще будуть»)

## Структура конфігу

Див. [`config.example.json`](./config.example.json) і повний дизайн у [`docs/superpowers/specs/2026-06-26-telegram-reminder-bot-design.md`](./docs/superpowers/specs/2026-06-26-telegram-reminder-bot-design.md).

Ключові поля reminder:
- `id` — унікальний рядок у межах користувача
- `type` — `medication` (наразі єдиний; розширюється через plugin handlers)
- `params` — типозалежні параметри (для medication: `name`, `dose`, опційно `withFood`)
- `times` — масив `"HH:mm"` (часовий пояс з `bot.timezone`)
- `endDate` (опційно) — `YYYY-MM-DD` inclusive, останній день курсу
- `repeat` (опційно) — `{ intervalMin, maxRetries }`

## Розробка

```bash
npm run start:dev        # запуск з watch-mode
npm test                 # vitest run
npm run test:watch       # vitest watch-mode
npm run test:cov         # coverage report
npm run lint             # eslint --fix
npm run build            # compile to dist/
```

## Особливості реалізації

- **State лише in-memory.** Активні непідтверджені нагадування зберігаються у `Map`. При рестарті процесу — очищується. Нові повтори стартують з наступного запланованого `times`.
- **Plugin-based reminder types.** Додати новий тип = (1) реалізувати `ReminderTypeHandler`, (2) додати до `RemindersModule.providers` + register у `OnModuleInit`, (3) додати у discriminated union в `config/schema.ts`.
- **Авторизація.** Whitelist за `telegramId` з конфігу. Не-whitelisted отримує відмову.

## Дизайн

Повний дизайн-документ і діаграми: [`docs/superpowers/specs/`](./docs/superpowers/specs/).
