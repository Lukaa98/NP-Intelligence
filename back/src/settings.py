import os
from functools import lru_cache
from pathlib import Path

try:
    from dotenv import load_dotenv
    load_dotenv()
except Exception:
    pass


class Settings:
    def __init__(self):
        self.database_path = os.getenv('DATABASE_PATH', './data/np_intelligence.db')
        self.cors_origins = [item.strip() for item in os.getenv('CORS_ORIGINS', 'http://localhost:5173').split(',') if item.strip()]
        self.enable_scheduler = os.getenv('ENABLE_SCHEDULER', 'true').lower() not in {'0', 'false', 'no'}
        self.scan_interval_minutes = max(1, int(os.getenv('SCAN_INTERVAL_MINUTES', '60')))

        db_parent = Path(self.database_path).parent
        db_parent.mkdir(parents=True, exist_ok=True)


@lru_cache
def get_settings():
    return Settings()
