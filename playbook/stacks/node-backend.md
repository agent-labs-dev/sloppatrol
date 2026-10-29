# Node backend

Use this page for server code in Node with TypeScript or JavaScript: HTTP APIs, workers, queues and jobs. Read `typescript.md` as well.

## Shape

- Use three layers. Each is a module with a small interface.
  - **Handler**: parses the request, calls one domain function, maps the result to a response. About 20 lines.
  - **Domain module**: owns the business rules. It knows nothing about HTTP, the framework or SQL.
  - **Repository and other adapters**: implement ports that the domain module defines. They hold SQL, ORM calls, queue clients and third-party SDKs.
- The domain module owns its ports. Write each port in the domain's words: `orders.findOpenByCustomer(id)`, not `query(sql)`.
- A repository port is a real seam. It has two adapters: the database adapter and an in-memory fake.
- Build the domain module with a factory: `createOrders({ orders: OrderRepo, payments: Payments, clock: Clock })`.
- Wire everything in one composition root (`src/main.ts` or `src/app.ts`). It reads config, opens pools, builds adapters, builds domain modules, and registers routes.
- Parse config once at startup into a typed object. Validate it there. Pass slices of it down. No other file reads `process.env`.
- Own transactions in the domain module's interface, not in handlers. Use a unit-of-work port: `tx.run(async (repos) => { ... })`. The database adapter opens a real transaction. The fake runs the callback directly.
- Keep handler files thin. Keep domain files under about 300 lines. Split a route file that registers many unrelated resources into one file per resource.

## Look for

- A handler over about 40 lines with SQL, validation and business rules → extract the rules into a domain function, then the SQL into a repository.
- `req`, `res`, `ctx` or framework types passed into domain code → pass plain typed values in, and return a result value out.
- `db.query(`, `prisma.`, `knex(`, `drizzle` calls outside repository files → move them behind a repository method with a domain name.
- A module-level singleton import (`import { db } from '../db'`) used inside domain code → inject the dependency through the factory.
- `process.env.` outside the config module → read it in config, pass the typed value in.
- `new Date()`, `Date.now()`, `randomUUID()` in domain rules → inject `clock` and `ids` ports.
- `res.status(500)` scattered across handlers with different shapes → map domain errors to responses in one place.
- A domain function that throws HTTP errors (`throw new NotFoundError(404)`) → raise this as a finding. Do not change error types in a refactor.
- A transaction opened in a handler and passed through many calls → move it behind a unit-of-work port in the domain module.
- One god route file over about 1000 lines → split by resource. Keep the same paths, methods and middleware order.
- `jest.mock('../repositories/orders')` or `vi.mock('../db')` → pass an in-memory repository through the factory.
- Tests that spin up the whole app to check one rule → test the domain module through its factory with fakes.

## Safe moves

Extract a domain function from a handler:

1. Copy the business rules into a function that takes plain values and its dependencies as parameters.
2. Keep the same order of reads, writes and external calls.
3. Make the handler call the new function. Keep the same status codes, headers and body shape.

Introduce a repository port:

1. Write the port type from the queries the code runs today. One method per query, named in domain words.
2. Write the database adapter. Move each query into it unchanged: the same SQL, the same parameters, the same ordering.
3. Add the repository as an optional factory or function parameter, with the database adapter as the default.
4. Run the checks. Wire the adapter in the composition root in a later change.

Split a route file:

1. Move a group of routes to a new file that exports a `register(router, deps)` function.
2. Call it from the old file at the same place, so middleware and route order stay the same.

Traps that change behaviour silently:

- Route registration order. Express and Fastify match in order. `/users/me` before `/users/:id` matters.
- Middleware order. Auth, body parsing and error handlers depend on their position.
- Await and transactions. A query moved out of the `tx` callback runs outside the transaction.
- Unawaited promises. A dropped `await` lets the response go out before the write completes.
- Connection pools. Each `new Pool()` opens new connections. Build adapters once, in the composition root.
- Error handler signature. Express detects error middleware by its 4 parameters. Do not remove the unused `next`.
- Module import side effects. Files that register models or plugins at import time must still be imported in the same order.

## Tests

Test the domain module through its factory. Pass in-memory adapters. Test each repository adapter once against a real test database (Docker or PGLite) with the same contract tests that the fake passes.

```ts
// port, in orders/ports.ts
export type OrderRepo = {
  get(id: OrderId): Promise<Order | undefined>;
  save(order: Order): Promise<void>;
};

// production adapter, in orders/lib/pg-order-repo.ts
export const pgOrderRepo = (sql: Sql): OrderRepo => ({
  async get(id) { const [row] = await sql`select * from orders where id = ${id}`; return row && toOrder(row); },
  async save(o) { await sql`insert into orders ${sql(toRow(o))} on conflict (id) do update set ${sql(toRow(o))}`; },
});

// in-memory fake, in orders/tests/fakes.ts
export function memoryOrderRepo(seed: Order[] = []): OrderRepo {
  const rows = new Map(seed.map((o) => [o.id, structuredClone(o)]));
  return {
    async get(id) { const o = rows.get(id); return o && structuredClone(o); },
    async save(o) { rows.set(o.id, structuredClone(o)); },
  };
}

// test
test('cancel marks an open order as cancelled', async () => {
  const orders = createOrders({ orders: memoryOrderRepo([openOrder]), clock: fixedClock(t0) });
  await orders.cancel(openOrder.id);
  expect((await orders.get(openOrder.id))?.status).toBe('cancelled');
});
```

- Clone in the fake. A fake that returns shared references hides bugs that the database would expose.
- Run one shared contract test suite against both the fake and the real adapter. That keeps the fake honest.
- Test handlers with a few HTTP-level tests through the real router and fake domain dependencies.
- Use a fake adapter for third-party APIs (Stripe, email). Use HTTP-level stubs only to test the adapter itself.

## Never

- Never change route paths, HTTP methods, status codes, headers or response body field names.
- Never change SQL semantics: filters, ordering, limits, locking clauses or isolation levels.
- Never move a read or write into or out of a transaction.
- Never change the order of external calls (charge, then email).
- Never change error classes, error codes or messages that clients or logs parse.
- Never change config key names or environment variable names.
- Never change database column names, table names or migrations in a refactor.
- Never swallow an error or add a catch that logs and continues.
- Never add `@ts-ignore`, `any` or `eslint-disable`.
- Never edit source and tests in the same refactor.
