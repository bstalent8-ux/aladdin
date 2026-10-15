"use server";
import { phonePasswordSignIn, phonePasswordSignUp, type CraftsmanAuthState } from "@/server/auth/phone-password";
export async function showroomSignUp(prev: CraftsmanAuthState, form: FormData) {
    return phonePasswordSignUp("showroom", prev, form);
}
export async function showroomSignIn(prev: CraftsmanAuthState, form: FormData) {
    return phonePasswordSignIn("showroom", prev, form);
}
