import { NextResponse } from 'next/server';

export const runtime = 'edge';

export async function GET() {
  return NextResponse.json(
    {
      status: 'ok',
      service: 'law-office-landing',
      timestamp: new Date().toISOString(),
      region: process.env.VERCEL_REGION ?? 'local',
    },
    {
      status: 200,
      headers: {
        'Cache-Control': 'no-store',
        'X-RateLimit-Limit': '60',
        'X-RateLimit-Remaining': '59',
        'X-RateLimit-Reset': String(Math.floor(Date.now() / 1000) + 60),
      },
    }
  );
}
