# Rust

Use this page for Rust code: binaries, libraries and workspaces.

## Shape

- A module is a crate or a `mod` with a small public surface. Everything is private by default. Make an item `pub` only when outside code needs it.
- Use `pub(crate)` for items that other modules in the crate share. Keep the crate root (`lib.rs`) as the list of public entry points.
- Split a large crate into a workspace of crates when parts change for different reasons. Each crate is a deep module.
- Define ports as traits in the module that consumes them. Keep each trait to the calls that the consumer makes.
- Inject dependencies through constructor parameters. Prefer generics (`Orders<R: OrderRepo>`) for hot paths. Use `Box<dyn OrderRepo>` or `Arc<dyn OrderRepo>` when the type must stay simple.
- Keep pure logic free of I/O. Functions take borrowed data in and return owned results out. That is easy to test and easy on the borrow checker.
- Wire everything in `main` (or a `run(config)` function that `main` calls). It parses config, builds adapters and starts the runtime.
- Use one error enum per library module with `thiserror`. Use `anyhow` only in binaries.
- Keep files under about 500 lines. A module over that size becomes a folder with `mod.rs` or `name.rs` plus submodules.

## Look for

- `reqwest::Client::new()`, `std::fs::`, `sqlx::query` inside domain functions → move the call into an adapter behind a trait.
- `std::env::var` below `main` → read config once and pass a typed struct down.
- `SystemTime::now()`, `Instant::now()`, `rand::thread_rng()`, `Uuid::new_v4()` in logic → inject a clock or generator trait.
- `lazy_static!` or `OnceLock` globals that hold clients → build the client in `main` and pass it in.
- `pub` on items that no other module uses → raise this as a finding. Narrowing visibility in a library is a breaking change.
- `.clone()` used to fight the borrow checker in a long function → split the function so borrows end sooner. Keep the same results.
- A function over about 80 lines that mixes parsing, logic and I/O → extract the pure parts first.
- `Box<dyn Error>` or `String` errors in library code → raise this as a finding. Changing error types changes the interface.
- A trait with one implementation and no test fake → apply the deletion test. Remove it, or add the fake.
- `mockall` mocks of the team's own traits → write a small fake struct that implements the trait.
- A `match` on the same enum in many modules → move the logic into methods on the enum.

## Safe moves

Introduce DI without a change in behaviour:

1. Define a trait with the methods that the code calls today, with the same signatures.
2. Implement the trait for the current concrete type. Change no code in that type.
3. Add a generic parameter or a trait-object field to the consumer.
4. Keep the old constructor. Make it build the consumer with the current concrete type. Add a second constructor `with_repo(repo)` for tests and for `main`.

```rust
pub struct Orders<R: OrderRepo = PgOrderRepo> { repo: R }
impl Orders<PgOrderRepo> { pub fn new(pool: PgPool) -> Self { Self { repo: PgOrderRepo::new(pool) } } }
impl<R: OrderRepo> Orders<R> { pub fn with_repo(repo: R) -> Self { Self { repo } } }
```

Split a module without a change to its public paths:

1. Move items into a new submodule file.
2. In the parent, add `pub use self::new_mod::{ItemA, ItemB};` with the same visibility as before.
3. Run `cargo check` and `cargo doc`. Public paths must still resolve.

Traps that change behaviour silently:

- Drop order. Locals drop in reverse order of declaration. Struct fields drop in declaration order. Reordering fields or `let`s changes when locks, files and guards release.
- Temporaries in `match` and `if let`. A guard from `mutex.lock()` in the scrutinee lives to the end of the whole expression.
- Generics vs trait objects. `dyn Trait` needs object safety and changes `Send`/`Sync` bounds. Adding a bound can break callers.
- Auto traits. A new field that is not `Send` or `Sync` makes the whole type lose them. Futures that hold it across `.await` stop being `Send`.
- `#[derive]` changes. Adding or removing `Clone`, `PartialEq`, `Hash`, `Default` or `Debug` changes the interface and can change behaviour.
- Feature flags. Moving code under or out of `#[cfg(feature = ...)]` changes what compiles for each feature set.
- Integer arithmetic. Debug builds panic on overflow. Release builds wrap. Do not change `+` to `wrapping_add` or the reverse.

## Tests

Test through the module's public functions. Pass fake trait implementations through the constructor. Put fakes in a `#[cfg(test)]` module, or in a `test-support` feature when other crates need them.

```rust
// port
pub trait OrderRepo {
    fn get(&self, id: OrderId) -> Result<Option<Order>, RepoError>;
    fn save(&mut self, order: &Order) -> Result<(), RepoError>;
}

// production adapter
pub struct PgOrderRepo { pool: PgPool }
impl OrderRepo for PgOrderRepo {
    fn get(&self, id: OrderId) -> Result<Option<Order>, RepoError> { /* select ... */ }
    fn save(&mut self, order: &Order) -> Result<(), RepoError> { /* upsert ... */ }
}

// in-memory fake
#[cfg(test)]
#[derive(Default)]
pub struct MemOrderRepo { pub rows: HashMap<OrderId, Order> }
#[cfg(test)]
impl OrderRepo for MemOrderRepo {
    fn get(&self, id: OrderId) -> Result<Option<Order>, RepoError> { Ok(self.rows.get(&id).cloned()) }
    fn save(&mut self, order: &Order) -> Result<(), RepoError> { self.rows.insert(order.id, order.clone()); Ok(()) }
}

// test
#[test]
fn cancel_marks_open_order_cancelled() {
    let mut orders = Orders::with_repo(MemOrderRepo::default());
    orders.place(open_order()).unwrap();
    orders.cancel(OPEN_ID).unwrap();
    assert_eq!(orders.get(OPEN_ID).unwrap().unwrap().status, Status::Cancelled);
}
```

- Test the real database adapter against a real database with `#[sqlx::test]` or a container, in `tests/`.
- Test HTTP client adapters against a local server such as `wiremock`. Use the fake adapter everywhere else.
- Assert on `matches!(err, OrderError::NotCancellable { .. })`, not on error strings, unless the string is the contract.

## Never

- Never rename, remove or change the signature of a `pub` item that other crates use.
- Never narrow or widen visibility of public items in a library crate.
- Never add or remove `#[derive]` traits, `Send`/`Sync` bounds or `#[non_exhaustive]` on public types.
- Never change error enum variants, `Display` messages or `#[error(...)]` text that callers match.
- Never rename `serde` fields or change `#[serde(rename, tag, default)]` attributes.
- Never reorder struct fields or `let` bindings whose types implement `Drop`.
- Never replace `?` with `.unwrap()`, `.expect()` or `.ok()`. Never discard a `Result` with `let _ =`.
- Never add `#[allow(...)]`, `unsafe` blocks or `#[cfg(test)]` paths that change production code.
- Never edit source and tests in the same refactor.
