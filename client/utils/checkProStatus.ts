import { createClient } from "./supabase/server";

export async function checkProStatus(supabaseClient: ReturnType<typeof createClient>) {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) return false;

    const { data, error } = await supabaseClient
        .from("keys")
        .select("license_key")
        .eq("user_id", session.user.id)
        .single();

    if (error || !data?.license_key) return false;
    return true;
}
