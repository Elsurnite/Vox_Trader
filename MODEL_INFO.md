# PatchTST - Trading Model Seçimi

## 🎯 Seçilen Model: PatchTST (Patch-based Time Series Transformer)

### Neden PatchTST?

✅ **2025'te en iyi performans** - Time series forecasting için state-of-the-art  
✅ **Hızlı** - Training ve inference hızı yüksek  
✅ **Multivariate** - OHLCV + teknik göstergeleri birlikte işleyebilir  
✅ **Long-range dependencies** - Uzun vadeli pattern'leri yakalar  
✅ **Crypto için optimize** - Finansal veriler için test edilmiş  

### Model Özellikleri

- **Architecture:** Transformer-based (self-attention)
- **Input:** Historical price data (OHLCV) + Technical indicators
- **Output:** Future price prediction + Trading signals (BUY/SELL/HOLD)
- **Training:** Supervised learning on historical data
- **Inference:** Real-time prediction (< 100ms)

### Teknik Detaylar

```python
# Model yapısı
- Patch-based approach: Time series'i patch'lere böler
- Self-attention: Long-range dependencies yakalar
- Multi-head attention: Farklı zaman ölçeklerini öğrenir
- Encoder-decoder: Sequence-to-sequence prediction
```

### Kullanım Senaryosu

```
Input: 
  - Son 100 candle (OHLCV)
  - RSI, MACD, Bollinger Bands
  - Volume data
  
Output:
  - Sonraki 1-24 saatlik fiyat tahmini
  - Trading sinyali (BUY/SELL/HOLD)
  - Confidence score
```

### Alternatif Modeller (Karşılaştırma)

| Model | Performans | Hız | Karmaşıklık | Öneri |
|-------|------------|-----|-------------|-------|
| **PatchTST** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ✅ **ÖNERİLEN** |
| TFT | ⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐ | İyi alternatif |
| LSTM | ⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐ | Basit başlangıç |
| GRU | ⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐ | Basit başlangıç |

### Kaynaklar

- **Paper:** "A Time Series is Worth 64 Words: Long-term Forecasting with Transformers"
- **Library:** `patchtslib` veya PyTorch implementasyonu
- **GitHub:** PatchTST reposu mevcut

### Implementation Plan

1. ✅ Model seçimi: PatchTST
2. ⏳ Veri toplama: Binance historical data
3. ⏳ Feature engineering: Technical indicators
4. ⏳ Model training: Historical data ile
5. ⏳ Backtesting: Geçmiş verilerle test
6. ⏳ Production: Real-time inference
