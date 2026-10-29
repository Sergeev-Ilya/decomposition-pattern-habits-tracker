# auth-service — схема БД

**База:** `ritm_auth`, отдельный PostgreSQL и именованный том `auth_data`. Сервис не читает БД привычек. Контракт: [api.yaml](api.yaml); решения: [architecture.md](../architecture.md).

UUID PK, `snake_case`, `timestamptz` для времени и `created_at`/`updated_at` на всех таблицах. API преобразует имена в camelCase и даты — в UTC RFC 3339. Пароль и JWT никогда не возвращаются в JSON.

## Таблицы

### `users`

| Поле | Тип | Ограничения / назначение |
|---|---|---|
| `id` | uuid | PK, DEFAULT gen_random_uuid() |
| `email` | varchar(254) | NOT NULL, UNIQUE; trim + lowercase до валидации и записи |
| `password_hash` | text | NOT NULL; версия, параметры scrypt, соль и результат |
| `time_zone` | varchar(100) | NOT NULL; IANA-зона браузера, проверенная runtime при регистрации, неизменяемая |
| `created_at` | timestamptz | NOT NULL DEFAULT now() |
| `updated_at` | timestamptz | NOT NULL DEFAULT now() |

CHECK `email = lower(btrim(email)) AND char_length(email) > 0`; формат email проверяет приложение. Уникальный индекс `users_email_key` защищает от конкурентной регистрации одинакового нормализованного email. Ошибка unique constraint переводится в `409 EMAIL_TAKEN` без утечки SQL.

Пароль при регистрации — 8–128 Unicode-кодовых точек; при входе 1–128. Пробелы и регистр сохраняются; обязательных классов символов нет. Граница общего JSON-тела — 16 KiB. Эти технические пределы должны одинаково проверяться frontend и backend; пароль до хеширования не усекается.

Формат хеша: `scrypt$131072$8$1$<salt-base64>$<derived-key-base64>`, где соль — 16 случайных байт, результат — 64 байта. Вычисление использует `N=131072`, `r=8`, `p=1`, `maxmem=256 MiB` из архитектуры. При проверке параметры читаются из формата с разрешёнными пределами и результат сравнивается через `timingSafeEqual`; неизвестная версия или повреждённый хеш не трактуются как успешный вход. Хеш, пароль и его части не логируются.

### `sessions`

| Поле | Тип | Ограничения / назначение |
|---|---|---|
| `id` | uuid | PK, DEFAULT gen_random_uuid(); JWT claim `sid` |
| `user_id` | uuid | NOT NULL, FK users(id) ON DELETE CASCADE внутри этой БД; JWT `sub` |
| `expires_at` | timestamptz | NOT NULL, то же мгновение, что JWT `exp` |
| `revoked_at` | timestamptz | NULL до отзыва; NOT NULL после выхода |
| `created_at` | timestamptz | NOT NULL DEFAULT now() |
| `updated_at` | timestamptz | NOT NULL DEFAULT now() |

CHECK `expires_at > created_at`; CHECK `revoked_at IS NULL OR revoked_at >= created_at`. Индекс `sessions_user_id_idx` по `user_id`; индекс `sessions_expires_at_idx` по `expires_at`. Активность определяется запросом `id = sid AND user_id = sub AND revoked_at IS NULL AND expires_at > server_now`. Частичный индекс с условием `now()` не создаётся. JWT в БД не хранится.

## Транзакции и ответы API

1. **Регистрация:** нормализация/валидация email, проверка IANA-зоны и длины пароля; scrypt вне транзакции; вставка `users`. Возвращается `201 {user}` без сессии и Set-Cookie. Email/timeZone/password не изменяются отдельными API.
2. **Вход:** поиск email, сравнение хеша; неизвестный email и неверный пароль дают одинаковый `401 INVALID_CREDENTIALS`. Для неизвестного email выполняется scrypt с тем же профилем, чтобы убрать очевидный быстрый путь. Создаётся `sessions`; время округляется до целых секунд и используется одновременно для `created_at`, JWT `iat`, `expires_at = created_at + interval '7 days'` и JWT `exp`. После успешного коммита выдаётся cookie; транзакционный сбой не выдаёт рабочую сессию.
3. **Чтение сессии:** строго проверяются HS256, подпись, `iss=ritm-auth`, `aud=ritm-app`, целочисленные `iat`/`exp`, UUID `sub`/`sid` и активная строка сессии с существующим пользователем. JWT не подтверждает доступ без БД. Ответ: `{user: {id,email,timeZone,createdAt}, expiresAt}`.
4. **Внутренняя проверка:** `POST /internal/sessions/verify`, заголовок `X-Service-Key`, тело `{token}`. Сначала проверяется отдельный `INTERNAL_SERVICE_KEY`, затем та же полная проверка сессии. Возвращаются `{userId,sessionId,timeZone,expiresAt}`. Email/хеш не передаются. Gateway этот путь не маршрутизирует.
5. **Выход:** для действительного JWT строка текущей сессии обновляется атомарно: `revoked_at = COALESCE(revoked_at, server_now)`, `updated_at` меняется при первом отзыве. Другие сессии не затрагиваются. Отсутствующий/некорректный/истёкший JWT и уже отсутствующая/отозванная сессия допускают идемпотентный `204`; cookie очищается. Сбой БД при необходимой проверке или отзыве даёт `503`, а не успешный выход.

Все публичные POST проверяют точный `Origin = APP_ORIGIN`, включая регистрацию/вход/выход. Непустой body требует JSON, неизвестные поля отклоняются. Внутренний POST использует service-key вместо Origin. Общая ошибка: `{error:{code,message,details?},requestId}`; requestId — UUID. Неверный Origin — `403 ORIGIN_FORBIDDEN`, неактивная сессия — `401 UNAUTHENTICATED`, недоступность БД — `503 SERVICE_UNAVAILABLE`.

Cookie `ritm_session`: `HttpOnly; SameSite=Lax; Path=/; Max-Age=604800`, без Domain. Для выбранного localhost HTTP `Secure=false`; вне локального режима требуется HTTPS и `Secure=true`. При очистке сохраняются те же cookie-атрибуты и задаётся `Max-Age=0` либо Expires в прошлом. TTL не продлевается чтением; refresh-token нет. На ответах auth — `Cache-Control: no-store`.

## Миграции и готовность

1. `001_init.sql` — `users`, `sessions`, ограничения и индексы. Приложение версионирует применённые миграции; повторный запуск не очищает таблицы и не создаёт demo-пользователя.
2. Signing secret и `INTERNAL_SERVICE_KEY` генерируются для локального окружения и сохраняются в игнорируемой конфигурации между запусками. Их замена не выполняется автоматически при рестарте.
3. `GET /health` даёт `200 {status:"ok",service:"auth-service"}` только после миграций и успешного обращения к собственной PostgreSQL; иначе `503` в стандартном формате ошибок.

Истёкшие и отозванные строки сессий могут оставаться в БД: они не дают доступ. Фоновая очистка не требуется для MVP. Временные значения в тестах задаются серверными внедряемыми часами, а не полями публичного API.

## Межсервисные ссылки

`users.id` используется habits-service как логический UUID владельца без FK и join через границу БД. Никакой таблицы привычек или копии персонального профиля здесь нет. Профиль и подтверждённый часовой пояс передаются только через описанную HTTP-проверку сессии. Брокер, outbox, почтовая инфраструктура и общий DB-user не используются.
