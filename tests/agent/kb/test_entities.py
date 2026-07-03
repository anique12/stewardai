from stewardai.agent.kb.entities import resolve_entities


class _Resp:
    def __init__(self, data):
        self.data = data


class _Query:
    def __init__(self, table):
        self._t = table
        self._filters = {}

    def select(self, *_a):
        return self

    def eq(self, col, val):
        self._filters[col] = val
        return self

    def limit(self, _n):
        return self

    async def execute(self):
        rows = [r for r in self._t.rows
                if all(r.get(k) == v for k, v in self._filters.items())]
        return _Resp(rows)

    def insert(self, payload):
        self._t.inserted.append(payload)
        row = {**payload, "id": f"ent-{len(self._t.rows) + 1}"}
        self._t.rows.append(row)
        self._pending = [row]
        return self


class _Table:
    def __init__(self):
        self.rows = []
        self.inserted = []

    # insert() returns a query whose execute() yields the inserted row
    def select(self, *a):
        return _Query(self).select(*a)

    def insert(self, payload):
        return _Query(self).insert(payload)


class _Client:
    def __init__(self, seed=None):
        self._tables = {"entities": _Table()}
        if seed:
            self._tables["entities"].rows.extend(seed)

    def table(self, name):
        return self._tables[name]


async def test_matches_existing_by_email():
    client = _Client(seed=[{"id": "e1", "user_id": "u1", "kind": "person",
                            "name": "Jane", "email": "jane@acme.com"}])
    ids = await resolve_entities(client, user_id="u1",
                                 extracted=[{"kind": "person", "name": "Jane D", "email": "jane@acme.com"}])
    assert ids == ["e1"]
    assert client.table("entities").inserted == []  # no new row created


async def test_creates_new_with_domain_from_email():
    client = _Client()
    ids = await resolve_entities(client, user_id="u1",
                                 extracted=[{"kind": "person", "name": "Bob", "email": "bob@globex.io"}])
    assert len(ids) == 1
    created = client.table("entities").inserted[0]
    assert created["user_id"] == "u1" and created["domain"] == "globex.io"


async def test_dedupes_within_one_call():
    client = _Client()
    ids = await resolve_entities(client, user_id="u1", extracted=[
        {"kind": "company", "name": "Acme", "email": None},
        {"kind": "company", "name": "Acme", "email": None},
    ])
    assert len(ids) == 1 and len(client.table("entities").inserted) == 1


async def test_matches_existing_by_name_kind_no_email():
    client = _Client(seed=[{"id": "e2", "user_id": "u1", "kind": "company",
                            "name": "Acme", "email": None}])
    ids = await resolve_entities(client, user_id="u1",
                                 extracted=[{"kind": "company", "name": "Acme", "email": None}])
    assert ids == ["e2"]
    assert client.table("entities").inserted == []  # no new row created


async def test_case_insensitive_email_match():
    client = _Client(seed=[{"id": "e3", "user_id": "u1", "kind": "person",
                            "name": "Jane", "email": "jane@acme.com"}])
    ids = await resolve_entities(client, user_id="u1",
                                 extracted=[{"kind": "person", "name": "Jane", "email": "Jane@ACME.com"}])
    assert ids == ["e3"]
    assert client.table("entities").inserted == []  # no new row created
