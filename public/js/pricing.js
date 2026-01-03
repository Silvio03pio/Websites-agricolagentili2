import { getSupabase } from "/js/supabaseClient.js";

export function formatEUR(cents) {
  return new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(cents / 100);
}

export function priceForRole(priceCents, role) {
  if (role === "retailer") {
    // 10% sconto, arrotondato al centesimo
    return Math.round((priceCents * 90) / 100);
  }
  return priceCents;
}

export async function getCurrentUserRole() {
  const supabase = await getSupabase();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return { role: "guest", userId: null };

  const userId = session.user.id;

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .single();

  if (error || !profile?.role) return { role: "customer", userId };
  return { role: profile.role, userId };
}
