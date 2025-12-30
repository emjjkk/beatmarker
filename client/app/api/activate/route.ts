import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/client";

export async function POST(req: NextRequest) {
    const supabase = createClient();
    const { licenseKey } = await req.json();

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const user_id = session.user.id;

    // Check if key is valid with Gumroad API (pseudo)
    const isValid = licenseKey.startsWith("PRO"); // Replace with Gumroad verification call

    if (!isValid) return NextResponse.json({ valid: false, error: "Invalid license key" }, { status: 400 });

    // Store key in Supabase
    const { error } = await supabase.from("keys").upsert({
        user_id,
        license_key: licenseKey,
        activated_at: new Date().toISOString()
    }, { onConflict: "user_id" });

    if (error) return NextResponse.json({ valid: false, error: error.message }, { status: 500 });

    return NextResponse.json({ valid: true });
}
