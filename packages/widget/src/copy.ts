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
    ready: "Siap membantu",
    thinking: "Sedang berpikir…",
    checking: "Mengecek data…",
    typing: "Mengetik…",
    greeting: (name: string) => `Halo! Aku ${name}. Mau tanya apa hari ini?`,
    nudge: "Halo! Ada yang bisa kubantu?",
    dismiss: "Tutup sapaan",
    suggestions: ["Apa saja yang bisa kamu bantu?", "Profit minggu ini?", "Bagaimana cara membuka shift?"],
  },
  en: {
    placeholder: "Ask a question…",
    send: "Send",
    close: "Close",
    helpful: "Helpful answer",
    unhelpful: "Unhelpful answer",
    defaultName: "Assistant",
    ready: "Ready to help",
    thinking: "Thinking…",
    checking: "Checking data…",
    typing: "Typing…",
    greeting: (name: string) => `Hi! I am ${name}. What would you like to know?`,
    nudge: "Hi! Need a hand?",
    dismiss: "Dismiss greeting",
    suggestions: ["What can you help with?", "Profit this week?", "How do I open a shift?"],
  },
} as const;
export type Labels = (typeof LABELS)["id"] | (typeof LABELS)["en"];
export const labelsFor = (lang: string | null | undefined): Labels =>
  lang?.toLowerCase().startsWith("en") ? LABELS.en : LABELS.id;
