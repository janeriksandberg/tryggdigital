// Språk som kan velges. Nytt språk: lag lang/<kode>.js med samme nøkler som en.js (minst tekstene for plukkere
// og personvern), og legg det til her. Manglende tekster vises på engelsk.
// scope: 'full' = hele appen, 'worker' = det plukkere/sprøytere ser (kiosk, kort, personvern); resten vises på engelsk.
export const LANGS = [
  { code: 'nb', name: 'Norsk', en: 'Norwegian', locale: 'nb-NO', dir: 'ltr', scope: 'full' },
  { code: 'en', name: 'English', en: 'English', locale: 'en-GB', dir: 'ltr', scope: 'full' },
  { code: 'pl', name: 'Polski', en: 'Polish', locale: 'pl-PL', dir: 'ltr', scope: 'worker' },
  { code: 'lt', name: 'Lietuvių', en: 'Lithuanian', locale: 'lt-LT', dir: 'ltr', scope: 'worker' },
  { code: 'uk', name: 'Українська', en: 'Ukrainian', locale: 'uk-UA', dir: 'ltr', scope: 'worker' },
  { code: 'ro', name: 'Română', en: 'Romanian', locale: 'ro-RO', dir: 'ltr', scope: 'worker' },
  { code: 'vi', name: 'Tiếng Việt', en: 'Vietnamese', locale: 'vi-VN', dir: 'ltr', scope: 'worker' },
];
