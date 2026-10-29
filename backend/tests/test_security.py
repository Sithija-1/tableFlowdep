from app.core.security import (
    create_access_token,
    decode_access_token,
    hash_password,
    verify_password,
)


def test_password_and_access_token_round_trip() -> None:
    password_hash = hash_password("only-for-a-unit-test")
    assert verify_password("only-for-a-unit-test", password_hash)
    assert not verify_password("not-the-test-password", password_hash)

    token = create_access_token("42", "HOST")
    assert decode_access_token(token)["sub"] == "42"
