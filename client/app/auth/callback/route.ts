import { createClient } from '@/utils/supabase/server'
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'

export async function GET(request: Request) {
  const requestUrl = new URL(request.url)
  const code = requestUrl.searchParams.get('code')
  const origin = requestUrl.origin

  if (code) {
    const supabase = createClient(cookies())
    await supabase.auth.exchangeCodeForSession(code)
  }

  // Redirect to home page which will handle the welcome message
  return NextResponse.redirect(`${origin}/?auth=success`)
}