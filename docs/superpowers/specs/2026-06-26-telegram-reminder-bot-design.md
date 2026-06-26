# Telegram Reminder Bot — Дизайн

**Статус:** чернетка (готова до review)
**Дата:** 2026-06-26

> Документ збирається посекційно під час brainstorming. Усі 5 секцій заповнено: Секція 1 (Огляд), Секція 2 (Конфіг + plugins), Секція 3 (Scheduler/Repeat/State), Секція 4 (Команди/Auth/Помилки/Логи), Секція 5 (Тестування/Запуск).

---

## Контекст і вимоги

- **Користувачі:** 2-5 довірених людей. Авторизація — whitelist за Telegram user ID.
- **Сценарій:** надсилати нагадування за розкладом з JSON-конфігу. Перший use case — нагадування про прийом ліків; далі — інші типи (plugin-based).
- **Розклад:** список часів щодня (`["08:00", "20:00"]`), глобальний IANA-timezone.
- **Курс:** опційне поле `endDate` (`YYYY-MM-DD`, **inclusive**) — після цього дня cron перестає спрацьовувати. `startDate` не використовуємо (курс завжди починається з сьогодні).
- **Взаємодія:** inline-кнопка «✅ Прийняв». Якщо немає підтвердження за N хвилин — повтор, до M разів.
- **Стек:** NestJS (TypeScript), `nestjs-telegraf`, `@nestjs/schedule`, `zod`.
- **Запуск:** локально у терміналі (`npm run start`), без Docker. Цільова машина — власний комп'ютер / Raspberry Pi.
- **Persistence:** in-memory лише. Без `state.json`, без БД. При рестарті активні непідтверджені нагадування втрачаються — нові повтори стартують з наступного запланованого `times`.
- **Команди бота:** `/start` (привітання + авторизація), `/next` (список нагадувань на день).
- **Reload конфігу:** перезапуском процесу. Без hot-reload.
- **Стиль коду:**
  - функціональний (`map + .flat(N)` замість вкладених циклів і замість `flatMap`);
  - повні описові імена змінних (без `h`/`t`/`u`/`r` для handler/timer/user/reminder).

---

## Секція 1 — Огляд архітектури

**Стек:** NestJS (TypeScript), `nestjs-telegraf`, `@nestjs/schedule`, `zod`, `nestjs-pino`, `vitest`.
**Scaffold:** `nest new` (CLI), потім чистка зайвого. Запуск через `npm run start:dev` / `npm run start`.

### Архітектурні діаграми (PlantUML)

Усі формальні діаграми зберігаємо як окремі `.puml` файли у `diagrams/`. Рендеряться будь-яким PlantUML-сумісним інструментом (VS Code extension, IntelliJ, online editor).

| Файл | Тип | Що показує |
|------|-----|-----------|
| [`diagrams/c4-component.puml`](diagrams/c4-component.puml) | C4 Component | Залежності між NestJS-модулями + зовнішніми системами (Telegram API, файли) |
| [`diagrams/sequence-reminder-lifecycle.puml`](diagrams/sequence-reminder-lifecycle.puml) | Sequence | Часовий потік: cron fire → send → ack vs. retry vs. max retries |
| [`diagrams/state-reminder-lifecycle.puml`](diagrams/state-reminder-lifecycle.puml) | State (FSM) | Життєвий цикл одного reminder-а: Idle / Sent / Retrying / Acked / MaxRetriesReached / Expired |

**Ключові читання діаграм:**
- `RemindersModule` — «гарячий» модуль: він **запускає** дії (cron-tick → send). Інші модулі переважно реагують.
- `BotModule` — двосторонній зв'язок з Telegram API: і отримує updates, і надсилає повідомлення.
- `ConfigModule` — read-only джерело правди. Ніхто не пише у конфіг у runtime.
- `StateModule` — єдина точка mutable runtime-стану. Persistence повністю інкапсульована.
- FSM показує **edge cases**: гонка таймера/ack, idempotent повторний ack, поведінка після `endDate`.

### Високорівнева ASCII-схема (швидкий огляд)

```
AppModule
├── ConfigModule (global)
│     └─ ConfigLoaderService           ← читає config.json + zod-валідація на старті
│
├── BotModule (TelegrafModule.forRootAsync)
│     ├─ AuthGuard                     ← whitelist по telegramId
│     ├─ StartCommand                  (/start)
│     ├─ NextCommand                   (/next — список на день)
│     └─ AckAction                     (callback_query "ack:*")
│
├── RemindersModule
│     ├─ ReminderTypeRegistry          ← Map<type, ReminderTypeHandler>
│     ├─ MedicationHandler             ← перший plugin
│     ├─ SchedulerService              ← реєструє cron-jobs через @nestjs/schedule
│     └─ RepeatEngineService           ← таймери повторів + ескалація
│
└── StateModule
      └─ StateStore                    ← in-memory Map<userId, ActiveReminder>, без persistence
```

### Структура файлів

```
src/
  main.ts                              # bootstrap NestFactory
  app.module.ts

  config/
    config.module.ts
    config-loader.service.ts           # OnModuleInit → load+validate
    schema.ts                          # zod schemas + inferred types

  bot/
    bot.module.ts                      # TelegrafModule.forRootAsync
    auth.guard.ts
    commands/
      start.command.ts
      next.command.ts
    actions/
      ack.action.ts                    # @Action(/^ack:.+$/)

  reminders/
    reminders.module.ts
    types/
      reminder-type.interface.ts
      reminder-type.registry.ts
      medication.handler.ts
    scheduler.service.ts               # OnApplicationBootstrap → registerJobs()
    repeat-engine.service.ts

  state/
    state.module.ts
    state.store.ts                     # in-memory Map, без persistence

  shared/
    logger.config.ts
    time.util.ts
```

