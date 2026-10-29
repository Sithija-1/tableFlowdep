from app.main import health


def test_health_reports_service_status() -> None:
    assert health() == {"status": "ok", "service": "tableflow-api"}
