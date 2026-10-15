import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";

type DB = SupabaseClient<Database>;
export type NetworkCandidateRow = Database["public"]["Views"]["my_network_candidates"]["Row"];

/** Candidates the caller (or their referring organization) submitted. RLS-scoped; newest first. */
export async function listMyNetworkCandidates(supabase: DB, kind?: "supplier" | "craftsman"): Promise<NetworkCandidateRow[]> {
  let q = supabase.from("my_network_candidates").select("*").order("created_at", { ascending: false }).limit(50);
  if (kind) q = q.eq("candidate_kind", kind);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}