### Lifecycle hooks

- `OnModuleInit` у `ConfigLoaderService` → fail-fast при невалідному `config.json`
- `OnApplicationBootstrap` у `SchedulerService` → реєстрація cron-jobs (після того, як конфіг і реєстр готові)

---

## Секція 2 — JSON-конфіг, zod-схема, plugin-інтерфейс

### Структура `config.json`

```json
{
  "bot": {
    "token": "${TELEGRAM_BOT_TOKEN}",
    "timezone": "Europe/Kyiv"
  },
  "users": [
    {
      "telegramId": 123456789,
      "name": "Igor",
      "reminders": [
        {
          "id": "morning-vitamin-d",
          "type": "medication",
          "params": {
            "name": "Вітамін D",
            "dose": "1 таблетка",
            "withFood": true
          },
          "times": ["08:00", "20:00"],
          "repeat": {
            "intervalMin": 15,
            "maxRetries": 3
          }
        },
        {
          "id": "antibiotic-course",
          "type": "medication",
          "params": {
            "name": "Амоксицилін",
            "dose": "500 мг"
          },
          "times": ["08:00", "20:00"],
          "endDate": "2026-07-02",
          "repeat": {
            "intervalMin": 15,
            "maxRetries": 3
          }
        }
      ]
    }
  ]
}
```

**Рішення:**
- `bot.token` — з env-змінної `${TELEGRAM_BOT_TOKEN}`, резолвиться loader-ом перед валідацією.
- `bot.timezone` — IANA, валідується через `Intl.DateTimeFormat`.
- `id` reminder-а унікальний в межах користувача, використовується у `callback_data` (`ack:<userId>:<reminderId>:<fireTs>`).
- `times` — `"HH:mm"` рядки.
- `endDate` — опційний (`YYYY-MM-DD`), **inclusive**: якщо `2026-07-02` — нагадування ще надсилаються 2 липня, а з 3 липня вже ні.
- `repeat` опційний.
- `params` — типозалежна форма. Кожен handler має власну zod-схему.

### Zod-схема (discriminated union)

```ts
// config/schema.ts
import { z } from 'zod';
import { medicationParamsSchema } from '../reminders/types/medication.schema';

const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:mm');
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');

const repeatSchema = z.object({
  intervalMin: z.number().int().positive().max(180),
  maxRetries: z.number().int().min(0).max(10),
});

const reminderSchema = z.discriminatedUnion('type', [
  z.object({
    id: z.string().min(1),
    type: z.literal('medication'),
    params: medicationParamsSchema,
    times: z.array(timeSchema).min(1),
    endDate: dateSchema.optional(),
    repeat: repeatSchema.optional(),
  }),
  // ...майбутні типи додаються сюди
]);

const userSchema = z.object({
  telegramId: z.number().int().positive(),
  name: z.string().min(1),
  reminders: z.array(reminderSchema)
    .refine(arr => new Set(arr.map(r => r.id)).size === arr.length, 'reminder ids must be unique'),
});

export const configSchema = z.object({
  bot: z.object({
    token: z.string().min(1),
    timezone: z.string().refine(isValidTimezone, 'invalid IANA timezone'),
  }),
  users: z.array(userSchema).min(1)
    .refine(arr => new Set(arr.map(u => u.telegramId)).size === arr.length, 'telegramId must be unique'),
});

export type AppConfig = z.infer<typeof configSchema>;
export type Reminder = z.infer<typeof reminderSchema>;
export type User = z.infer<typeof userSchema>;
```

Discriminated union дає (а) рантайм-валідацію `params` під конкретний `type`, (б) звужування типу у TypeScript — у handler `params` уже типізований без касту.

### Plugin-інтерфейс

```ts
// reminders/types/reminder-type.interface.ts
import { z } from 'zod';

export interface ReminderTypeHandler<TParams = unknown> {
  readonly type: string;
  readonly paramsSchema: z.ZodType<TParams>;
  buildMessage(params: TParams, context: ReminderContext): { text: string; buttons: InlineButton[] };
  buildSummary(params: TParams): string;
}

export interface ReminderContext {
  reminderId: string;
  fireTimestamp: number;
  retryAttempt: number; // 0 = перший раз, 1+ = повтор
}

export interface InlineButton {
  text: string;
  callbackData: string;
}
```

### `MedicationHandler`

```ts
// reminders/types/medication.handler.ts
import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { ReminderTypeHandler } from './reminder-type.interface';

export const medicationParamsSchema = z.object({
  name: z.string().min(1),
  dose: z.string().min(1),
  withFood: z.boolean().optional(),
});

type MedicationParams = z.infer<typeof medicationParamsSchema>;

@Injectable()
export class MedicationHandler implements ReminderTypeHandler<MedicationParams> {
  readonly type = 'medication';
  readonly paramsSchema = medicationParamsSchema;

  buildMessage(params, ctx) {
    const food = params.withFood ? ' (під час їжі)' : '';
    const prefix = ctx.retryAttempt === 0 ? '💊 Час прийняти' : '⏰ Нагадую ще раз';
    return {
      text: `${prefix} *${params.name}* — ${params.dose}${food}`,
      buttons: [{ text: '✅ Прийняв', callbackData: '__ACK__' }],
    };
  }

  buildSummary(params) {
    return `💊 ${params.name} — ${params.dose}`;
  }
}
```

### Реєстр

```ts
// reminders/types/reminder-type.registry.ts
@Injectable()
export class ReminderTypeRegistry {
  private readonly handlers = new Map<string, ReminderTypeHandler>();

  register(handler: ReminderTypeHandler) {
    this.handlers.set(handler.type, handler);
  }

  get(type: string): ReminderTypeHandler {
    const handler = this.handlers.get(type);
    if (!handler) throw new Error(`No handler for reminder type: ${type}`);
    return handler;
  }
}
```

