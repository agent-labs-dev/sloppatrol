# Python

Use this page for Python code: libraries, CLIs, Django and FastAPI apps, workers and scripts.

## Shape

- A module is a package with a small public surface. The package `__init__.py` names the public names. Implementation lives in private modules (`_store.py`) or a `_lib/` subpackage.
- Outside code imports only the public names. An import of `pkg._internal` from another package is a leak.
- Define ports as `typing.Protocol` classes in the module that consumes them. Adapters do not inherit from the Protocol. They only match it.
- Use frozen `@dataclass` (or `attrs`, or Pydantic at the I/O edge) for values. Keep domain values free of ORM and framework types.
- Inject dependencies through `__init__` parameters or function parameters. Do not reach for module-level globals.
- Wire real adapters in one composition root: `main()`, the FastAPI app factory, or Django `AppConfig.ready()` plus a small `deps.py`.
- In FastAPI, the composition root builds adapters. `Depends()` providers return them. Route functions stay thin.
- In Django, views parse and render. Domain rules live in plain modules that take a repository Protocol. ORM queries live in repository adapters or model managers.
- Type-hint every public function. Keep modules under about 400 lines. Keep functions under about 50 lines.

## Look for

- `@patch('myapp.billing.send_email')` or `monkeypatch.setattr` on the team's own code → add a parameter for the dependency and pass a fake.
- `requests.get(`, `boto3.client(`, `open(` inside domain functions → move the call into an adapter behind a Protocol.
- `os.environ[` or `settings.X` read deep in logic → read config at the root and pass the value in.
- `datetime.now()`, `time.time()`, `uuid4()`, `random.` in rules → inject a `clock` or `ids` callable with the real one as the default.
- A Django view or FastAPI route over about 40 lines with queries and rules → extract a domain function, then a repository.
- `Model.objects.filter(` spread across views, serializers and tasks → put each query behind one repository or manager method.
- `dict` passed around with known keys → introduce a `@dataclass` or `TypedDict` with the same keys.
- Functions with 6 or more parameters that travel together → bundle them into one dataclass.
- A module over about 400 lines with unrelated classes → split it and re-export from the old module.
- Missing type hints on a public function → add hints that describe the current behaviour exactly, including `None`.
- An ABC with one subclass and no test fake → apply the deletion test. Inline it, or keep it and add the fake.
- `except Exception: pass` → raise this as a finding. Do not change it in a refactor.

## Safe moves

Introduce DI without a change in behaviour:

1. Add a keyword parameter with a `None` default.
2. In the body, use `dep = dep if dep is not None else RealThing()`. Do not put `RealThing()` in the default itself. Defaults run once, at import time.
3. Run the checks. Every caller still works.
4. In a later change, build the real dependency in the composition root and pass it in.

```python
def send_invoice(invoice_id: str, *, mailer: Mailer | None = None) -> None:
    mailer = mailer if mailer is not None else SesMailer()
    ...
```

Split a module without a change to its public names:

1. Move a group of functions or classes to a new private module.
2. In the old module, add `from ._new import name_a, name_b`. Keep `__all__` the same.
3. Keep names that other code imports from the old path, including private names that tests or plugins import.
4. Check that no pickled data, Celery task names or Django migrations refer to the old dotted path. If they do, do not move that name.

Traps that change behaviour silently:

- Mutable default arguments. `def f(x=[])` shares one list across calls. Do not "fix" it in a refactor, and do not introduce it.
- Import-time side effects. Django signal registration, model registration and decorators that register handlers run on import. Keep import order.
- Late binding in closures. A lambda in a loop captures the variable, not the value.
- `is` vs `==`. Do not change one to the other.
- Truthiness. `if x:` and `if x is not None:` differ for `0`, `''` and `[]`.
- Dotted paths as data. Celery task names, `@patch` targets, pickles, Django `INSTALLED_APPS` and serializers refer to module paths.
- Dataclass changes. `frozen`, `eq`, `order` and field order change hashing, equality and positional construction.
- `__init__.py` re-exports. Removing one breaks `from pkg import name` in outside code.

## Tests

Use pytest. Build fakes in fixtures and pass them through the seam. Use `unittest.mock` only for libraries you do not own and cannot wrap, and prefer a fake adapter.

```python
# port, in orders/ports.py
class OrderRepo(Protocol):
    def get(self, order_id: str) -> Order | None: ...
    def save(self, order: Order) -> None: ...

# production adapter, in orders/_django_repo.py
class DjangoOrderRepo:
    def get(self, order_id: str) -> Order | None:
        row = OrderRow.objects.filter(id=order_id).first()
        return row.to_domain() if row else None
    def save(self, order: Order) -> None:
        OrderRow.objects.update_or_create(id=order.id, defaults=to_row(order))

# in-memory fake, in tests/fakes.py
class MemoryOrderRepo:
    def __init__(self, *orders: Order) -> None:
        self.rows = {o.id: o for o in orders}
    def get(self, order_id: str) -> Order | None:
        return self.rows.get(order_id)
    def save(self, order: Order) -> None:
        self.rows[order.id] = order

# test
@pytest.fixture
def orders() -> Orders:
    return Orders(repo=MemoryOrderRepo(OPEN_ORDER), clock=lambda: T0)

def test_cancel_marks_open_order_cancelled(orders: Orders) -> None:
    orders.cancel(OPEN_ORDER.id)
    assert orders.get(OPEN_ORDER.id).status == "cancelled"
```

- Run mypy or pyright on fakes too. The Protocol check keeps the fake in step with the port.
- Test the Django or SQL adapter against a real test database with `pytest-django` or a throwaway Postgres.
- In FastAPI, use `app.dependency_overrides` to pass fakes into route tests. That is DI, not mocking.
- Assert on returned values and on fake state. Do not assert on `mock.assert_called_with` for your own code.

## Never

- Never rename or remove a public name, a module path or a keyword argument that callers use.
- Never change positional parameter order or turn a positional parameter into keyword-only.
- Never change exception classes or messages that callers catch or match.
- Never rename dataclass fields, Pydantic fields, serializer fields, JSON keys or Django model fields.
- Never change Celery task names, URL names, signal receivers or management command names.
- Never reorder imports that have side effects.
- Never add `# type: ignore`, `# noqa`, `# pragma: no cover` or `cast()` to silence a checker.
- Never swallow an exception or widen an `except` clause.
- Never edit source and tests in the same refactor.
