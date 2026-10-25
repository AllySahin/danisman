# Danışman Paneli

Psikolojik danışmanlar için danışan, seans, ödeme ve aylık kazanç takibi yapan yüklenebilir web uygulaması (PWA).

## Özellikler
- Danışan ekleme
- Seans oluşturmadan danışan kaydetme
- Seansları sonradan ayrıca planlama
- Online / 100 Yüze kategorisi takibi
- Seans tarihi ve ücret kaydı
- Ödendi / Ödenmedi durumu
- Ödenen tutar ve borç takibi
- Her danışan için detay paneli
- Ay bazlı toplam gelir, gider, net kazanç ve borç görünümü
- Veriler cihazdaki IndexedDB veritabanında saklanır
- Çevrimdışı açılış için uygulama kabuğu önbelleğe alınır
- Eski localStorage kayıtları ilk açılışta IndexedDB'ye aktarılır

## Yerel çalıştırma
1. Proje klasöründe bir terminal açın.
2. Aşağıdaki komutu çalıştırın:

```bash
python -m http.server 8000
```

3. Tarayıcıda şu adresi açın:

```text
http://localhost:8000
```

## Telefona yükleme

Uygulamayı herkese açık bir adreste HTTPS üzerinden yayınlayın. Servis worker, `localhost` ve HTTPS dışındaki adreslerde çalışmaz.

- Android: Chrome menüsünden **Uygulamayı yükle** veya **Ana ekrana ekle** seçin.
- iPhone: Safari'de Paylaş düğmesine, ardından **Ana Ekrana Ekle**'ye dokunun.

Statik dosyalar GitHub Pages, Netlify veya Vercel gibi HTTPS sağlayan bir serviste yayınlanabilir.

## Veri saklama

IndexedDB verileri bu cihazdaki ve bu uygulama adresindeki tarayıcı profilinde saklar; cihazlar arasında otomatik eşitleme yapmaz. Tarayıcı/site verilerini temizlemek kayıtları silebilir. Cihazlar arası kullanım için ayrıca sunucu ve kullanıcı hesabı gerekir.
