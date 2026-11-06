# Telsiz

Arkadaş grupları için hesapsız, sunucusuz sesli ve görüntülü sohbet. İsmini yaz, davet linkini at, konuş.

**Web:** https://necatimertmetin.github.io/telsiz/
**Windows ve Android:** [Son sürüm](https://github.com/necatimertmetin/telsiz/releases/latest)

## Neler var

- Sesli ve görüntülü oda, sesli ekran paylaşımı, cihaz seçim menüleri, "herkesi çağır"
- Gruplar, yazı kanalları, özel sohbetler, yanıt, düzenleme, silme, tepki, görüldü bilgisi
- Sesli mesaj, GIF ve resim gösterimi
- Her türlü dosya, boyut sınırı yok. Dosya sunucuya değil doğrudan arkadaşına gider
- Geçmiş cihazda durur, grup açılınca herkes birbirini tamamlar
- Seçili kişilerle özel grup sohbeti, anket, maç hatırlatması, profil rengi ve fotoğrafı
- Sohbet komutları: `/zar`, `/yazitura`, `/harita`, `/takim`, `/sec`, `/yardim`
- Ses odasının yan sohbeti, sesli davet linki
- YouTube'u birlikte izleme ve dinleme: oda sohbetine link yaz, sıraya girer, herkes aynı anda oynatır, durdurur, sarar
- Görüşmede ses efektleri ve son 30-60 saniyeyi sohbete gönderen klip kaydı
- İki kişi doğrudan bağlanamazsa ses, ikisine de bağlı bir arkadaş üzerinden geçer
- Hesap yok, kayıt yok, ücret yok
- Windows uygulamasında oyundayken `Ctrl+Shift+M` mikrofon, `Ctrl+Shift+D` kulaklık, `Ctrl+Shift+K` klip
- Windows uygulamasında oyunun üstünde konuşanlar listesi. Oyunun içine girmez, oyun pencereli tam ekranda olmalı
- Android uygulamasında ekran kapalıyken görüşme sürer

## Nasıl çalışır

Telsiz'in sunucusu yok, o yüzden ödenecek fatura da yok.

- Site GitHub Pages'ten gelir.
- Cihazlar birbirini herkese açık Nostr röleleri üzerinden bulur ([Trystero](https://github.com/dmotz/trystero)). Rölelerden geçen bağlantı bilgisi grup koduyla şifrelidir.
- Bulduktan sonra ses, görüntü, mesaj ve dosya WebRTC ile doğrudan cihazdan cihaza, uçtan uca şifreli akar.
- Grup kodu grubun tek anahtarıdır. Kodu bilen gruba girer.

## Güvenlik

- Her cihaz kendi anahtarını üretir, kullanıcı bir şey yapmaz. Mesajlar imzalanır, kimlik ilk görülen anahtara bağlanır ve başka anahtarla gelen reddedilir.
- Özel sohbet mesajları uçtan uca şifrelenir, cihazda da şifreli durur. Özel sohbet dosyaları sadece üyelere gönderilir.
- Silinen mesajın metni, düzenlemeleri ve dosyası cihazlardan kalkar, gruba yeni girene gitmez. Kapalı cihazdaki kopya, cihaz açılıp eşitlenince silinir.
- Yedek kodu gizli anahtarı taşır, şifre gibi saklanmalı.
- Davet linki olan kanalları ve eski kanal mesajlarını görür, kimseyi gruptan atma özelliği yok. Link sızarsa yeni grup kurulmalı.
- Kimlik ilk görüşte güvene dayanır. Bu sürümden eski mesajlar imzasız ve eski özel mesajlar cihazda şifresiz kalır.
- Cihaza erişen biri, o cihazdaki hesabı kullanabilir.

## Sınırlar

- Mesaj sadece grupta biri çevrimiçiyken yayılır. Herkes kapalıyken yazılan, ilk açılan kişide durur ve sonra eşitlenir.
- Dosya, sahibi ya da indirmiş biri çevrimiçiyken alınabilir. 300 MB üstü dosyalar uygulama kapanınca cihazda kalmaz.
- Uygulama tamamen kapalıysa çağrı bildirimi gelmez.
- Bazı operatörlerin ağları doğrudan bağlantıyı engeller. Aradaki arkadaş sadece sesi taşır, görüntüyü ve ekranı taşımaz. Kimse aradan bağlanamıyorsa Ayarlar > Gelişmiş bölümüne ücretsiz bir TURN hesabı girilebilir.

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
node e2e/relay.mjs
node e2e/features.mjs
node e2e/security.mjs
node e2e/tv.mjs
node e2e/voicelink.mjs
node e2e/twodevice.mjs
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
