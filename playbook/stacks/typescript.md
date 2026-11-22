# TypeScript

Use this page for any TypeScript or JavaScript code. Read `react.md` or `node-backend.md` as well when they apply.

## Shape

- A module is a folder with a small set of entry-point files at its root. Implementation lives in subfolders (`lib/`). Tests live in `tests/`.
- Outside code imports only the entry points. A deep import such as `../billing/lib/tax` is a leak.
- Each entry point exports few names. Each name hides a lot of behaviour. Apply the deletion test to every export.
- Prefer several small entry points (`index.ts`, `client.ts`, `server.ts`) to one barrel that re-exports a whole subtree.
- Express the interface in types. Use discriminated unions for states and results. Use branded types for ids and units that callers must not mix.
- Put a port where something really varies: I/O, clock, randomness, a remote system. Write it as a TypeScript `type` or `interface` that the consumer owns.
- Inject ports as function parameters or constructor parameters. A factory such as `createBilling({ payments, clock })` returns the module's interface.
- Wire real adapters in one composition root per entry point: `main.ts`, the server bootstrap, or the app root. Only the composition root reads `process.env` and calls `new` on adapters.
- Keep files under about 300 lines. Keep functions under about 50 lines. Split by responsibility, not by line count.

## Look for

- `any`, `as any`, `as unknown as T` in domain code → type the value at the seam where it enters, then remove the cast.
- `@ts-ignore` or `@ts-expect-error` without a linked reason → find the real type error and fix the type. Keep behaviour the same.
- A deep import across modules (`from '../orders/lib/...'`) → export the needed name from an entry point of that module, then point the import there.
- An `index.ts` that re-exports `*` from many files → point each in-repo importer at the file that defines the name, and keep in the index only the names outside callers use. A barrel loads every module it names on each import.
- `JSON.parse(x) as T`, `x as T`, `x!` on a value from outside → decode it with the schema library the repo already uses, where it enters. A new decode rejects input the cast let through, so it is a refactor only where the value is already decoded upstream and the cast is redundant; otherwise raise it as a finding.
- `throw new Error(result.error)` after a call that returns an error field → let the adapter map it to the repo's typed failure, when the repo has one.
- `catch {}` or `.catch(() => {})` → `.catch(nameThatSaysWhyFailureIsDropped)`, an empty function whose name is the reason.
- `new SomeClient()` or `fetch(` inside a domain function → add a parameter for the dependency, with the current value as the default.
- `process.env.X` read below the composition root → read it once at the root, then pass a typed config value in.
- `Date.now()`, `new Date()`, `Math.random()`, `crypto.randomUUID()` in logic → inject a `clock` or `ids` port with the real one as the default.
- A string or boolean flag that selects behaviour (`mode: 'a' | 'b'`, `isAdmin` passed through 4 layers) → model it as a discriminated union, or split into two functions.
- The same `switch (x.kind)` in many files → move the branches to one module that owns that union.
- Optional fields that are valid only together (`error?`, `data?`) → replace with a discriminated union of states.
- A shallow wrapper that only renames another function → inline it at all call sites, then delete it.
- `jest.mock('./ourModule')` or `vi.mock('../db')` of the team's own code → add a seam and pass a fake.
- A file over about 300 lines that mixes parsing, logic and I/O → extract the pure logic into its own file first.
- A type that is defined twice with the same fields → keep one owner and import it.

## Safe moves

Introduce DI without a change in behaviour:

1. Add an optional parameter for the dependency. Use the current concrete value as the default.
2. Use the parameter inside the function in place of the direct reference.
3. Run the checks. Every existing caller still compiles and behaves the same.
4. In a separate change, move construction of the real value to the composition root. Remove the default only when no caller relies on it.

```ts
// before
export async function sendInvoice(id: InvoiceId) { const mail = new SesMailer(); ... }
// after, step 1: same behaviour for every caller
export async function sendInvoice(id: InvoiceId, mail: Mailer = new SesMailer()) { ... }
```

