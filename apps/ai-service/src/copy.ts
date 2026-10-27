// Fixed Indonesian user-facing copy (constraints.md, verbatim).
export const FORBIDDEN = "Hanya owner yang dapat melihat profit.";
export const UPSTREAM = "Data profit sedang tidak bisa diambil, coba lagi sebentar.";
export const NOT_FOUND = "Maaf, saya belum menemukan informasi itu di panduan. Silakan hubungi tim support.";
export const SESSION = "Sesi berakhir, silakan muat ulang.";
export const RATE_LIMITED = "Terlalu banyak pertanyaan, tunggu sebentar ya.";
export const TOO_LONG = "Pertanyaan terlalu panjang (maksimal 2000 karakter).";
/** Ruling 25: a rupiah amount with no successful get_profit result in this turn. */
export const NO_DATA = 'Saya tidak bisa menyebutkan angka tanpa data dari POS. Coba tanyakan, misalnya "Profit minggu ini?"';
/** Fix round 1: the model produced no answer text (e.g. all rounds were tool calls). */
export const EMPTY = "Maaf, saya belum bisa menjawab itu sekarang. Coba ulangi pertanyaannya.";

// Not in the fixed-copy list; used for SSE error events.
export const LLM_UNAVAILABLE = "Asisten sedang tidak tersedia, coba lagi sebentar.";
export const INTERNAL = "Terjadi kesalahan, coba lagi sebentar.";
