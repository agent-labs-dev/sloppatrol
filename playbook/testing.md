# Testing

Tests are the oracle of every refactor. A good test fails only when real behaviour breaks, and it passes through every refactor that keeps the behaviour.

## Test through the interface

- The interface is the test surface. A test calls the module the way a caller does and asserts on what a caller can observe: return values, persisted state read back through the interface, emitted events, rendered output, HTTP responses, exit codes.
- Never assert on which internal function ran, how many times, or in which order, when an observable outcome exists.
- Never test private functions. If a private function needs its own test, it is a module that wants its own interface.
- Name a test for the behaviour: "an expired card is declined", not "calls validateCard".
- Expected values come from an independent source: a literal, a worked example, the spec. A test that recomputes the expected value the way the code does can never fail.

## Fakes, not mocks

A mock library patches a module from the outside and freezes its current internal contract. A fake is a small, real implementation of a port, injected through the seam.

- Do not use mocking libraries (`jest.mock`, `vi.mock`, `sinon`, `unittest.mock.patch`, `monkeypatch`, `gomock`, `Mockito`, `MockK`, `mockall`) for code the team owns.
- Inject a fake through the seam: an in-memory repository, a fixed clock, a recorded mailer, a scripted HTTP adapter.
- A fake behaves like the real adapter for the cases the tests use. An in-memory repository returns what was saved. A fake does not assert; the test asserts on outcomes.
- Keep each fake next to its port, so every test and every caller shares one fake.
- For local dependencies that have a real stand-in (SQLite, PGlite, a temp folder, a local git repo, a real child process), prefer the real stand-in to a fake.
- For a true external system (a payment provider, an email API), put a port in front of it. Tests use a fake adapter. Only the adapter's own contract test talks to the real thing.

```ts
// The port belongs to the consumer.
export interface Payments { charge(card: Card, amount: Money): Promise<Receipt> }

// Production adapter.
export class StripePayments implements Payments { /* ... */ }

// Fake, next to the port.
export class FakePayments implements Payments {
  readonly charges: { card: Card; amount: Money }[] = [];
  async charge(card: Card, amount: Money) { this.charges.push({ card, amount }); return { id: `r${this.charges.length}` }; }
}

// The test injects the fake and asserts on outcomes.
test('checkout charges the cart total', async () => {
  const payments = new FakePayments();
  const order = await checkout(cart([book(10), pen(2)]), { payments });
  expect(order.status).toBe('paid');
  expect(payments.charges).toEqual([{ card: testCard, amount: money(12) }]);
});
```

## From mocks to fakes, safely

Sloppatrol never changes source and tests in one refactor. Move a test from a mock to a fake in two refactors:

1. `inject-dependency` (source only): add a parameter for the dependency, with the current concrete value as the default. Existing tests and callers do not change and still pass.
2. `replace-mock` (tests only): pass a fake through the new parameter and delete the mock. The unchanged source proves the new test is right. Every behaviour the old test pinned stays pinned.

## Characterize before you refactor

Code without tests has no oracle. Before a source refactor of such code, add `characterize` tests (tests only): they pin what the code does today, including odd cases. Because the source does not change, a passing characterization test is by definition true.

## Rules for every test change

- Never remove a test case. Tests can move, merge or change shape. Each behaviour they pinned stays pinned.
- Never loosen an assertion (`toEqual` to `toBeDefined`, an exact value to a range, a list to its length).
- Never skip, focus or mark a test as expected to fail.
- Keep tests deterministic: inject the clock, the random source and the ids. No sleeps; wait on a condition.
- A test cleans up everything it starts: processes, servers, temp files.
