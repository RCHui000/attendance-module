from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
DB_PATH = DATA_DIR / "probe_history.sqlite3"

DEFAULT_TIMEOUT_SECONDS = 12
DEFAULT_DAILY_HOUR = 8
DEFAULT_DAILY_MINUTE = 30

BROWSER_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/125.0 Safari/537.36"
)

BOT_UA = "TenderMonitorMVP/0.1 (+public-page-compliance-probe)"
