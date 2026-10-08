import { OAuth2Client } from "google-auth-library";

// Google caches its rotating public signing certificates; no client secret is needed.
export const googleClient = new OAuth2Client();