`RemindersModule` робить `register(...)` у `OnModuleInit` для всіх DI-injected handlers. Додавання нового типу = (1) написати handler, (2) додати у `providers` модуля + у discriminated union у `schema.ts`.

---

## Секція 3 — Scheduler, RepeatEngine, State

### Загальний потік життєвого циклу нагадування

```
cron спрацював о 08:00
        │
        ▼
SchedulerService.fire(userId, reminder)
        │
        ▼
handler.buildMessage(params, ctx)        ← sync, повертає { text, buttons }
        │
        ▼
bot.send(userId, text, buttons)          ← await: HTTP до Telegram API
        │
        ▼
state.markActive(userId, id, { messageId, fireTs, ... })   ← зберігаємо
        │
        ▼
repeat.scheduleNext(userId, reminder)    ← setTimeout(intervalMs)
        │
        ▼
        (метод повертається, event loop вільний)

        ...через intervalMin хвилин setTimeout спрацьовує...
        ▼
RepeatEngine.fireRetry()                 ← перевіряє state, надсилає повтор
                                            (поки attempt ≤ maxRetries)

        ...або до того моменту користувач тисне «✅ Прийняв»...
        ▼
AckAction.onAck()                        ← repeat.cancel() + state.clear()
```

**Порядок у `fire()`:**
1. `handler.buildMessage` — pure, без I/O.
2. `bot.send` — `await` мережевого виклику, повертає `messageId`.
3. `state.markActive` — після успішної відправки (інакше повтор шукав би messageId, якого нема).
4. `repeat.scheduleNext` — реєструємо `setTimeout`.

Все це — один послідовний await-ланцюг, без паралельності.

### `expandSchedule` — pure-функція

Виокремлюємо трансформацію конфігу у плаский список слотів (стиль: `map + .flat(N)`, не `flatMap`).

```ts
// config/schema.ts (поруч з типами)
export interface ScheduledSlot {
  userId: number;
  reminder: Reminder;
  time: string; // "HH:mm"
}

export const expandSchedule = (users: User[]): ScheduledSlot[] =>
  users
    .map(user =>
      user.reminders.map(reminder =>
        reminder.times.map(time => ({
          userId: user.telegramId,
          reminder,
          time,
        })),
      ),
    )
    .flat(2);
```

### `SchedulerService`

```ts
@Injectable()
export class SchedulerService implements OnApplicationBootstrap {
  constructor(
    private readonly config: ConfigLoaderService,
    private readonly registry: ReminderTypeRegistry,
    private readonly state: StateStore,
    private readonly repeat: RepeatEngineService,
    private readonly bot: BotGateway,        // абстракція над nestjs-telegraf
    private readonly scheduler: SchedulerRegistry,
    private readonly logger: Logger,
  ) {}

  onApplicationBootstrap() {
    const { bot, users } = this.config.get();
    expandSchedule(users).forEach(slot =>
      this.registerCron(slot.userId, slot.reminder, slot.time, bot.timezone),
    );
  }

  private registerCron(userId, reminder, time, tz) {
    const [hh, mm] = time.split(':');
    const cronExpr = `${mm} ${hh} * * *`;
    const jobName = `${userId}:${reminder.id}:${time}`;

    const job = new CronJob(
      cronExpr,
      () => this.fire(userId, reminder),
      null,
      true,
      tz,
    );
    this.scheduler.addCronJob(jobName, job);
  }

  async fire(userId: number, reminder: Reminder) {
    if (this.isReminderExpired(reminder)) {
      this.logger.log(`Reminder ${reminder.id} is past endDate — skipping`);
      return;
    }

    const fireTs = Date.now();

    const handler = this.registry.get(reminder.type);
    const { text, buttons } = handler.buildMessage(reminder.params, {
      reminderId: reminder.id,
      fireTimestamp: fireTs,
      retryAttempt: 0,
    });

    const msg = await this.bot.send(
      userId,
      text,
      this.toInlineKeyboard(buttons, userId, reminder.id, fireTs),
    );

    this.state.markActive(userId, reminder.id, {
      fireTs,
      messageId: msg.message_id,
      retryAttempt: 0,
      maxRetries: reminder.repeat?.maxRetries ?? 0,
      intervalMs: (reminder.repeat?.intervalMin ?? 0) * 60_000,
    });

    if (reminder.repeat) {
      this.repeat.scheduleNext(userId, reminder);
    }
  }

  private toInlineKeyboard(buttons, userId, reminderId, fireTs) {
    return buttons.map(button => ({
      text: button.text,
      callback_data: `ack:${userId}:${reminderId}:${fireTs}`,
    }));
  }

  /**
   * endDate inclusive: reminder вважається expired, коли сьогодні > endDate.
   * Без endDate — ніколи не expired.
   * Порівняння рядків YYYY-MM-DD коректне завдяки сортувальному формату.
   */
  private isReminderExpired(reminder: Reminder): boolean {
    if (!reminder.endDate) return false;
    const timezone = this.config.get().bot.timezone;
    const today = formatInTimezone(new Date(), timezone, 'yyyy-MM-dd');
    return today > reminder.endDate;
  }
}
```

### `RepeatEngineService`

