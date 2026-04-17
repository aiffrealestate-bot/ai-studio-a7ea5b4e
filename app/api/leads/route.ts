import { NextRequest, NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { leadSchema } from '@/lib/validation';
import { getSupabaseAdminClient } from '@/lib/supabase';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export const runtime = 'nodejs'; // needs service-role key — not edge

const RATE_LIMIT_WINDOW_SECONDS = 60;
const RATE_LIMIT_MAX_REQUESTS = 5; // 5 form submissions per minute per IP

// Simple in-process rate limiter (replace with Redis/Upstash for production)
const rateLimitMap = new Map<string, { count: number; reset: number }>();

function getRateLimitHeaders(ip: string): {
  headers: Record<string, string>;
  blocked: boolean;
} {
  const now = Math.floor(Date.now() / 1000);
  const entry = rateLimitMap.get(ip);

  if (!entry || now > entry.reset) {
    rateLimitMap.set(ip, { count: 1, reset: now + RATE_LIMIT_WINDOW_SECONDS });
    return {
      blocked: false,
      headers: {
        'X-RateLimit-Limit': String(RATE_LIMIT_MAX_REQUESTS),
        'X-RateLimit-Remaining': String(RATE_LIMIT_MAX_REQUESTS - 1),
        'X-RateLimit-Reset': String(now + RATE_LIMIT_WINDOW_SECONDS),
      },
    };
  }

  entry.count += 1;
  const remaining = Math.max(0, RATE_LIMIT_MAX_REQUESTS - entry.count);
  const blocked = entry.count > RATE_LIMIT_MAX_REQUESTS;

  return {
    blocked,
    headers: {
      'X-RateLimit-Limit': String(RATE_LIMIT_MAX_REQUESTS),
      'X-RateLimit-Remaining': String(remaining),
      'X-RateLimit-Reset': String(entry.reset),
      ...(blocked ? { 'Retry-After': String(entry.reset - now) } : {}),
    },
  };
}

// ---------------------------------------------------------------------------
// POST /api/leads
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  // 1. Resolve client IP
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    request.headers.get('x-real-ip') ??
    '127.0.0.1';

  // 2. Rate limiting
  const { headers: rlHeaders, blocked } = getRateLimitHeaders(ip);
  if (blocked) {
    return NextResponse.json(
      { success: false, error: 'יותר מדי בקשות. אנא נסה שוב בעוד דקה.' },
      { status: 429, headers: rlHeaders }
    );
  }

  // 3. Parse body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: 'גוף הבקשה אינו JSON תקין.' },
      { status: 400, headers: rlHeaders }
    );
  }

  // 4. Honeypot check (before Zod so we exit fast)
  if (
    typeof body === 'object' &&
    body !== null &&
    '_hp' in body &&
    (body as Record<string, unknown>)['_hp'] !== ''
  ) {
    // Silently accept to fool bots
    return NextResponse.json({ success: true }, { status: 200, headers: rlHeaders });
  }

  // 5. Zod validation
  let parsed: ReturnType<typeof leadSchema.parse>;
  try {
    parsed = leadSchema.parse(body);
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json(
        {
          success: false,
          error: 'נתונים שגויים. אנא בדוק את הטופס ונסה שנית.',
          details: err.errors.map((e) => ({ field: e.path.join('.'), message: e.message })),
        },
        { status: 422, headers: rlHeaders }
      );
    }
    return NextResponse.json(
      { success: false, error: 'שגיאת תקיפה בלתי צפויה.' },
      { status: 400, headers: rlHeaders }
    );
  }

  // 6. Strip honeypot before DB insert
  const { _hp, ...safeData } = parsed;

  // 7. Insert into Supabase leads table
  const supabase = getSupabaseAdminClient();
  const { error: dbError } = await supabase.from('leads').insert({
    full_name: safeData.full_name,
    email: safeData.email,
    phone: safeData.phone,
    legal_area: safeData.legal_area,
    message: safeData.message,
    preferred_contact: safeData.preferred_contact,
    consent: safeData.consent,
    source: safeData.source,
    ip_address: ip,
    created_at: new Date().toISOString(),
  });

  if (dbError) {
    console.error('[leads] Supabase insert error:', dbError);
    return NextResponse.json(
      { success: false, error: 'אירעה שגיאה בשמירת הפנייה. אנא נסה שוב מאוחר יותר.' },
      { status: 500, headers: rlHeaders }
    );
  }

  // 8. Success
  return NextResponse.json(
    {
      success: true,
      message: 'פנייתך התקבלה בהצלחה. נציגנו ייצרו עמך קשר בהקדם.',
    },
    { status: 201, headers: rlHeaders }
  );
}

// ---------------------------------------------------------------------------
// OPTIONS — CORS preflight
// ---------------------------------------------------------------------------
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      Allow: 'POST, OPTIONS',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
