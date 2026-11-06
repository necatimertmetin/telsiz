# Telsiz

Arkadaş grupları için hesapsız, sunucusuz sesli ve görüntülü sohbet. İsmini yaz, davet linkini at, konuş.

**Web:** https://necatimertmetin.github.io/telsiz/
**Windows ve Android:** [Son sürüm](https://github.com/necatimertmetin/telsiz/releases/latest)

## Neler var

- Sesli ve görüntülü oda, ekran paylaşımı, "herkesi çağır"
- Gruplar, yazı kanalları, yanıt, düzenleme, silme, tepki
- Her türlü dosya, boyut sınırı yok. Dosya sunucuya değil doğrudan arkadaşına gider
- Geçmiş cihazda durur, grup açılınca herkes birbirini tamamlar
- Hesap yok, kayıt yok, ücret yok
- Windows uygulamasında oyundayken `Ctrl+Shift+M` mikrofon, `Ctrl+Shift+D` kulaklık
- Android uygulamasında ekran kapalıyken görüşme sürer

## Nasıl çalışır

Telsiz'in sunucusu yok, o yüzden ödenecek fatura da yok.

- Site GitHub Pages'ten gelir.
- Cihazlar birbirini herkese açık Nostr röleleri üzerinden bulur ([Trystero](https://github.com/dmotz/trystero)). Rölelerden geçen bağlantı bilgisi grup koduyla şifrelidir.
- Bulduktan sonra ses, görüntü, mesaj ve dosya WebRTC ile doğrudan cihazdan cihaza, uçtan uca şifreli akar.
- Grup kodu grubun tek anahtarıdır. Kodu bilen gruba girer.

## Sınırlar

- Mesaj sadece grupta biri çevrimiçiyken yayılır. Herkes kapalıyken yazılan, ilk açılan kişide durur ve sonra eşitlenir.
- Dosya, sahibi ya da indirmiş biri çevrimiçiyken alınabilir. 300 MB üstü dosyalar uygulama kapanınca cihazda kalmaz.
- Uygulama tamamen kapalıysa çağrı bildirimi gelmez.
- Bazı operatörlerin ağları doğrudan bağlantıyı engeller. Böyle olursa Ayarlar > Gelişmiş bölümüne ücretsiz bir TURN hesabı girilebilir.

## Geliştirme

```bash
npm install
npm run dev
npm test
```

Dört tarayıcıyla uçtan uca sınama (Chrome gerekir, gerçek röleleri kullanır):

```bash
npm run build
npx vite preview --port 4173
npm run e2e
```

Masaüstü ve Android kabukları canlı siteyi açar, bu yüzden web'e çıkan düzeltme yeniden kurulum gerektirmez. Kabuğun kendisi değişirse:

```bash
cd desktop && npm install && npm run dist
```

```bash
npx cap sync android && cd android && gradlew.bat assembleDebug
```

## Lisans

MIT