```ts
@Injectable()
export class RepeatEngineService {
  private readonly timers = new Map<string, NodeJS.Timeout>(); // key = userId:reminderId

  constructor(
    private readonly state: StateStore,
    private readonly registry: ReminderTypeRegistry,
    private readonly bot: BotGateway,
    private readonly logger: Logger,
  ) {}

  scheduleNext(userId: number, reminder: Reminder) {
    const key = `${userId}:${reminder.id}`;
    this.clear(key);

    const active = this.state.get(userId, reminder.id);
    if (!active) return;
    if (active.retryAttempt >= active.maxRetries) {
      this.logger.warn(`Max retries reached: ${key}`);
      this.state.clear(userId, reminder.id);
      return;
    }

    const timer = setTimeout(() => this.fireRetry(userId, reminder), active.intervalMs);
    this.timers.set(key, timer);
  }

  cancel(userId: number, reminderId: string) {
    this.clear(`${userId}:${reminderId}`);
  }

  private async fireRetry(userId: number, reminder: Reminder) {
    const active = this.state.get(userId, reminder.id);
    if (!active) return; // вже підтверджено між таймером і виконанням

    active.retryAttempt += 1;
    const handler = this.registry.get(reminder.type);
    const { text, buttons } = handler.buildMessage(reminder.params, {
      reminderId: reminder.id,
      fireTimestamp: active.fireTs,
      retryAttempt: active.retryAttempt,
    });

    const msg = await this.bot.send(
      userId,
      text,
      this.buildKeyboard(buttons, userId, reminder.id, active.fireTs),
    );
    active.messageId = msg.message_id;
    this.state.update(userId, reminder.id, active);
    this.scheduleNext(userId, reminder);
  }

  private clear(key: string) {
    const timer = this.timers.get(key);
    if (timer) clearTimeout(timer);
    this.timers.delete(key);
  }
}
```

### `StateStore`

```ts
// state/state.store.ts
export interface ActiveReminder {
  fireTs: number;
  messageId: number;
  retryAttempt: number;
  maxRetries: number;
  intervalMs: number;
}

@Injectable()
export class StateStore {
  private readonly map = new Map<string, ActiveReminder>();
  // key = `${userId}:${reminderId}`, тримаємо лише активні (непідтверджені)

  markActive(userId: number, reminderId: string, data: ActiveReminder) {
    this.map.set(this.key(userId, reminderId), data);
  }

  get(userId: number, reminderId: string): ActiveReminder | undefined {
    return this.map.get(this.key(userId, reminderId));
  }

  update(userId: number, reminderId: string, data: ActiveReminder) {
    this.map.set(this.key(userId, reminderId), data);
  }

  clear(userId: number, reminderId: string) {
    this.map.delete(this.key(userId, reminderId));
  }

  private key(userId: number, reminderId: string) {
    return `${userId}:${reminderId}`;
  }
}
```

**State — лише in-memory.** Жодного `state.json`, жодного `StatePersistence`. При рестарті Map пуста — це навмисна поведінка («тихо очистити при рестарті»). Якщо в момент рестарту у пам'яті були непідтверджені reminder-и — вони втрачаються; нові повтори почнуться з наступного запланованого `times`.

**Singleton scope — обов'язкова умова.** `StateStore` оголошено у `StateModule` з `providers: [StateStore]` і **`exports: [StateStore]`**. Будь-який модуль-споживач (`RemindersModule`, `BotModule`) робить `imports: [StateModule]` — і DI повертає **той самий інстанс** усім, хто його ін'єктує (Scheduler, RepeatEngine, AckAction). Це критично: повтори і ack мають дивитися в одну Map, інакше кнопка не відмінятиме повтори. **Не використовувати** `@Injectable({ scope: Scope.TRANSIENT })` і **не дублювати** `StateStore` у `providers` інших модулів.

**Чому так:** для нашого use case (особисті нагадування про ліки, машина запускається стабільно) ймовірність рестарту під час активного retry-вікна низька, а складність persistence + invariants реcheduling не виправдана. Якщо колись з'явиться потреба — це адитивне доповнення (повернемо `StatePersistence` як новий модуль без перебудови решти).

### Як ack відміняє повтори

```ts
// bot/actions/ack.action.ts
@Update()
export class AckAction {
  constructor(
    private readonly state: StateStore,
    private readonly repeat: RepeatEngineService,
  ) {}

  @Action(/^ack:(\d+):([^:]+):(\d+)$/)
  async onAck(@Ctx() ctx: Context) {
    const [, userIdRaw, reminderId] = ctx.match;
    const userId = Number(userIdRaw);

    const wasActive = this.state.get(userId, reminderId) !== undefined;
    this.repeat.cancel(userId, reminderId);
    this.state.clear(userId, reminderId);

    await ctx.answerCbQuery(wasActive ? 'Зафіксовано ✅' : 'Вже зафіксовано');

    // Telegram кидає 'message is not modified', якщо reply_markup уже undefined.
    // Для повторного натискання це очікувано — тихо ігноруємо.
    try {
      await ctx.editMessageReplyMarkup(undefined);
    } catch (error) {
      this.logger.debug({ err: error }, 'editMessageReplyMarkup ignored (likely idempotent ack)');
    }
  }
}
```

**Idempotent ack:** повторне натискання після очистки state не призводить до помилки. `state.clear()` на відсутньому ключі — no-op у `Map`; `repeat.cancel()` на відсутньому таймері — теж no-op; `editMessageReplyMarkup` обгорнуто у try/catch для випадку, коли кнопка вже видалена попереднім ack. Користувач бачить «Вже зафіксовано» замість «Зафіксовано ✅».

### Рішення Секції 3 (зафіксовано)

1. **Persistence:** жодного `state.json`. State — лише in-memory. При рестарті очищується автоматично через перезапуск процесу.
2. **Після рестарту з непідтвердженими:** state втрачено, повтори перервані; нові повтори стартують з наступного запланованого `times`. Жодного коду для відновлення не пишемо.
3. **Idempotent ack:** так — повторне натискання тихо повертає «Вже зафіксовано».

