import { z } from 'zod';

// ---------------------------------------------------------------------------
// Reusable primitives
// ---------------------------------------------------------------------------

/** Israeli phone numbers: 05x-xxxxxxx or +972-5x-xxxxxxx (loose validation) */
const israeliPhoneRegex = /^(\+972|0)([23489]|5[0-9]|77)[\-\s]?[0-9]{3}[\-\s]?[0-9]{4}$/;

const phoneSchema = z
  .string()
  .min(9, 'מספר הטלפון קצר מדי')
  .max(20, 'מספר הטלפון ארוך מדי')
  .regex(israeliPhoneRegex, 'אנא הזן מספר טלפון ישראלי תקין');

const emailSchema = z
  .string()
  .email('אנא הזן כתובת דוא"ל תקינה')
  .max(254, 'כתובת הדוא"ל ארוכה מדי');

const nameSchema = z
  .string()
  .min(2, 'השם חייב להכיל לפחות 2 תווים')
  .max(100, 'השם ארוך מדי')
  .regex(/^[\u0590-\u05FFa-zA-Z\s'\-\.]+$/, 'השם מכיל תווים לא חוקיים');

const messageSchema = z
  .string()
  .min(10, 'ההודעה חייבת להכיל לפחות 10 תווים')
  .max(2000, 'ההודעה ארוכה מדי (מקסימום 2000 תווים)');

// ---------------------------------------------------------------------------
// Lead / Contact form schema  (used by POST /api/leads)
// ---------------------------------------------------------------------------

export const leadSchema = z.object({
  full_name: nameSchema,
  email: emailSchema,
  phone: phoneSchema,
  legal_area: z
    .enum([
      'criminal',
      'civil',
      'family',
      'real_estate',
      'corporate',
      'labor',
      'administrative',
      'other',
    ])
    .optional()
    .default('other'),
  message: messageSchema,
  preferred_contact: z.enum(['phone', 'email', 'whatsapp']).optional().default('phone'),
  consent: z
    .literal(true, {
      errorMap: () => ({ message: 'נדרשת הסכמה לתנאי הפרטיות' }),
    }),
  source: z.string().max(100).optional().default('website'),
  // Honeypot — must remain empty
  _hp: z.string().max(0, 'Spam detected').optional(),
});

export type LeadInput = z.infer<typeof leadSchema>;

// ---------------------------------------------------------------------------
// Newsletter / quick-subscribe schema
// ---------------------------------------------------------------------------

export const newsletterSchema = z.object({
  email: emailSchema,
  consent: z.literal(true, {
    errorMap: () => ({ message: 'נדרשת הסכמה לתנאי הפרטיות' }),
  }),
});

export type NewsletterInput = z.infer<typeof newsletterSchema>;
