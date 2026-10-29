# Go

Use this page for Go code: servers, CLIs and libraries.

## Shape

- A module is a package. Its exported identifiers are its interface. Keep that set small.
- Put implementation that no outside code needs under `internal/`. The compiler then enforces the seam.
- Name packages for what they provide (`billing`, `orders`), not for what they contain (`utils`, `models`, `helpers`).
- Define an interface in the package that consumes it, not in the package that implements it. Keep it to the methods that the consumer calls, often one or two.
- Accept interfaces, return concrete structs. A constructor `NewOrders(repo OrderRepo, clock Clock) *Orders` returns a struct.
- Inject dependencies through constructor parameters or struct fields set by the constructor. Do not use package-level variables for dependencies.
- Wire everything in `main` (or `cmd/<app>/main.go` plus a small `run()` function). It reads flags and env, builds adapters, builds domain structs, and starts the server.
- Keep HTTP handlers thin. A handler decodes, calls one method, encodes.
- Keep files under about 500 lines. Split a file by concern inside the same package. That has no effect on the package interface.

## Look for

- A package named `utils`, `common` or `helpers` → move each function to the package that uses it, or to a package named for its purpose.
- A large interface in the producer package (`type Store interface` with 15 methods) next to its one implementation → define small interfaces at each consumer instead.
- An interface with one implementation and no test fake → apply the deletion test. Remove it, or add the fake that makes it a real seam.
- `http.DefaultClient`, `sql.Open(`, `os.Getenv(` inside domain code → pass the dependency or value in through the constructor.
- `time.Now()`, `rand.`, `uuid.New()` in rules → inject a `Clock` or a `func() time.Time` field, defaulted in the constructor.
- Package-level `var db *sql.DB` set in `init()` → pass it to constructors from `main`.
- `init()` functions with effects beyond registration → raise this as a finding. Do not move them in a refactor.
- Handlers with SQL and business rules inline → extract a domain method, then a repository.
- `gomock`, `mockery` or `testify/mock` mocks of the team's own interfaces → write a small hand-written fake.
- Functions over about 80 lines with deep nesting → extract helpers with early returns. Keep the same error paths.
- Exported struct fields that callers never set → raise this as a finding. Unexporting changes the interface.

## Safe moves

Introduce DI without a change in behaviour:

1. Add a field for the dependency to the struct. Keep the existing constructor signature.
2. Set the field to the current concrete value in the constructor.
3. Use the field in place of the direct call.
4. Add a second constructor or an option function (`WithClock(c)`) for tests and for `main`. Every existing caller still compiles.

```go
type Orders struct{ repo OrderRepo; now func() time.Time }
func NewOrders(repo OrderRepo) *Orders { return &Orders{repo: repo, now: time.Now} }
```

Narrow a dependency to a consumer interface:

1. In the consumer package, declare an interface with only the methods it calls.
2. Change the parameter type from the concrete struct to that interface.
3. Callers still pass the concrete struct. It satisfies the interface implicitly.

Split a file: move functions to a new file in the same package. The package interface does not change.

Traps that change behaviour silently:

- Nil interface vs nil pointer. A nil `*T` stored in an interface is not `== nil`. Do not change a return type from `*MyErr` to `error` without care.
- Value vs pointer receivers. Changing a receiver kind changes which types satisfy an interface and whether mutations are visible.
- Struct copies. Passing a struct by value copies it. A `sync.Mutex` inside must never be copied.
- Loop variables. Before Go 1.22, closures in a loop share one variable. Check the `go` directive in `go.mod`.
- `defer` order. Defers run last in, first out, at function return, not at block end. Moving code into a helper moves its defers.
- `init()` order. It follows file name order and import order within a package. Do not rename files that contain `init()`.
- Error wrapping. `fmt.Errorf("%v")` and `fmt.Errorf("%w")` differ for `errors.Is` and `errors.As`.
- Map iteration order is random. Do not rely on it in moved code.

## Tests

Use table tests through the package's exported interface. Pass hand-written fakes that satisfy the consumer's interface.

```go
// port, in orders/orders.go (the consumer)
type OrderRepo interface {
	Get(ctx context.Context, id string) (Order, error)
	Save(ctx context.Context, o Order) error
}

// production adapter, in orders/internal/pgrepo
type PGRepo struct{ db *sql.DB }
func (r *PGRepo) Get(ctx context.Context, id string) (orders.Order, error) { /* select ... */ }
func (r *PGRepo) Save(ctx context.Context, o orders.Order) error           { /* upsert ... */ }

// in-memory fake, in orders/fake_test.go
type memRepo struct{ rows map[string]Order }
func (m *memRepo) Get(_ context.Context, id string) (Order, error) {
	o, ok := m.rows[id]
	if !ok { return Order{}, ErrNotFound }
	return o, nil
}
func (m *memRepo) Save(_ context.Context, o Order) error { m.rows[o.ID] = o; return nil }

// test
func TestCancel(t *testing.T) {
	tests := []struct{ name string; start Status; want Status; wantErr error }{
		{"open order is cancelled", Open, Cancelled, nil},
		{"shipped order is refused", Shipped, Shipped, ErrNotCancellable},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			repo := &memRepo{rows: map[string]Order{"o1": {ID: "o1", Status: tt.start}}}
			err := NewOrders(repo).Cancel(context.Background(), "o1")
			if !errors.Is(err, tt.wantErr) { t.Fatalf("err = %v, want %v", err, tt.wantErr) }
			if got := repo.rows["o1"].Status; got != tt.want { t.Fatalf("status = %v, want %v", got, tt.want) }
		})
	}
}
```

- Test the real database adapter against a real database (testcontainers or a local Postgres), in a separate package or behind a build tag.
- Use `httptest.Server` to test an HTTP client adapter. Use a fake adapter everywhere else.
- Run tests with `-race` when the code under test uses goroutines.

## Never

- Never rename, remove or change the signature of an exported identifier that other packages use.
- Never move a package or change its import path.
- Never change sentinel errors, error types, `%w` wrapping or error strings that callers match.
- Never change struct tags (`json:`, `db:`, `yaml:`) or exported field names that are serialized.
- Never change a value receiver to a pointer receiver, or the reverse.
- Never reorder `defer` statements, `init()` functions or goroutine start order.
- Never drop an error with `_ =` or an empty `if err != nil {}`.
- Never add `//nolint`, `//lint:ignore` or build tags to hide a check.
- Never edit source and tests in the same refactor.
