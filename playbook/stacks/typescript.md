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
- An `index.ts` that re-exports `*` from many files → replace it with explicit named exports of the names that outside code really uses.
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

1. Move a cohesive group of functions to a new file in a `lib/` subfolder.
2. In the old file, re-export the moved names with `export { a, b } from './lib/x'`.
3. Keep every name, every default export and every `export type` exactly as before.
4. Run the checks. Then update in-repo imports in a later change if you want to remove the re-export.

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
