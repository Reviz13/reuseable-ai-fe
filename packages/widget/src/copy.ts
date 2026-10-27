export const SESSION = "Sesi berakhir, silakan muat ulang.";
export const RATE_LIMITED = "Terlalu banyak pertanyaan, tunggu sebentar ya.";
export const TOO_LONG = "Pertanyaan terlalu panjang (maksimal 2000 karakter).";
export const NETWORK = "Koneksi bermasalah, coba lagi.";
export const NOT_FOUND_CONVERSATION = "Percakapan tidak ditemukan, silakan kirim ulang pertanyaan.";
export const GENERIC = "Terjadi kesalahan, coba lagi.";
export const MAX_MESSAGE_CHARS = 2000;

const LABELS = {
  id: {
    placeholder: "Tulis pertanyaan…",
    send: "Kirim",
    close: "Tutup",
    helpful: "Jawaban membantu",
    unhelpful: "Jawaban kurang membantu",
    defaultName: "Asisten",
  },
  en: {
    placeholder: "Ask a question…",
    send: "Send",
    close: "Close",
    helpful: "Helpful answer",
    unhelpful: "Unhelpful answer",
    defaultName: "Assistant",
  },
} as const;
export type Labels = (typeof LABELS)["id"] | (typeof LABELS)["en"];
export const labelsFor = (lang: string | null | undefined): Labels =>
  lang?.toLowerCase().startsWith("en") ? LABELS.en : LABELS.id;
