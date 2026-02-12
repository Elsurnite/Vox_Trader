#!/usr/bin/env python3
"""
Vox Trader - MySQL veritabanı ve tabloları oluşturur.
Kullanım: python scripts/create_database.py
Ortam değişkenleri veya .env: MYSQL_HOST, MYSQL_USER, MYSQL_PASSWORD, MYSQL_DATABASE
"""
import os
import sys

# backend root'u path'e ekle
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pymysql
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(os.path.dirname(__file__)), ".env"))

MYSQL_HOST = os.getenv("MYSQL_HOST", "localhost")
MYSQL_PORT = int(os.getenv("MYSQL_PORT", "3306"))
MYSQL_USER = os.getenv("MYSQL_USER", "root")
MYSQL_PASSWORD = os.getenv("MYSQL_PASSWORD", "")
MYSQL_DATABASE = os.getenv("MYSQL_DATABASE", "vox_trader")


def main():
    # Önce database olmadan bağlan
    conn = pymysql.connect(
        host=MYSQL_HOST,
        port=MYSQL_PORT,
        user=MYSQL_USER,
        password=MYSQL_PASSWORD,
        charset="utf8mb4",
    )
    print(f"MySQL'e bağlandı: {MYSQL_HOST}:{MYSQL_PORT}")

    try:
        with conn.cursor() as cur:
            cur.execute(f"CREATE DATABASE IF NOT EXISTS `{MYSQL_DATABASE}` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci")
            print(f"Veritabanı '{MYSQL_DATABASE}' hazır.")
        conn.commit()
    finally:
        conn.close()

    # Veritabanına bağlanıp tabloları oluştur
    conn = pymysql.connect(
        host=MYSQL_HOST,
        port=MYSQL_PORT,
        user=MYSQL_USER,
        password=MYSQL_PASSWORD,
        database=MYSQL_DATABASE,
        charset="utf8mb4",
    )

    try:
        with conn.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS users (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    email VARCHAR(255) NOT NULL UNIQUE,
                    password_hash VARCHAR(255) NOT NULL,
                    name VARCHAR(255) NULL,
                    demo_balance DECIMAL(20, 2) NOT NULL DEFAULT 10000.00,
                    demo_mode TINYINT(1) NOT NULL DEFAULT 0,
                    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    INDEX idx_email (email)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            """)
            print("Tablo 'users' hazır.")
            # Mevcut kurulumlarda demo_balance / demo_mode sütunu yoksa ekle
            for col, spec in [
                ("demo_balance", "DECIMAL(20, 2) NOT NULL DEFAULT 10000.00"),
                ("demo_mode", "TINYINT(1) NOT NULL DEFAULT 0"),
                ("balance", "DECIMAL(20, 4) NOT NULL DEFAULT 10.0000"),
            ]:
                try:
                    cur.execute(f"ALTER TABLE users ADD COLUMN {col} {spec}")
                    print(f"Sütun 'users.{col}' eklendi.")
                except pymysql.err.OperationalError as e:
                    if "Duplicate column name" not in str(e):
                        raise
            cur.execute("""
                CREATE TABLE IF NOT EXISTS demo_holdings (
                    user_id INT NOT NULL,
                    asset VARCHAR(20) NOT NULL,
                    quantity DECIMAL(24, 8) NOT NULL DEFAULT 0,
                    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    PRIMARY KEY (user_id, asset),
                    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                    INDEX idx_user_id (user_id)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            """)
            print("Tablo 'demo_holdings' hazır.")
            cur.execute("""
                CREATE TABLE IF NOT EXISTS demo_trades (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    user_id INT NOT NULL,
                    side VARCHAR(4) NOT NULL,
                    symbol VARCHAR(20) NOT NULL,
                    base_asset VARCHAR(20) NOT NULL,
                    quantity DECIMAL(24, 8) NOT NULL,
                    price_usdt DECIMAL(20, 8) NOT NULL,
                    usdt_amount DECIMAL(20, 2) NOT NULL,
                    commission_usdt DECIMAL(20, 8) NOT NULL DEFAULT 0,
                    source VARCHAR(20) NOT NULL DEFAULT 'agent',
                    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    INDEX idx_user_created (user_id, created_at),
                    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            """)
            print("Tablo 'demo_trades' hazır.")
            try:
                cur.execute("ALTER TABLE demo_trades ADD COLUMN commission_usdt DECIMAL(20, 8) NOT NULL DEFAULT 0")
                print("Sütun 'demo_trades.commission_usdt' eklendi.")
            except pymysql.err.OperationalError as e:
                if "Duplicate column name" not in str(e):
                    raise
            cur.execute("""
                CREATE TABLE IF NOT EXISTS binance_api_keys (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    user_id INT NOT NULL UNIQUE,
                    encrypted_api_key TEXT NOT NULL,
                    encrypted_api_secret TEXT NOT NULL,
                    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                    INDEX idx_user_id (user_id)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            """)
            print("Tablo 'binance_api_keys' hazır.")
            cur.execute("""
                CREATE TABLE IF NOT EXISTS agent_analyses (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    user_id INT NOT NULL,
                    symbol VARCHAR(20) NOT NULL,
                    `interval` VARCHAR(10) NOT NULL,
                    strategy VARCHAR(20) NOT NULL,
                    action VARCHAR(10) NOT NULL,
                    analysis_text TEXT NOT NULL,
                    message_short VARCHAR(500) NULL,
                    buy_at DECIMAL(20, 8) NULL,
                    sell_at DECIMAL(20, 8) NULL,
                    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    market_type VARCHAR(10) NOT NULL DEFAULT 'spot',
                    model VARCHAR(64) NULL,
                    input_tokens INT NULL,
                    output_tokens INT NULL,
                    cached_input_tokens INT NULL,
                    cost_usd DECIMAL(12, 6) NULL,
                    INDEX idx_user_created (user_id, created_at),
                    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            """)
            print("Tablo 'agent_analyses' hazır.")
            for col, spec in [
                ("market_type", "VARCHAR(10) NOT NULL DEFAULT 'spot'"),
                ("model", "VARCHAR(64) NULL"),
                ("input_tokens", "INT NULL"),
                ("output_tokens", "INT NULL"),
                ("cached_input_tokens", "INT NULL"),
                ("cost_usd", "DECIMAL(12, 6) NULL"),
            ]:
                try:
                    cur.execute(f"ALTER TABLE agent_analyses ADD COLUMN {col} {spec}")
                    print(f"Sütun 'agent_analyses.{col}' eklendi.")
                except pymysql.err.OperationalError as e:
                    if "Duplicate column name" not in str(e):
                        raise
            cur.execute("""
                CREATE TABLE IF NOT EXISTS demo_futures_positions (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    user_id INT NOT NULL,
                    symbol VARCHAR(20) NOT NULL,
                    side VARCHAR(6) NOT NULL,
                    quantity DECIMAL(24, 8) NOT NULL,
                    entry_price DECIMAL(20, 8) NOT NULL,
                    leverage INT NOT NULL DEFAULT 10,
                    margin_used DECIMAL(20, 2) NOT NULL,
                    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                    INDEX idx_user_id (user_id)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            """)
            print("Tablo 'demo_futures_positions' hazır.")
            try:
                cur.execute("ALTER TABLE demo_futures_positions DROP INDEX uq_user_symbol")
                print("demo_futures_positions: uq_user_symbol kaldırıldı (çoklu pozisyon için).")
            except pymysql.err.OperationalError as e:
                if "check that it exists" not in str(e).lower() and "1091" not in str(e):
                    pass
            except Exception:
                pass
            cur.execute("""
                CREATE TABLE IF NOT EXISTS agent_job (
                    user_id INT PRIMARY KEY,
                    is_running TINYINT(1) NOT NULL DEFAULT 0,
                    symbol VARCHAR(20) NOT NULL DEFAULT 'BTCUSDT',
                    `interval` VARCHAR(10) NOT NULL DEFAULT '1m',
                    strategy VARCHAR(20) NOT NULL DEFAULT 'kisa_vade',
                    custom_prompt TEXT,
                    market_type VARCHAR(10) NOT NULL DEFAULT 'spot',
                    trade_enabled TINYINT(1) NOT NULL DEFAULT 0,
                    order_amount DECIMAL(20, 2) NOT NULL DEFAULT 100,
                    order_amount_mode VARCHAR(10) NOT NULL DEFAULT 'fixed',
                    max_open_positions INT NOT NULL DEFAULT 1,
                    single_trade_if_max TINYINT(1) NOT NULL DEFAULT 1,
                    max_mode_used TINYINT(1) NOT NULL DEFAULT 0,
                    min_trade_interval_sec INT NOT NULL DEFAULT 0,
                    leverage INT NOT NULL DEFAULT 10,
                    interval_sec INT NOT NULL DEFAULT 60,
                    started_at DATETIME NULL,
                    last_run_at DATETIME NULL,
                    model VARCHAR(64) NOT NULL DEFAULT 'GLM-4.6V-Flash',
                    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            """)
            print("Tablo 'agent_job' hazır.")
            try:
                cur.execute("ALTER TABLE agent_job ADD COLUMN model VARCHAR(64) NOT NULL DEFAULT 'GLM-4.6V-Flash'")
                print("Sütun 'agent_job.model' eklendi.")
            except pymysql.err.OperationalError as e:
                if "Duplicate column name" not in str(e):
                    raise
            for col, spec in [
                ("order_amount_mode", "VARCHAR(10) NOT NULL DEFAULT 'fixed'"),
                ("max_open_positions", "INT NOT NULL DEFAULT 1"),
                ("single_trade_if_max", "TINYINT(1) NOT NULL DEFAULT 1"),
                ("max_mode_used", "TINYINT(1) NOT NULL DEFAULT 0"),
                ("min_trade_interval_sec", "INT NOT NULL DEFAULT 0"),
            ]:
                try:
                    cur.execute(f"ALTER TABLE agent_job ADD COLUMN {col} {spec}")
                    print(f"Sütun 'agent_job.{col}' eklendi.")
                except pymysql.err.OperationalError as e:
                    if "Duplicate column name" not in str(e):
                        raise
            cur.execute("""
                CREATE TABLE IF NOT EXISTS agent_log (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    user_id INT NOT NULL,
                    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    message VARCHAR(500) NOT NULL,
                    analysis_id INT NULL,
                    log_type VARCHAR(20) NOT NULL DEFAULT 'log',
                    INDEX idx_user_created (user_id, created_at),
                    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            """)
            print("Tablo 'agent_log' hazır.")
            cur.execute("""
                CREATE TABLE IF NOT EXISTS chat_usage (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    user_id INT NOT NULL,
                    model VARCHAR(64) NOT NULL,
                    input_tokens INT NOT NULL DEFAULT 0,
                    output_tokens INT NOT NULL DEFAULT 0,
                    cached_input_tokens INT NULL,
                    cost_usd DECIMAL(12, 6) NULL,
                    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    INDEX idx_user_created (user_id, created_at),
                    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            """)
            print("Tablo 'chat_usage' hazır.")
            cur.execute("""
                CREATE TABLE IF NOT EXISTS balance_topups (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    user_id INT NOT NULL,
                    order_number VARCHAR(64) NOT NULL UNIQUE,
                    amount_usd DECIMAL(20, 2) NOT NULL,
                    status VARCHAR(20) NOT NULL DEFAULT 'pending',
                    provider VARCHAR(20) NOT NULL DEFAULT 'magazala',
                    payment_id VARCHAR(128) NULL,
                    callback_payload TEXT NULL,
                    credited_at DATETIME NULL,
                    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    INDEX idx_user_created (user_id, created_at),
                    INDEX idx_status (status),
                    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            """)
            print("Tablo 'balance_topups' hazır.")
            cur.execute("""
                CREATE TABLE IF NOT EXISTS demo_futures_trades (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    user_id INT NOT NULL,
                    symbol VARCHAR(20) NOT NULL,
                    side VARCHAR(6) NOT NULL,
                    quantity DECIMAL(24, 8) NOT NULL,
                    entry_price DECIMAL(20, 8) NOT NULL,
                    exit_price DECIMAL(20, 8) NOT NULL,
                    pnl_usdt DECIMAL(20, 2) NOT NULL,
                    commission_usdt DECIMAL(20, 8) NOT NULL DEFAULT 0,
                    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    INDEX idx_user_created (user_id, created_at),
                    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            """)
            print("Tablo 'demo_futures_trades' hazır.")
        conn.commit()
    finally:
        conn.close()

    print("Bitti. Backend'i çalıştırabilirsin: uvicorn main:app --reload")


if __name__ == "__main__":
    main()
