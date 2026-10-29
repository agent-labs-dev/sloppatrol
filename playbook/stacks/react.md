# React

Use this page for client apps built with React on the web or React Native / Expo. Read `typescript.md` as well.

## Shape

- Split each screen into three layers. Each layer is a module with its own interface.
  - **View**: components that take props and render. No fetch, no storage, no navigation calls.
  - **Logic**: hooks and plain functions that own state transitions, validation and derived values.
  - **Data**: a client module that talks to the network, storage or device APIs through a port.
- A screen component composes these. It reads a hook, then renders views. It stays short.
- Put pure logic in plain `.ts` files, not in hooks. A hook wraps that logic with React state. You can test the logic with no React at all.
- Give each piece of state one owner. Server data lives in the data layer cache (for example TanStack Query). Form and UI state live in the nearest component that needs it. Global state holds only state that many distant screens share.
- The data layer exposes an SDK-style port: `api.getOrder(id)`, `api.cancelOrder(id)`. Do not expose a generic `request(path, options)`.
- Inject the data port through one React context provider at the app root. The app root is the composition root. Tests render with the same provider and a fake.
- Keep component files under about 250 lines. Keep one exported component per file. Small private subcomponents may stay in the same file.

## Look for

- A component file over about 250 lines that fetches, transforms and renders → extract the transform into a pure function, then the fetch into a hook.
- `fetch(`, `axios.`, `AsyncStorage.`, `localStorage.` inside a component body or `useEffect` → move the call behind the data port.
- `useEffect` that sets state derived from props or other state → compute the value during render, or with `useMemo`.
- The same server data copied into `useState` and kept in sync by hand → read it from the query cache only.
- Prop drilling of the same value through 3 or more layers that do not use it → pass it through a context that the owner provides, or compose with `children`.
- A boolean prop that switches the whole layout (`isCompact`, `variant` with very different trees) → split into two components that share small parts.
- Business rules inside JSX (`price * qty * (1 - discount)` in markup) → move to a named pure function.
- A hook that returns 10 or more values → split it by concern, or return a smaller object that hides the details.
- `jest.mock('../api')` or `jest.mock('../hooks/useOrders')` of the team's own module → render with a provider that holds a fake.
- Tests that assert on `useState` values, class names or snapshot trees → assert on visible text and roles.
- `Platform.OS === 'ios'` checks spread across many files → put the difference behind one module with `.ios.ts` / `.android.ts` files.
- A context value object created inline on each render → keep it as is in a refactor. Changing memoization changes render counts. Raise it as a separate finding.

## Safe moves

Extract a hook from a component:

1. Move the state, effects and handlers into `useThing()` in the same file. Return exactly what the JSX uses.
2. Keep the hook call order identical. Hooks must run in the same order on every render.
3. Run the checks. Move the hook to its own file in a later step.

Extract a pure function:

1. Copy the expression into a named function in a `.ts` file. Give it explicit parameter and return types.
2. Replace the inline expression with a call. Do not change rounding, sort order or locale formatting.

Introduce a data port without a change in behaviour:

1. Define the port type from the calls that the code makes today.
2. Write the production adapter as a thin wrapper that makes the same calls with the same URLs, headers and options.
3. Add a context with the production adapter as its default value. Every existing render path still works with no provider.
4. Replace direct calls with `useApi().getOrder(id)` one call site at a time.

Split a component file without a change to exports:

1. Move a subcomponent to its own file.
2. Keep the original file's default and named exports. Re-export moved names if outside code imports them.

Traps that change behaviour silently:

- Component identity. A component defined inside another component remounts on every render and loses state. Moving it out fixes that, and it changes behaviour. Raise it as a finding, do not do it in a refactor.
- `key` props. Do not change keys. A new key remounts the subtree and resets its state.
- Effect dependencies. Do not add or remove items in a dependency array. That changes when the effect runs.
- `useCallback` and `useMemo`. Adding or removing them changes referential identity and can change effect timing.
- Stale closures. A handler moved into a hook must still read the same state snapshot.
- Conditional hooks. Never move a hook call inside a branch or after an early return.
- Server and client components. Do not move code across a `'use client'` line.

## Tests

Use Testing Library. Render the screen with the real hooks and views, and a fake data port in the provider. Query by role and text. Use `user-event` for input.

```tsx
// port
export type OrdersApi = { getOrder(id: OrderId): Promise<Order>; cancelOrder(id: OrderId): Promise<void> };

// production adapter
export const httpOrdersApi = (http: HttpClient): OrdersApi => ({
  getOrder: (id) => http.get(`/orders/${id}`),
  cancelOrder: (id) => http.post(`/orders/${id}/cancel`),
});

// fake, in tests/fakes.ts
export function fakeOrdersApi(orders: Order[]): OrdersApi {
  const byId = new Map(orders.map((o) => [o.id, { ...o }]));
  return {
    async getOrder(id) { return byId.get(id)!; },
    async cancelOrder(id) { byId.get(id)!.status = 'cancelled'; },
  };
}

// test
test('user can cancel an open order', async () => {
  renderWithApi(<OrderScreen id={orderA.id} />, { orders: fakeOrdersApi([orderA]) });
  await userEvent.click(await screen.findByRole('button', { name: 'Cancel order' }));
  expect(await screen.findByText('Cancelled')).toBeVisible();
});
```

- Test pure logic files with plain unit tests and literal values.
- Mock only what you do not own and cannot inject: native modules, `expo-*` modules with no JS fallback. Prefer a fake adapter behind a port.
- Use MSW only for a true external HTTP API. Do not use it to replace your own data port.

## Never

- Never change props, exported component names or default exports that other files use.
- Never change visible text, accessibility labels, roles or `testID` values.
- Never change `key` values, effect dependency arrays or hook order.
- Never add or remove `memo`, `useMemo` or `useCallback` in a refactor.
- Never change query keys, cache times or storage keys. Stored data and caches depend on them.
- Never move code across `'use client'` or server-only lines.
- Never add `eslint-disable react-hooks/exhaustive-deps` or `@ts-ignore`.
- Never edit components and their tests in the same refactor.
