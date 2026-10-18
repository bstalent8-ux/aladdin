"use server";
import { phonePasswordSignIn, phonePasswordSignUp, type CraftsmanAuthState } from "@/server/auth/phone-password";
import { entryEmailSignIn, entryEmailSignUp } from "@/server/auth/entry-email";
import type { PasswordAuthState } from "@/server/actions/auth-password-preview";
export async function showroomSignUp(prev: CraftsmanAuthState, form: FormData) {
    return phonePasswordSignUp("showroom", prev, form);
}
export async function showroomSignIn(prev: CraftsmanAuthState, form: FormData) {
    return phonePasswordSignIn("showroom", prev, form);
}
export async function showroomEmailSignUp(prev: PasswordAuthState, form: FormData) {
    return entryEmailSignUp("showroom", prev, form);
}
export async function showroomEmailSignIn(prev: CraftsmanAuthState, form: FormData) {
    return entryEmailSignIn("showroom", prev, form);
}
