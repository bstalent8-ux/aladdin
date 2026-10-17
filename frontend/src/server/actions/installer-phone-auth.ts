"use server";
import { phonePasswordSignIn, phonePasswordSignUp, type CraftsmanAuthState } from "@/server/auth/phone-password";
import { entryEmailSignIn, entryEmailSignUp } from "@/server/auth/entry-email";
import type { PasswordAuthState } from "@/server/actions/auth-password-preview";
export type { CraftsmanAuthState, CraftsmanField } from "@/server/auth/phone-password";
export async function craftsmanSignUp(prev: CraftsmanAuthState, form: FormData) {
  return phonePasswordSignUp("installer", prev, form);
}
export async function craftsmanSignIn(prev: CraftsmanAuthState, form: FormData) {
  return phonePasswordSignIn("installer", prev, form);
}
export async function craftsmanEmailSignUp(prev: PasswordAuthState, form: FormData) {
  return entryEmailSignUp("installer", prev, form);
}
export async function craftsmanEmailSignIn(prev: CraftsmanAuthState, form: FormData) {
  return entryEmailSignIn("installer", prev, form);
}
