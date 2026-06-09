import { NextResponse, type NextRequest } from 'next/server';
import { generateRecurringTrips } from '@/lib/recurring-trip-generator';

export const dynamic = 'force-dynamic';

/** SECURITY: CRON_SECRET via Authorization: Bearer (Vercel Cron) or x-cron-secret — see docs/access-control.md */

export async function GET(request: NextRequest) {
  try {
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const authorization = request.headers.get('authorization');
    const bearerMatches = authorization === `Bearer ${cronSecret}`;
    const headerSecret = request.headers.get('x-cron-secret');
    const xCronMatches = headerSecret === cronSecret;
    if (!bearerMatches && !xCronMatches) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    if (
      !process.env.NEXT_PUBLIC_SUPABASE_URL ||
      !process.env.SUPABASE_SERVICE_ROLE_KEY
    ) {
      return NextResponse.json(
        {
          error:
            'Server misconfiguration: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for cron.'
        },
        { status: 500 }
      );
    }

    const result = await generateRecurringTrips();

    return NextResponse.json({
      generated: result.generated,
      skipped: result.skipped,
      errors: result.errors,
      timestamp: new Date().toISOString()
    });
  } catch (error: unknown) {
    console.error('Cron Error generating recurring trips:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
