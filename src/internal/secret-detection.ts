const SECRET_PATTERNS = [
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/i,
  /-----BEGIN CERTIFICATE-----/i,
  /\b(?:bearer|basic)\s+[A-Za-z0-9+/._~=-]{8,}/i,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/,
  /\bAKIA[A-Z0-9]{16}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/i,
  /\bsk-[A-Za-z0-9_-]{16,}\b/,
  /\b(?:sk|pk)_(?:live|test)_[A-Za-z0-9_-]{12,}\b/i,
  /\b(?:password|passcode|passwd|secret|token|access[_-]?token|refresh[_-]?token|api[_-]?key|authorization|cookie|session|otp|totp|cvv|cvc|card(?:number)?|payment|webauthn|certificate|private[_-]?key)\s*[:=]\s*\S+/i,
  /\b(?:secret|password|passcode|credential|token|otp|session|api[_-]?key)[-_:][A-Za-z0-9_-]{6,}\b/i,
  /\bwebauthn[:_-][A-Za-z0-9_-]{12,}\b/i,
] as const;

const hasLuhnPaymentNumber = (value: string): boolean => {
  const candidates = value.match(/(?:\d[ -]?){13,19}/g) ?? [];
  return candidates.some((candidate) => {
    const digits = candidate.replaceAll(/[ -]/g, "");
    if (digits.length < 13 || digits.length > 19) return false;
    let sum = 0;
    let alternate = false;
    for (let index = digits.length - 1; index >= 0; index -= 1) {
      let digit = Number(digits[index]);
      if (alternate) {
        digit *= 2;
        if (digit > 9) digit -= 9;
      }
      sum += digit;
      alternate = !alternate;
    }
    return sum % 10 === 0;
  });
};

export const containsSecretSentinel = (value: string): boolean =>
  SECRET_PATTERNS.some((pattern) => pattern.test(value)) ||
  /^\d{6}$/.test(value) ||
  hasLuhnPaymentNumber(value);

export const isSensitiveKey = (value: string): boolean =>
  /^(?:pass(?:word|code)?|passwd|secret|token|access[_-]?token|refresh[_-]?token|api[_-]?key|authorization|cookie|session|otp|totp|cvv|cvc|card(?:number)?|payment|webauthn|certificate|private[_-]?key)$/i.test(
    value,
  );
