# Vox Trader Backend (Python + MySQL)

## 1. Ortam

- Python 3.10+
- `backend` klasöründe sanal ortam önerilir:

```bash
cd backend
python3 -m venv venv
source venv/bin/activate   # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

## 2. Veritabanı ve .env

MySQL bilgilerinizi kendi ortamınıza göre girin:

- Host: `localhost` (veya kendi DB sunucunuz)
- User: `your_mysql_user`
- Password: `your_mysql_password`
- Database: `vox_trader` (script ile oluşturulacak)

`backend` klasöründe `.env` dosyası oluşturun:

```env
MYSQL_HOST=localhost
MYSQL_PORT=3306
MYSQL_USER=your_mysql_user
MYSQL_PASSWORD=your_mysql_password
MYSQL_DATABASE=vox_trader
JWT_SECRET=change_me_in_production
JWT_ALGORITHM=HS256
JWT_EXPIRE_MINUTES=60

# Z.AI GLM-4.6V-Flash (Dashboard AI sohbet için) - https://z.ai/model-api → API Key
GLM5_API_KEY=your_z_ai_api_key_here
# İsteğe bağlı (varsayılan: https://api.z.ai/api/paas/v4)
# GLM5_BASE_URL=https://api.z.ai/api/paas/v4
```

## 3. Veritabanı ve tabloları oluşturma

Tabloları oluşturmak için tek seferlik script:

```bash
cd backend
python scripts/create_database.py
```

Bu script:

- `vox_trader` veritabanını oluşturur (yoksa).
- `users` tablosunu oluşturur (id, email, password_hash, name, created_at, updated_at).
- `binance_api_keys` tablosunu oluşturur (user_id, encrypted_api_key, encrypted_api_secret). API anahtarları şifreli saklanır.

## 4. Backend’i çalıştırma

Sanal ortamı aktifleştirip çalıştırın:

```bash
cd backend
source venv/bin/activate   # Windows: venv\Scripts\activate
uvicorn main:app --reload --host 0.0.0.0 --port 8423
```

Venv kullanmıyorsanız (aynı dizinde `pip install -r requirements.txt` yaptıysanız):

```bash
cd backend
python3 -m uvicorn main:app --reload --host 0.0.0.0 --port 8423
```

API: http://localhost:8423  
Docs: http://localhost:8423/docs  

## Endpoint’ler

- `POST /auth/register` – Kayıt (email, password, name?)
- `POST /auth/login` – Giriş (email, password)
- `GET /auth/me` – Oturum açan kullanıcı (Header: `Authorization: Bearer <token>`)
- `POST /ai/chat` – GLM-4.6V-Flash sohbet (body: `{ "messages": [{ "role": "user"|"assistant", "content": "..." }] }`, auth gerekli)
- `GET /health` – Sağlık kontrolü
