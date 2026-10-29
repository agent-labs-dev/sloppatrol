# Kotlin

Use this page for Kotlin code on Android and the JVM: Android apps, Ktor or Spring backends, and libraries.

## Shape

- A module is a Gradle module or a package with a small public surface. Mark implementation `internal` or `private`. Kotlin is public by default, so mark it on purpose.
- Split each Android screen into three layers.
  - **UI**: Composables or Fragments that render state and send events. No repositories, no I/O.
  - **ViewModel**: owns screen state as a `StateFlow<UiState>` and handles events. It holds no `Context` or `View`.
  - **Data**: repositories and data sources behind interfaces.
- Define ports as interfaces in the module that consumes them. Keep each to the calls that the consumer makes.
- Use constructor injection for every class. `class OrderViewModel(private val orders: OrderRepository, private val clock: Clock)`.
- Keep Hilt or Koin at the edge. Modules (`@Module`, `module { }`) bind interfaces to adapters. Domain classes take constructor parameters and do not call `get()` or `inject()`.
- The composition root is the Hilt dependency graph or the Koin `startKoin` block, plus `Application.onCreate`. On the backend it is `main` or the Spring configuration.
- Use `data class` for values, `sealed interface` for states and results, `value class` for ids.
- Keep files under about 400 lines. Keep Composables under about 150 lines.

## Look for

- A Composable or Fragment that calls a repository, Retrofit or Room directly → move the call into the ViewModel.
- `GlobalScope.launch` → raise this as a finding. Moving to a scoped launch changes cancellation behaviour.
- `KoinComponent` with `by inject()` or `get()` inside domain classes → turn it into a constructor parameter. Keep the Koin binding in the module.
- `object` singletons that hold state or I/O, used inside logic → inject an interface, with the singleton as the default value.
- `System.currentTimeMillis()`, `Clock.System.now()`, `UUID.randomUUID()` in logic → inject a `Clock` or an id generator.
- `Dispatchers.IO` hard-coded inside repositories → inject a `CoroutineDispatcher` with `Dispatchers.IO` as the default.
- A ViewModel over about 400 lines that owns several flows of state → split the logic into use-case classes that it calls.
- Many separate `MutableStateFlow`s that change together → combine into one `UiState` data class. Keep the same emissions.
- `mockk<OrderRepository>()` or `Mockito.mock(` of the team's own interfaces → write a hand-written fake class.
- An interface with one implementation and no test fake → apply the deletion test. Remove it, or add the fake.
- `when` on the same sealed type in many files → move the branches into the module that owns the type.

## Safe moves

Introduce DI without a change in behaviour:

1. Add a constructor parameter with the current concrete value as its default.
2. Use the parameter in place of the direct reference.
3. Run the checks. Every existing call site and DI binding still works.
4. In a later change, bind the real value in the Hilt or Koin module and remove the default when no caller relies on it.

```kotlin
class OrderRepository(
    private val api: OrdersApi,
    private val io: CoroutineDispatcher = Dispatchers.IO,
)
```

Extract an interface from a class:

1. Declare an interface with exactly the members that the consumer uses, with the same `suspend` modifiers.
2. Make the class implement it. Change no code in the class.
3. Change the consumer's parameter type. Add a Hilt `@Binds` or a Koin `bind` so the graph still resolves.

Split a file: move top-level functions or classes to a new file in the same package. Add `@file:JvmName` only if Java callers depend on the old `FileNameKt` class.

Traps that change behaviour silently:

- Init order. Property initializers and `init` blocks run top to bottom. Moving a property above or below an `init` block changes what it sees.
- Open calls in constructors. A subclass override runs before the subclass fields are set.
- `lateinit` and `by lazy`. Changing one to the other changes when the value is built and which thread builds it.
- `data class` changes. Adding, removing or reordering primary constructor parameters changes `equals`, `hashCode`, `copy` and `componentN`.
- Coroutine scope and dispatcher. Moving a `launch` to another scope changes cancellation. Moving work to another dispatcher changes threading.
- `StateFlow` equality. It drops equal values. Changing state types can change which emissions the UI sees.
- Java interop. `@JvmStatic`, `@JvmOverloads` and `@JvmField` affect Java callers. Keep them.

## Tests

Test the ViewModel or domain class through its public functions and state. Pass hand-written fakes through the constructor. Use `kotlinx-coroutines-test` with `runTest` and a `StandardTestDispatcher`.

```kotlin
// port
interface OrderRepository {
    suspend fun order(id: OrderId): Order
    suspend fun cancel(id: OrderId)
}

// production adapter
class RemoteOrderRepository(private val api: OrdersApi) : OrderRepository {
    override suspend fun order(id: OrderId) = api.getOrder(id.value).toDomain()
    override suspend fun cancel(id: OrderId) { api.cancelOrder(id.value) }
}

// in-memory fake, in src/test or a shared testFixtures source set
class FakeOrderRepository(vararg seed: Order) : OrderRepository {
    val orders = seed.associateBy { it.id }.toMutableMap()
    override suspend fun order(id: OrderId) = orders.getValue(id)
    override suspend fun cancel(id: OrderId) { orders[id] = orders.getValue(id).copy(status = Status.Cancelled) }
}

// test
@Test fun `user can cancel an open order`() = runTest {
    val vm = OrderViewModel(FakeOrderRepository(openOrder), StandardTestDispatcher(testScheduler))
    vm.load(openOrder.id)
    vm.onCancelClicked()
    advanceUntilIdle()
    assertEquals(Status.Cancelled, vm.state.value.order?.status)
}
```

- Put shared fakes in a `testFixtures` source set so many modules can use them.
- Test Room adapters with an in-memory Room database. Test Retrofit adapters with `MockWebServer`.
- Use Compose UI tests only where the layout or interaction is the behaviour. Drive them with a fake-backed ViewModel.

## Never

- Never change public declarations, function signatures or default parameter values that other modules use.
- Never reorder, add or remove `data class` constructor parameters.
- Never change `@SerializedName`, `@SerialName`, `@Json` names or Room `@ColumnInfo` and table names.
- Never change exception types or messages that callers catch or match.
- Never change coroutine scopes, dispatchers or `launch` vs `async` in a refactor.
- Never reorder property initializers and `init` blocks.
- Never change Hilt qualifiers, scopes or Koin named bindings.
- Never catch `CancellationException` or swallow an exception in `runCatching`.
- Never add `@Suppress`, `!!` or `@SuppressLint` to silence a check.
- Never edit source and tests in the same refactor.