---

## Секція 4 — Команди, авторизація, помилки/логи

### `AuthGuard` — whitelist по `telegramId`

Захищає **усі** update-handlers (`/start`, `/next`, `ack:*`). Один guard — одна декларація, замість дублювання перевірок у кожному handler-і.

```ts
// bot/auth.guard.ts
import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { TelegrafExecutionContext } from 'nestjs-telegraf';
import { Context } from 'telegraf';
import { ConfigLoaderService } from '../config/config-loader.service';

@Injectable()
export class AuthGuard implements CanActivate {
  private readonly logger = new Logger(AuthGuard.name);

  constructor(private readonly config: ConfigLoaderService) {}

  async canActivate(executionContext: ExecutionContext): Promise<boolean> {
    const telegrafContext = TelegrafExecutionContext
      .create(executionContext)
      .getContext<Context>();

    const senderId = telegrafContext.from?.id;
    if (!senderId) {
      return false;
    }

    const whitelist = this.config.get().users.map(user => user.telegramId);
    const isAllowed = whitelist.includes(senderId);

    if (!isAllowed) {
      this.logger.warn(`Unauthorized access attempt from telegramId=${senderId}`);
      await telegrafContext.reply('⛔ У вас немає доступу до цього бота.');
    }

    return isAllowed;
  }
}
```

**Застосування** — декоратор `@UseGuards(AuthGuard)` на кожен handler-клас:

```ts
@Update()
@UseGuards(AuthGuard)
export class StartCommand { ... }
```

Альтернатива — глобальна реєстрація через `APP_GUARD` у `BotModule`. Я обираю явний декоратор на handler-класах: видніше у читанні коду, які точки входу захищені.

---

### `/start` — привітання + перевірка авторизації

```ts
// bot/commands/start.command.ts
import { Start, Ctx, Update } from 'nestjs-telegraf';
import { UseGuards } from '@nestjs/common';
import { Context } from 'telegraf';
import { AuthGuard } from '../auth.guard';
import { ConfigLoaderService } from '../../config/config-loader.service';

@Update()
@UseGuards(AuthGuard)
export class StartCommand {
  constructor(private readonly config: ConfigLoaderService) {}

  @Start()
  async onStart(@Ctx() ctx: Context) {
    const senderId = ctx.from!.id;
    const user = this.config.get().users.find(
      candidate => candidate.telegramId === senderId,
    );

    await ctx.reply(
      `Привіт, ${user!.name}! 👋\n` +
      `Я надсилатиму нагадування за розкладом.\n` +
      `Команда /next покаже список на сьогодні.`,
    );
  }
}
```

> Після `AuthGuard` ми гарантовано знаємо, що `user` знайдеться — `!` тут означає «довіряю guard-у». Це єдиний випадок non-null assertion у проєкті; деінде уникаємо.

---

### `/next` — список нагадувань на сьогодні

Показує всі `times` сьогоднішнього дня (виключаючи expired через `today > endDate`), **поділених на дві секції**: вже минулі і ще попереду. Один reminder з кількома часами може потрапити в обидві секції (наприклад, ліки о 08:00 і 20:00 — о 13:00 перше минуло, друге ще буде).

```ts
// bot/commands/next.command.ts
import { Command, Ctx, Update } from 'nestjs-telegraf';
import { UseGuards } from '@nestjs/common';
import { Context } from 'telegraf';
import { AuthGuard } from '../auth.guard';
import { ConfigLoaderService } from '../../config/config-loader.service';
import { ReminderTypeRegistry } from '../../reminders/types/reminder-type.registry';
import { Reminder } from '../../config/schema';
import { formatInTimezone } from '../../shared/time.util';

interface Slot {
  reminder: Reminder;
  time: string; // "HH:mm"
}

@Update()
@UseGuards(AuthGuard)
export class NextCommand {
  constructor(
    private readonly config: ConfigLoaderService,
    private readonly registry: ReminderTypeRegistry,
  ) {}

  @Command('next')
  async onNext(@Ctx() ctx: Context) {
    const senderId = ctx.from!.id;
    const config = this.config.get();
    const user = config.users.find(candidate => candidate.telegramId === senderId)!;

    const today = formatInTimezone(new Date(), config.bot.timezone, 'yyyy-MM-dd');
    const currentTime = formatInTimezone(new Date(), config.bot.timezone, 'HH:mm');

    const slots = this.collectTodaysSlots(user.reminders, today);
    const past = slots.filter(slot => slot.time < currentTime);
    const upcoming = slots.filter(slot => slot.time >= currentTime);

    const sections = [
      this.renderSection('✅ *Вже минули:*', past),
      this.renderSection('⏰ *Ще будуть:*', upcoming),
    ].filter(section => section !== null);

    const message = sections.length === 0
      ? '📭 На сьогодні нагадувань немає.'
      : `📋 *Нагадування на сьогодні (${currentTime}):*\n\n${sections.join('\n\n')}`;

    await ctx.reply(message, { parse_mode: 'Markdown' });
  }

  private collectTodaysSlots(reminders: Reminder[], today: string): Slot[] {
    return reminders
      .filter(reminder => !reminder.endDate || today <= reminder.endDate)
      .map(reminder => reminder.times.map(time => ({ reminder, time })))
      .flat()
      .sort((left, right) => left.time.localeCompare(right.time));
  }

  private renderSection(title: string, slots: Slot[]): string | null {
    if (slots.length === 0) {
      return null;
    }
    const lines = slots.map(slot => {
      const handler = this.registry.get(slot.reminder.type);
      const summary = handler.buildSummary(slot.reminder.params);
      return `• ${slot.time} — ${summary}`;
    });
    return `${title}\n${lines.join('\n')}`;
  }
}
```

