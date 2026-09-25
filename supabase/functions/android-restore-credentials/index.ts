// android-restore-credentials Edge Function (issue #1157).
//
// Server trust boundary for Android Restore Credentials. The v1 routes and
// their security rules are in handler.ts; the verification building blocks are
// in ../_shared/android-restore-credentials.ts. This file only wires real
// dependencies.
//
// Deployment: verify_jwt = false in supabase/config.toml. Two routes are
// deliberately unauthenticated (a restoring device has no session yet), and the
// three authenticated routes validate the bearer token themselves through
// identity.userFromToken before acting.
//
// Secrets (fail closed when missing or malformed):
//   KILO_RESTORE_RP_ID            WebAuthn relying-party id (a domain serving
//                                 the matching /.well-known/assetlinks.json)
//   KILO_ANDROID_APK_KEY_HASHES   comma-separated base64url SHA-256 digests of
//                                 the accepted Android signing certificates
//
// Session issuance uses the service-role key for auth.admin.getUserById and
// auth.admin.generateLink, then redeems the link's hashed token with verifyOtp
// on a separate client that never persists or refreshes a session. That is the
// mechanism the user authorized on #1157; no project Auth setting changes.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.108.2'
import {
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from 'https://esm.sh/@simplewebauthn/server@14.0.2'
import { loadRestoreConfig, type RestoreIdentity } from '../_shared/android-restore-credentials.ts'
import { createRestoreHandler } from './handler.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const NO_SESSION = { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false }

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  // schema 'kilo' targets the restore, rate-limit, and security-event RPCs; the
  // auth.admin API is unaffected.
  db: { schema: 'kilo' },
  auth: NO_SESSION,
})

function errorCode(error: { code?: unknown; status?: unknown }): string {
  if (typeof error.code === 'string') return error.code
  if (typeof error.status === 'number') return `http_${error.status}`
  return 'unknown'
}

// Logs nothing: every value passing through here is either an identifier or a
// credential, and failures are classified by the caller from bounded codes.
const identity: RestoreIdentity = {
  async userFromToken(token) {
    const { data, error } = await admin.auth.getUser(token)
    return error || !data.user ? null : { id: data.user.id }
  },

  async getUserById(id) {
    const { data, error } = await admin.auth.admin.getUserById(id)
    if (error) {
      // A deleted or unknown user is ineligible, not an outage.
      if ((error as { status?: number }).status === 404) return { ok: true, user: null }
      return { ok: false, code: errorCode(error) }
    }
    const user = data.user
    return {
      ok: true,
      user: user
        ? {
          id: user.id,
          email: user.email ?? null,
          email_confirmed_at: user.email_confirmed_at ?? null,
          banned_until: (user as { banned_until?: string | null }).banned_until ?? null,
          is_anonymous: user.is_anonymous ?? null,
        }
        : null,
    }
  },

  async generateMagicLink(email) {
    const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
    if (error) return { ok: false, code: errorCode(error) }
    const hashedToken = data.properties?.hashed_token
    if (!data.user?.id || !hashedToken) return { ok: false, code: 'incomplete_link' }
    return { ok: true, userId: data.user.id, hashedToken }
  },

  async verifyMagicLink(hashedToken) {
    // A fresh client per exchange with no storage, so the session exists only
    // in this request's memory until it is returned.
    const exchange = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: NO_SESSION })
    const { data, error } = await exchange.auth.verifyOtp({ type: 'magiclink', token_hash: hashedToken })
    if (error) return { ok: false, code: errorCode(error) }
    const session = data.session
    if (!session?.user?.id) return { ok: false, code: 'no_session' }
    return {
      ok: true,
      session: {
        userId: session.user.id,
        accessToken: session.access_token,
        refreshToken: session.refresh_token,
      },
    }
  },

  async revokeSession(accessToken) {
    await admin.auth.admin.signOut(accessToken, 'local')
  },

  async signOutEverywhere(accessToken) {
    const { error } = await admin.auth.admin.signOut(accessToken, 'global')
    return error ? { ok: false, code: errorCode(error) } : { ok: true }
  },
}

serve(createRestoreHandler({
  admin,
  identity,
  config: loadRestoreConfig((name) => Deno.env.get(name)),
  verifyRegistration: verifyRegistrationResponse,
  verifyAuthentication: verifyAuthenticationResponse,
}))
