from stewardai.config import Settings


def test_email_settings_defaults():
    s = Settings(_env_file=None)
    assert s.email_enabled is False
    assert s.resend_api_key is None
    assert s.email_from  # has a non-empty default
    assert s.public_app_url  # has a non-empty default