**Приклад виводу** (зараз 13:00, ліки на 08:00/20:00 і антибіотики на 08:00/14:00/20:00):

```
📋 Нагадування на сьогодні (13:00):

✅ Вже минули:
• 08:00 — 💊 Вітамін D — 1 таблетка
• 08:00 — 💊 Амоксицилін — 500 мг

⏰ Ще будуть:
• 14:00 — 💊 Амоксицилін — 500 мг
• 20:00 — 💊 Вітамін D — 1 таблетка
• 20:00 — 💊 Амоксицилін — 500 мг
```

**Чому показуємо вже минулі без статусу «прийняли / не прийняли»:** наш `StateStore` тримає лише непідтверджені, а після ack запис видаляється. Тобто ми не зберігаємо історію подій — отже не можемо чесно відобразити «✅ прийняв» чи «❌ пропустив» для минулих часів. Показ часу без статусу не вводить в оману і узгоджений з in-memory моделлю. Якщо колись з'явиться потреба у такому статусі — це обумовить введення audit log або БД.

**Сортування за `time` через `localeCompare`** працює коректно для формату `"HH:mm"` завдяки лексикографічному порядку (`"08:00" < "13:00" < "20:00"`).

---

### Обробка помилок

| Місце | Тип помилки | Стратегія |
|-------|-------------|-----------|
| `ConfigLoaderService.onModuleInit` | Невалідний `config.json` (zod-validation, ENOENT, JSON parse) | **Fail-fast.** Кидаємо помилку, NestJS логує і застосунок не стартує. Користувач має поправити конфіг. |
| `BotGateway.send` | Telegram API недоступне / rate limit / banned token | `try/catch`. Логуємо `ERROR`, **не** кидаємо назад. Активний state лишається — наступний retry timer спробує ще раз. Якщо це fatal (наприклад, неправильний токен) — щось не так із конфігом, треба перезапустити. |
| `AckAction.onAck` | callback_data не парситься | Telegraf маршрутизує тільки те, що матчить regex `^ack:(\d+):([^:]+):(\d+)$`. Решта callback-ів — ігноруються самим Telegraf без нашої участі. |
| `AckAction.onAck` | state вже clear (idempotent повтор) | Відповідаємо «Вже зафіксовано», `answerCbQuery` без alert. |
| `SchedulerService.fire` | handler не знайдено для типу | Не повинно статись (zod discriminated union перевіряє при старті). Якщо все ж — `registry.get()` кидає Error, ловимо у глобальному handler. |
| `RepeatEngineService.fireRetry` | `bot.send` впав | Той самий `try/catch` як у `BotGateway`. State не оновлюємо (бо `messageId` старий), наступний таймер спробує ще раз. |
| `process.on('unhandledRejection')` | Будь-яка несподівана | Логуємо `FATAL`, **не** виходимо з процесу (Node за замовчуванням виходить — переоприділяємо). Якщо процес впав — користувач втрачає state до наступного запуску. |

```ts
// shared/error-handlers.ts
import { Logger } from '@nestjs/common';

export const registerGlobalErrorHandlers = (logger: Logger) => {
  process.on('unhandledRejection', (reason) => {
    logger.error({ reason }, 'unhandledRejection');
  });
  process.on('uncaughtException', (error) => {
    logger.error({ err: error }, 'uncaughtException');
  });
};
```

Викликається у `main.ts` після `NestFactory.create`.

---

### Логування

**Бібліотека:** `nestjs-pino`. У dev — pretty-print, у prod — JSON (через env-змінну `LOG_LEVEL`).

**Налаштування:**

```ts
// shared/logger.config.ts
import { Params } from 'nestjs-pino';

export const loggerConfig: Params = {
  pinoHttp: {
    level: process.env.LOG_LEVEL ?? 'info',
    transport: process.env.NODE_ENV === 'production'
      ? undefined
      : { target: 'pino-pretty', options: { singleLine: true } },
    redact: ['*.token', '*.TELEGRAM_BOT_TOKEN'], // не логувати токен
  },
};
```

**Рівні і що логуємо:**

| Рівень | Подія | Поля |
|--------|-------|------|
| `debug` | cron fire, retry timer set, message built | `userId`, `reminderId`, `time`, `retryAttempt` |
| `info` | startup (`X reminders for Y users scheduled`), `/start`, `/next`, reminder sent, ack received | `userId`, `reminderId`, `count` |
| `warn` | ack для clear state, max retries reached, expired cron skipped, unauthorized attempt | `userId`, `reminderId`, `reason` |
| `error` | telegram send failed, registry miss | `err.message`, `userId?`, `reminderId?` |
| `fatal` | unhandledRejection, uncaughtException | `err`, `reason` |

**Що НЕ логуємо:**
- Сам токен бота — у `redact`-листі.
- Тіла повідомлень користувачам (особисті медичні дані) — логуємо тільки `reminderId`, не `params.name`.
- Telegram update payload повністю — лише `userId` + `update_id`.

**Чому окремий список «що не логуємо»:** у нашому контексті лікарські назви — це чутливі дані. У логах має бути достатньо для діагностики (хто, коли, що зломалось), але без витоку persona-medical info.

---

### Структура модулів (фінальна)

```ts
// bot/bot.module.ts
@Module({
  imports: [
    ConfigModule,
    StateModule,
    forwardRef(() => RemindersModule),
    TelegrafModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigLoaderService],
      useFactory: (config: ConfigLoaderService) => ({
        token: config.get().bot.token,
      }),
    }),
  ],
  providers: [AuthGuard, StartCommand, NextCommand, AckAction, BotGateway],
  exports: [BotGateway],
})
export class BotModule {}
```