Split a file without a change to its public exports:

1. Turn the file into a folder named for the concept. Its entry file at the root keeps the public names; the parts go inside. Never leave the old file as an anchor with prefixed siblings beside it.
2. Move a whole cohesive group at a time: every function, type and constant of the concept goes together.
3. Update every in-repo source import in the same change. When the old path cannot become the folder's entry (tests or outside callers import a file path the folder would break), keep the old file as the concept's entry that names its public parts; it is the interface, not a leftover. Never keep a re-export that no caller needs.
4. Keep the package's public entry point (its `exports`, `main` or published `index`) exporting exactly the same names, default and `export type` included: callers outside the repo depend on it.
5. Run the checks.

Language traps that change behaviour silently:

- `this` binding. An extracted method passed as a callback loses `this`. Use an arrow function or bind it, and check every call site.
- Module side effects. A file that registers, patches or reads env at import time runs in import order. Do not move such code, and do not change import order in a file that has side-effect imports.
- Hoisting and circular imports. A move can create a cycle where a value is `undefined` at import time. Check for new cycles after each move.
- `export default` vs named export. Changing one to the other breaks `require()` callers and dynamic `import()` callers.
- `async` changes. Adding `async` to a sync function makes it return a Promise. Removing `await` changes when errors throw and the order of effects.
- `==` vs `===`, `||` vs `??`. Do not "fix" these in a refactor. `0` and `''` take different paths.
- `enum` to union. Numeric enums have a reverse mapping and runtime values. Keep the enum when code uses those values.
- Object spread order. `{ ...a, ...b }` and `{ ...b, ...a }` give different results.
- `JSON.stringify` key order follows insertion order. Do not reorder object literals that are serialized or hashed.

## Tests

Test through the module's entry point. Pass hand-written fakes through the seam. Use `vi.mock`/`jest.mock` only for a third-party module that you cannot inject, and prefer to wrap it in an adapter first.

```ts
// port, owned by the consumer
export type Payments = { charge(customer: CustomerId, cents: number): Promise<ChargeResult> };

// production adapter, in the composition root's reach
export function stripePayments(stripe: Stripe): Payments {
  return { async charge(customer, cents) { /* call stripe, map the result */ } };
}

// in-memory fake, in tests/fakes.ts
export function fakePayments(): Payments & { charges: Array<[CustomerId, number]> } {
  const charges: Array<[CustomerId, number]> = [];
  return { charges, async charge(c, cents) { charges.push([c, cents]); return { kind: 'ok' }; } };
}

// test
test('checkout charges the cart total', async () => {
  const payments = fakePayments();
  const shop = createShop({ payments, clock: fixedClock('2026-01-01') });
  const result = await shop.checkout(cartWith(10_00, 5_00));
  expect(result.kind).toBe('confirmed');
  expect(payments.charges).toEqual([[customerA, 15_00]]);
});
```

- Assert on returned values and on state that the fake records. Do not assert on `toHaveBeenCalledWith` of your own code.
- Keep fakes in `tests/` beside the module. Share one fake per port. Do not write a new stub in each test.
- Use literal expected values. Do not recompute them the way the code does.

## Never

- Never rename, remove or change the type of an exported name that another package or app imports.
- Never change a default export to a named export, or the reverse.
- Never add `any`, `as any`, `@ts-ignore`, `@ts-expect-error`, `eslint-disable` or `// @ts-nocheck`.
- Never change error classes, `error.name`, `error.code` or error messages that callers check.
- Never rename object keys that are serialized, stored, logged for parsing or sent over the network.
- Never reorder side-effect imports or top-level statements with effects.
- Never turn a sync function into an async one, or the reverse.
- Never catch and drop an error. Never turn a rejected Promise into a resolved `undefined`.
- Never edit source and tests in the same refactor.
