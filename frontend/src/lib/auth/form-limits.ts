/** Bound every text field before parsing, echoing or expensive Auth operations. */
export const AUTH_FORM_MAX_BYTES = 8192;
export function authFormWithinLimit(form: unknown): boolean {
    if (!(form instanceof FormData)) return false;
    let bytes = 0;
    let fields = 0;
    for (const [key, value] of form.entries()) {
        if (++fields > 16 || key.length > 64 || typeof value !== "string" || value.length > AUTH_FORM_MAX_BYTES)
            return false;
        bytes += new TextEncoder().encode(key).length + new TextEncoder().encode(value).length;
        if (bytes > AUTH_FORM_MAX_BYTES)
            return false;
    }
    return true;
}