```ts
// reminders/reminders.module.ts
@Module({
  imports: [ConfigModule, StateModule, forwardRef(() => BotModule)],
  providers: [
    SchedulerService,
    RepeatEngineService,
    ReminderTypeRegistry,
    MedicationHandler,
  ],
  exports: [RepeatEngineService],
})
export class RemindersModule {}
```

```ts
// state/state.module.ts
@Module({
  providers: [StateStore],
  exports: [StateStore],
})
export class StateModule {}
```

```ts
// config/config.module.ts
@Module({
  providers: [ConfigLoaderService],
  exports: [ConfigLoaderService],
})
@Global() // зручно — кожен модуль автоматично бачить ConfigLoaderService
export class ConfigModule {}
```

`@Global()` на `ConfigModule` — допустимий виняток, бо конфіг потрібен майже скрізь. Усі інші модулі — без `@Global()`, явні `imports`.

---

## Секція 5 — Тестування та запуск

### Стратегія тестування

Орієнтуємось на **піраміду**: багато unit-тестів pure-логіки, кілька integration-тестів з моками для services, **жодного** E2E з реальним Telegram (бот особистий — ручної перевірки `/start`, отримання нагадування і `/next` достатньо).

| Рівень | Що тестуємо | Як |
|--------|-------------|-----|
| **Unit** | `expandSchedule`, `collectTodaysSlots`, `isReminderExpired`, `MedicationHandler.buildMessage/buildSummary`, `ReminderTypeRegistry`, `StateStore`, zod-схема | vitest, без NestJS DI, прямі імпорти |
| **Integration** | `SchedulerService.fire`, `RepeatEngineService.scheduleNext/fireRetry`, `AckAction.onAck`, `AuthGuard` | `Test.createTestingModule` з NestJS, моки для `BotGateway` і `ConfigLoaderService`. `vi.useFakeTimers()` для тестів повторів |
| **E2E** | — | Ручна перевірка |

### Виокремлення pure-логіки для тестування

Щоб тестувати без NestJS DI, виносимо чисту логіку у функції-модулі окремо від `@Injectable()`-сервісів:

- `expandSchedule(users)` — у `config/schema.ts` (вже зроблено)
- `isReminderExpired(reminder, todayIso)` — винести з `SchedulerService` у `shared/time.util.ts`, передавати `today` як аргумент замість читання конфігу
- `collectTodaysSlots(reminders, today)` — винести з `NextCommand` у окремий модуль (наприклад, `bot/commands/next.logic.ts`)

Це дає **бонус**: тести таких функцій — на одному рядку, без `Test.createTestingModule`.

### Структура тестів

Collocated — `*.spec.ts` поруч з тестованим файлом:

```
src/
  config/
    schema.ts
    schema.spec.ts                     # zod-валідація: positive/negative
  reminders/
    scheduler.service.ts
    scheduler.service.spec.ts          # integration з моками
    repeat-engine.service.spec.ts
    types/
      medication.handler.ts
      medication.handler.spec.ts       # unit
      reminder-type.registry.spec.ts
  state/
    state.store.spec.ts                # unit
  bot/
    auth.guard.spec.ts                 # unit з мокованим ExecutionContext
    commands/
      next.logic.ts                    # винесена pure-логіка
      next.logic.spec.ts               # unit
      next.command.spec.ts             # integration
    actions/
      ack.action.spec.ts               # integration
  shared/
    time.util.ts
    time.util.spec.ts                  # unit
```

**Фікстури** — `test/fixtures/config.fixture.ts`, експортують типові обʼєкти (`buildConfig({ overrides })`), щоб не дублювати в кожному тесті.

### Приклади тестів

**Unit — pure-функція:**

```ts
// reminders/expand-schedule.spec.ts
import { describe, it, expect } from 'vitest';
import { expandSchedule } from './schema';
import { buildUser } from '../../test/fixtures/config.fixture';

describe('expandSchedule', () => {
  it('розгортає вкладені users → reminders → times у плоский список', () => {
    const users = [
      buildUser({
        telegramId: 1,
        reminders: [
          { id: 'r1', times: ['08:00', '20:00'] },
          { id: 'r2', times: ['12:00'] },
        ],
      }),
    ];

    const result = expandSchedule(users);

    expect(result).toHaveLength(3);
    expect(result.map(slot => slot.time)).toEqual(['08:00', '20:00', '12:00']);
  });

  it('повертає [] для порожнього масиву users', () => {
    expect(expandSchedule([])).toEqual([]);
  });
});
```

**Unit — handler:**

```ts
// reminders/types/medication.handler.spec.ts
describe('MedicationHandler', () => {
  const handler = new MedicationHandler();

  it('додає "(під час їжі)" коли withFood=true', () => {
    const { text } = handler.buildMessage(
      { name: 'Вітамін D', dose: '1 таблетка', withFood: true },
      { reminderId: 'r1', fireTimestamp: 0, retryAttempt: 0 },
    );
    expect(text).toContain('(під час їжі)');
    expect(text).toContain('Час прийняти');
  });

  it('використовує retry-prefix при retryAttempt > 0', () => {
    const { text } = handler.buildMessage(
      { name: 'X', dose: '1' },
      { reminderId: 'r1', fireTimestamp: 0, retryAttempt: 1 },
    );
    expect(text).toContain('Нагадую ще раз');
  });

  it('paramsSchema відхиляє пустий name', () => {
    const result = handler.paramsSchema.safeParse({ name: '', dose: '1' });
    expect(result.success).toBe(false);
  });
});
```

**Integration — Scheduler.fire:**

