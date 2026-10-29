# Ритм — API gateway

Stateless Express + TypeScript gateway. Контракт — [docs/api-gateway.yaml](../../docs/api-gateway.yaml). База данных и JWT signing secret ему не нужны: доменные сервисы проверяют сессии самостоятельно.

Разрешены только контрактные публичные маршруты и методы. `/internal/*`, неизвестные пути и методы возвращают JSON 404. Gateway выдаёт новый UUID request ID, проверяет Origin изменяющих запросов и JSON размером до 16 KiB. Пересылаются только cookie, Origin, Content-Type и новый X-Request-Id; клиентские заголовки идентичности и hop-by-hop заголовки не передаются. JSON отправляется upstream без изменения байтов. Cookie ответа сохраняются отдельными Set-Cookie.

Upstream timeout — 5 секунд, readiness — 2 секунды, повторов нет. Redirect, HTML, повреждённый JSON, недоступный upstream и неожиданные статусы дают безопасный 503. `/health` даёт 200 только после подтверждения готовности обоих сервисов. Публичного `/api/auth/me` нет — используется `/api/auth/session`.

```bash
npm install
npm run build
npm test
```

Для отдельного запуска задайте значения из `.env.example` и выполните `npm start`. Для полного локального приложения используйте [инструкцию запуска](../../docs/run-local.md). Секреты, пароли и cookie не логируются.
