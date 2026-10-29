# Swift

Use this page for Swift code on iOS, macOS and other Apple platforms: SwiftUI or UIKit apps, and Swift packages.

## Shape

- A module is a Swift package target or a feature folder with a small public surface. Mark implementation `internal` or `private`. Mark only the interface `public`.
- Split each feature into three layers.
  - **View**: SwiftUI views that render state and send user intents. No networking, no persistence.
  - **Model**: an `@Observable` (or `ObservableObject`) class that owns screen state and logic. It runs on `@MainActor`.
  - **Data**: clients and stores behind protocols.
- Define ports as protocols in the module that consumes them. Keep each protocol to the calls that the consumer makes.
- Inject dependencies through initializers. `OrderModel(orders: OrderStore, clock: Clock)`.
- Wire real adapters in one composition root: the `@main` `App` struct or an `AppDependencies` value that it builds. Pass dependencies down through initializers or one `EnvironmentValues` key.
- Use structs for values. Use classes for identity and shared mutable state. Use actors for shared mutable state that many tasks touch.
- Keep views under about 200 lines. Extract subviews as separate structs. Keep files under about 400 lines.

## Look for

- A SwiftUI view with `URLSession`, `FileManager`, `UserDefaults` or Core Data calls in its body or `.task` → move the calls into the model, then behind a protocol.
- `.shared` singletons (`APIClient.shared`, `Analytics.shared`) used inside models → add an initializer parameter with `.shared` as the default.
- `Date()`, `UUID()`, `Locale.current` in logic → inject a clock or a generator, defaulted to the real one.
- A view model over about 400 lines that owns several screens' state → split it by screen.
- Business rules inside view bodies (`price * Double(qty)` in a `Text`) → move them to a pure function or a computed property on the model.
- A protocol with one conformer and no test fake → apply the deletion test. Remove it, or add the fake.
- A protocol with many requirements that each consumer uses a small part of → split it into consumer-sized protocols.
- `DispatchQueue.main.async` mixed with `async`/`await` → raise this as a finding. Do not change threading in a refactor.
- Mocking frameworks or subclass-and-override mocks of the team's own classes → write a struct or class fake that conforms to the protocol.
- `UIViewController` subclasses over about 500 lines → extract the logic into a plain model class that the controller owns.

## Safe moves

Introduce DI without a change in behaviour:

1. Add an initializer parameter for the dependency. Use the current singleton or concrete value as the default argument.
2. Store it in a `let` property. Use the property in place of the direct reference.
3. Run the checks. Every existing call site still compiles and behaves the same.
4. In a later change, build the real value in the composition root and pass it in.

```swift
@MainActor @Observable final class OrderModel {
    private let orders: OrderStore
    init(orders: OrderStore = APIOrderStore.shared) { self.orders = orders }
}
```

Extract a protocol from a concrete class:

1. Declare a protocol with exactly the methods that the consumer calls, with the same signatures, `async` and `throws`.
2. Add a conformance to the concrete class in an extension. Change no code in the class.
3. Change the consumer's property type to the protocol.

Split a view: move a subtree into a new `struct` view. Pass the same values in. Use `@Binding` where the subtree writes state.

Traps that change behaviour silently:

- Value vs reference semantics. Changing a `struct` to a `class`, or the reverse, changes copy and mutation behaviour everywhere.
- SwiftUI identity. Moving a view across an `if` branch or changing `.id()` resets its `@State`.
- `@State` vs `@StateObject` vs a plain property. The wrong one recreates the model on each render.
- Actor isolation. Moving a function off `@MainActor` or into an actor adds suspension points and changes order.
- `weak` and `unowned` captures. Changing captures can create retain cycles or crashes.
- `deinit` timing. Code that relies on release order breaks when ownership moves.
- `Codable`. Renaming a property changes its coding key unless `CodingKeys` exists.
- Default argument values are part of the call site. A changed default changes behaviour for every caller that omits it.

## Tests

Test the model through its public methods and observable state. Pass fakes through the initializer. Use XCTest or Swift Testing.

```swift
// port
protocol OrderStore: Sendable {
    func order(id: Order.ID) async throws -> Order
    func cancel(id: Order.ID) async throws
}

// production adapter
struct APIOrderStore: OrderStore {
    let http: HTTPClient
    func order(id: Order.ID) async throws -> Order { try await http.get("/orders/\(id)") }
    func cancel(id: Order.ID) async throws { try await http.post("/orders/\(id)/cancel") }
}

// in-memory fake, in the test target
actor FakeOrderStore: OrderStore {
    private(set) var orders: [Order.ID: Order]
    init(_ orders: [Order]) { self.orders = Dictionary(uniqueKeysWithValues: orders.map { ($0.id, $0) }) }
    func order(id: Order.ID) async throws -> Order {
        guard let order = orders[id] else { throw OrderError.notFound }
        return order
    }
    func cancel(id: Order.ID) async throws { orders[id]?.status = .cancelled }
}

// test
@Test @MainActor func userCanCancelAnOpenOrder() async throws {
    let model = OrderModel(orders: FakeOrderStore([.open]))
    await model.load(id: Order.open.id)
    await model.cancelTapped()
    #expect(model.order?.status == .cancelled)
}
```

- Do not test SwiftUI view bodies directly. Test the model. Use snapshot or UI tests only where layout is the behaviour.
- Test the real network adapter with a `URLProtocol` stub. Use the fake adapter everywhere else.
- Do not take focus or launch the app in unit tests.

## Never

- Never change `public` or `open` declarations that other modules use.
- Never change a `struct` to a `class`, or the reverse.
- Never change property names or `CodingKeys` of `Codable` types.
- Never change actor isolation, `@MainActor` annotations or `Sendable` conformances.
- Never change accessibility identifiers, labels or visible text.
- Never change `UserDefaults` keys, Keychain keys or Core Data model names.
- Never replace `try` with `try?` or `try!`. Never add an empty `catch`.
- Never add `// swiftlint:disable`, `@preconcurrency` or `nonisolated(unsafe)` to silence a check.
- Never edit source and tests in the same refactor.
