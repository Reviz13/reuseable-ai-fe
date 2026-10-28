# Panduan Fitur Aplikasi Hitachi POS (Demo Kopi Tepi)

Dokumen ini menjelaskan fitur yang tersedia di aplikasi demo Hitachi POS untuk outlet Kopi Tepi.

## Peran pengguna
- Owner: dapat melihat seluruh fitur, termasuk Dashboard penjualan dan profit, serta bertanya profit ke NEXUS.
- Kasir: dapat membuat transaksi dan bertanya panduan operasional ke NEXUS, tetapi tidak dapat melihat profit maupun Dashboard.
- Di halaman demo, peran dipilih lewat tombol **Masuk sebagai Owner / Kasir** di bagian atas.

## Halaman Kasir
Berisi daftar menu, pencarian, tab kategori, keranjang pesanan, pilihan metode bayar (Tunai atau QRIS), dan tombol Bayar. Lihat SOP Transaksi dan Pembayaran untuk langkah lengkap.

## Halaman Dashboard (khusus owner)
- Pilih rentang waktu: **Hari ini**, **7 hari**, atau **30 hari**.
- Kartu ringkasan: Penjualan, HPP, Profit beserta margin, jumlah Transaksi, dan Rata-rata per transaksi. Setiap kartu menunjukkan naik atau turun dibandingkan periode sebelumnya.
- Grafik Penjualan dan profit harian: arahkan kursor ke batang untuk melihat angka per hari, atau buka **Lihat sebagai tabel**.
- Produk terlaris: tujuh produk dengan jumlah terjual terbanyak.
- Metode bayar: porsi penjualan Tunai, QRIS, dan Kartu.
- Peringatan item tanpa HPP: muncul jika ada produk terjual yang belum memiliki HPP, sehingga profit belum memperhitungkan biayanya.

## Sesi kasir
Di bagian atas tertulis jumlah transaksi dan omzet yang dibuat pada sesi browser saat ini. Transaksi di halaman demo tidak dikirim ke server, sehingga angka laporan dan Dashboard tidak berubah.

## Struk
Setelah pembayaran berhasil, struk menampilkan nomor order (format KT diikuti empat angka), item, subtotal, PPN, total, dan kembalian.

## Admin Studio
Admin Studio (halaman /login) dipakai pengelola untuk mengatur NEXUS: mengunggah dokumen knowledge (PDF, DOCX, MD, TXT), menulis FAQ, mengatur persona dan avatar, serta melihat pertanyaan yang belum terjawab dan feedback pengguna.