```ts
// reminders/scheduler.service.spec.ts
describe('SchedulerService.fire', () => {
  let module: TestingModule;
  let scheduler: SchedulerService;
  let state: StateStore;
  let bot: { send: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    bot = { send: vi.fn().mockResolvedValue({ message_id: 42 }) };

    module = await Test.createTestingModule({
      providers: [
        SchedulerService,
        StateStore,
        RepeatEngineService,
        ReminderTypeRegistry,
        MedicationHandler,
        { provide: BotGateway, useValue: bot },
        { provide: ConfigLoaderService, useValue: buildConfigService({ timezone: 'Europe/Kyiv' }) },
        { provide: SchedulerRegistry, useValue: { addCronJob: vi.fn() } },
      ],
    }).compile();

    scheduler = module.get(SchedulerService);
    state = module.get(StateStore);
    module.get(ReminderTypeRegistry).register(module.get(MedicationHandler));
  });

  it('записує state.markActive після успішного send', async () => {
    const reminder = buildReminder({ id: 'r1', times: ['08:00'] });
    await scheduler.fire(123, reminder);

    expect(bot.send).toHaveBeenCalledOnce();
    expect(state.get(123, 'r1')).toMatchObject({ messageId: 42, retryAttempt: 0 });
  });

  it('пропускає fire, якщо reminder expired', async () => {
    const expiredReminder = buildReminder({ endDate: '2020-01-01' });
    await scheduler.fire(123, expiredReminder);

    expect(bot.send).not.toHaveBeenCalled();
    expect(state.get(123, expiredReminder.id)).toBeUndefined();
  });
});
```

**Integration — RepeatEngine з fake timers:**

```ts
// reminders/repeat-engine.service.spec.ts
describe('RepeatEngineService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('викликає bot.send через intervalMs', async () => {
    // ... setup ...
    state.markActive(123, 'r1', {
      fireTs: Date.now(),
      messageId: 1,
      retryAttempt: 0,
      maxRetries: 3,
      intervalMs: 15 * 60_000,
    });
    repeat.scheduleNext(123, reminder);

    await vi.advanceTimersByTimeAsync(15 * 60_000);

    expect(bot.send).toHaveBeenCalledOnce();
    expect(state.get(123, 'r1')!.retryAttempt).toBe(1);
  });

  it('зупиняється на maxRetries і чистить state', async () => {
    // attempt = 3, max = 3
    state.markActive(123, 'r1', { ...defaults, retryAttempt: 3, maxRetries: 3 });
    repeat.scheduleNext(123, reminder);

    await vi.advanceTimersByTimeAsync(15 * 60_000);

    expect(bot.send).not.toHaveBeenCalled();
    expect(state.get(123, 'r1')).toBeUndefined();
  });
});
```

### Vitest конфіг

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';

export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    coverage: {
      reporter: ['text', 'html'],
      exclude: ['**/*.spec.ts', '**/main.ts', '**/*.module.ts'],
    },
  },
});
```

`unplugin-swc` потрібен, щоб vitest коректно обробляв NestJS-декоратори (`reflect-metadata`).

### Environment та запуск

**Файли:**

`.env.example` (комітається):
```env
TELEGRAM_BOT_TOKEN=your_bot_token_from_botfather
LOG_LEVEL=info
NODE_ENV=development
```

`.env` (у `.gitignore`):
```env
TELEGRAM_BOT_TOKEN=1234567890:ABCDEFG...
LOG_LEVEL=debug
NODE_ENV=development
```

`.gitignore` додає `.env`, `state.json` (якщо колись з'явиться), `node_modules`, `dist`, `coverage`.

**package.json scripts:**

```json
{
  "scripts": {
    "start": "node dist/main.js",
    "start:dev": "nest start --watch",
    "start:debug": "nest start --debug --watch",
    "build": "nest build",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:cov": "vitest run --coverage",
    "lint": "eslint 'src/**/*.ts' --fix",
    "format": "prettier --write 'src/**/*.ts'"
  }
}
```

NestJS CLI автоматично підтягує `.env` через `dotenv` при `nest start`. У `main.ts` нічого додаткового не потрібно.

### `main.ts` — bootstrap

```ts
// main.ts
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { registerGlobalErrorHandlers } from './shared/error-handlers';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));

  registerGlobalErrorHandlers(app.get(Logger));

  app.enableShutdownHooks(); // щоб OnModuleDestroy спрацював на SIGINT/SIGTERM

  await app.init(); // bot стартує всередині OnApplicationBootstrap
}

bootstrap();
```

> Без `app.listen()` — у нас немає HTTP-сервера, лише Telegram long-polling. `app.init()` достатньо.

### Покрокова інструкція першого запуску

1. **Створити бот:** написати [@BotFather](https://t.me/BotFather) у Telegram → `/newbot` → отримати токен.
2. **Дізнатись свій `telegramId`:** написати [@userinfobot](https://t.me/userinfobot) — він поверне число.
3. **Клонувати + установити:**
   ```bash
   git clone <repo-url> telegram-bot && cd telegram-bot
   npm install
   ```
4. **Налаштувати `.env`:**
   ```bash
   cp .env.example .env
   # відредагувати .env, вставити TELEGRAM_BOT_TOKEN
   ```
5. **Створити `config.json`** у корені проєкту за прикладом з Секції 2. Вказати свій `telegramId` і потрібні `reminders`.
6. **Запустити:**
   ```bash
   npm run start:dev
   ```
   Має вивестись щось на кшталт `Scheduled 4 reminders for 1 users`.
7. **Перевірка:** написати `/start` боту → отримати привітання. `/next` → побачити розклад на сьогодні. Чекати найближчого `time` — мають прийти inline-кнопки.

### Що буде наступним кроком після цього дизайну

Після затвердження документа — переходимо до **writing-plans skill** для розбиття на атомарні задачі імплементації (модуль за модулем, з визначеними DoD і порядком).
