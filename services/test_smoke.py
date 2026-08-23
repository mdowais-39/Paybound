"""Phase 0 smoke test — proves the Python package tree imports and pytest runs.
Real per-phase tests replace/augment this as services are built."""


def test_services_package_imports():
    import services  # noqa: F401


def test_money_is_integer_paise_convention():
    # Part F #4: money is always integer paise, never a float. This test
    # documents the convention that every service must follow.
    rupees = 3000
    paise = rupees * 100
    assert isinstance(paise, int)
    assert paise == 300_000
