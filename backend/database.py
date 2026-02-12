# Vox Trader Backend - MySQL connection
import pymysql
from contextlib import contextmanager
from typing import Generator
from config import get_settings


def get_connection(**overrides):
    s = get_settings()
    kwargs = {**s.mysql_connect_kwargs, **overrides}
    return pymysql.connect(**kwargs)


@contextmanager
def get_db() -> Generator:
    conn = get_connection()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def get_db_no_database():
    """Connection without database (for creating DB)."""
    s = get_settings()
    return pymysql.connect(
        host=s.MYSQL_HOST,
        port=s.MYSQL_PORT,
        user=s.MYSQL_USER,
        password=s.MYSQL_PASSWORD,
        charset="utf8mb4",
    )
