"use server";
import { phonePasswordSignIn, phonePasswordSignUp, type CraftsmanAuthState } from "@/server/auth/phone-password";
export type { CraftsmanAuthState, CraftsmanField } from "@/server/auth/phone-password";
export async function craftsmanSignUp(prev: CraftsmanAuthState, form: FormData) {
  return phonePasswordSignUp("installer", prev, form);
}
export async function craftsmanSignIn(prev: CraftsmanAuthState, form: FormData) {
  return phonePasswordSignIn("installer", prev, form);
}
