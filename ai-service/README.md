# AI Service - PatchTST Trading Model

PatchTST (Patch-based Time Series Transformer) modeli ile trading sinyalleri üreten servis.

## Kurulum

```bash
cd ai-service
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

## Model Yapısı

- **Model:** PatchTST
- **Framework:** PyTorch
- **Input:** OHLCV + Technical Indicators
- **Output:** Price prediction + Trading signals

## Kullanım

```bash
# Training
python train.py

# Inference (API)
uvicorn main:app --reload

# Backtesting
python backtest.py
```

## API Endpoints

- `POST /predict` - Trading sinyali al
- `GET /health` - Servis durumu
- `POST /train` - Model eğitimi başlat
