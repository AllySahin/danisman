# Danışman Paneli

Psikolojik danışmanlar için danışan, seans, ödeme ve aylık kazanç takibi yapan yüklenebilir web uygulaması (PWA).

## Özellikler
- Danışan ekleme
- Seans tarihi ve saati olmadan danışan kaydetme
- Seansları sonradan ayrıca planlama
- Online / 100 Yüze kategorisi takibi
- Seans tarihi ve ücret kaydı
- Ödendi / Ödenmedi durumu
- Ödenen tutar ve borç takibi
- Her danışan için seans geçmişi ve gelir, iptal, erteleme istatistiklerini gösteren ayrı detay sayfası
- İptal edilen seans kaydını kalıcı silme; danışan bazında yalnızca iptal sayısını saklama
- Her seans için özet yazıldı / yazılmadı durumunu takip etme
- Ay bazlı toplam gelir, gider, net kazanç ve borç görünümü
- Veriler Supabase bulut veritabanı ile telefon ve tablet arasında eşitlenir
- Çevrimdışı yerel IndexedDB kopyası, internet bağlantısı kesildiğinde yedek olarak tutulur
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

## Supabase kurulumu

1. Supabase projesinde **Project Settings → API** bölümündeki Project URL ve Publishable key (eski projelerde anon/public key) değerlerini `supabase-config.js` içine girin. Bu anahtar uygulamada herkese açık olabilir; **service_role/secret key'i kesinlikle buraya koymayın**.
2. `supabase-schema.sql` içeriğini Supabase SQL Editor'da bir kez çalıştırın. Bu, giriş yapmış kullanıcıya ait satırı RLS ile sınırlar ve eşzamanlı güncellemelerin sessizce birbirini ezmesini önlemek için sürüm kontrolü ekler.
3. Supabase **Authentication → Users** sayfasında e-posta adresi olarak `mukerrem.sahin@danisman.invalid` ile kullanıcı oluşturun ve e-posta doğrulaması istemeyen, elle onaylanmış bir kullanıcı olarak ayarlayın. Bu, gerçek e-posta adresi değildir; uygulama girişindeki `Mükerrem Şahin` kullanıcı adına karşılık gelen dahili Supabase kimliğidir. Şifreyi Supabase panelinde belirleyin; kod içine veya Git'e eklemeyin. Kullanıcı kaydını yalnızca siz oluşturacağınız için herkese açık kayıt olmayı kapatın.
4. Uygulamayı HTTPS üzerinden yayınlayın; telefonda ve tablette aynı adrese ekleyin. Her cihazda kullanıcı adı/şifre ile bir kez giriş yaptıktan sonra oturum cihazda hatırlanır. Değişiklikler kendiliğinden Supabase'e gönderilir; diğer cihazdaki güncellemeler uygulama açıkken periyodik ve uygulama yeniden öne geldiğinde arka planda alınır.
5. İlk girişte bu tarayıcıdaki mevcut IndexedDB kaydı Supabase'e aktarılır. Sonraki açılışlarda bulut verisi esas alınır. Kod ve uygulama kabuğu güncellense de Supabase tablosundaki veriler silinmez.

Anon/Publishable key tarayıcıda görülebilir olduğundan RLS politikalarını kapatmayın ve service_role anahtarını istemciye koymayın. Supabase projesi için ayrıca düzenli yedekleme etkinleştirin.

## Yerel yedek ve veri saklama

Supabase bulut kaydı cihazlar arasında ortak ana kopyadır. IndexedDB yalnızca yerel yedek/çevrimdışı kopyadır; tarayıcı veya site verilerinin temizlenmesi yerel kopyayı kaldırabilir, ancak buluta başarıyla eşitlenmiş veriyi silmez. Bulut bağlantısı başarısız olduğunda uygulama eşitleme hatasını gösterir ve yerel kopyayı korur. Sürüm çakışması olursa uygulama bunu bildirir; diğer cihazdaki veriyi sessizce ezmez.
