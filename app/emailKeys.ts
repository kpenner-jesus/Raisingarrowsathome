// ============================================================
//  emailKeys.ts — EMAILJS CREDENTIALS FOR RAISING ARROWS
//
//  Replace the placeholder values with your real EmailJS keys.
//  Get them from: https://emailjs.com → Account → API Keys
//
//  SERVICE_ID:   Dashboard → Email Services → your service
//  TEMPLATE_ID:  Dashboard → Email Templates → org notification
//  GUEST_TEMPLATE_ID: Dashboard → Email Templates → applicant confirmation
//  PUBLIC_KEY:   Dashboard → Account → General → Public Key
// ============================================================

export const EMAIL_KEYS = {
  SERVICE_ID:        process.env.NEXT_PUBLIC_EMAILJS_SERVICE_ID        ?? "",
  TEMPLATE_ID:       process.env.NEXT_PUBLIC_EMAILJS_TEMPLATE_ID       ?? "",
  GUEST_TEMPLATE_ID: process.env.NEXT_PUBLIC_EMAILJS_GUEST_TEMPLATE_ID ?? "",
  PUBLIC_KEY:        process.env.NEXT_PUBLIC_EMAILJS_PUBLIC_KEY        ?? "",
};
