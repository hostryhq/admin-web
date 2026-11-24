/**
 * admin-web English catalogue. Keys `admin.<screen>.<name>` follow docs/design/admin-a0-flows.md.
 * Merged over the ui-kit catalogue. Tamil and Malayalam are not offered in A0 (English only);
 * keep strings short and free of concatenation so they survive translation later.
 */
export const en = {
  "admin.app.name": "Hostry Admin",
  "admin.nav.label": "Main",
  "admin.nav.signout": "Sign out",
  "admin.nav.shortcuts": "Shortcuts",
  "admin.nav.user": "Signed in as {name}",

  "admin.offline.back": "Back online. Reload to see current data.",
  "admin.offline.stale": "Stale, loaded {time} IST",
  "admin.offline.needs": "Needs connection",

  "admin.error.forbidden": "You do not have access to this.",
  "admin.error.forbidden.back": "Go to organisations",
  "admin.error.notfound": "This page does not exist.",
  "admin.placeholder": "This screen is built in the next step.",
  "admin.placeholder.screen": "Screen {n}",

  "admin.signin.title": "Sign in",
  "admin.signin.email": "Email",
  "admin.signin.password": "Password",
  "admin.signin.code": "Code",
  "admin.signin.code.hint": "6-digit code from your authenticator app",
  "admin.signin.submit": "Sign in",
  "admin.signin.submitting": "Signing in...",
  "admin.signin.error": "Sign-in failed. Check your details and try again.",
  "admin.signin.again": "Sign in again",

  "admin.setup.title": "Set up your account",
  "admin.session.title": "You were signed out",
  "admin.session.ended.idle": "You were signed out after {n} minutes of inactivity.",
  "admin.session.ended.limit": "Your session reached its {n}-hour limit.",
  "admin.session.ended.generic": "Your session ended.",
  "admin.session.warn": "Signing out in {n} min.",
  "admin.session.warn.title": "Still there?",
  "admin.session.stay": "Stay signed in",

  "admin.staff.title": "Vendor staff",
  "admin.orgs.title": "Organisations",
  "admin.orgs.new": "New organisation",
  "admin.orgs.detail.title": "Organisation",
  "admin.orgs.created.title": "Organisation created",
  "admin.orgs.devices.title": "Devices",
  "admin.audit.title": "Audit log",
  "admin.audit.title.own": "Your activity",
  "admin.support.title": "Support session",
  "admin.support.ended.title": "Support session ended",
  "admin.support.ended.back": "Back to organisations",

  "admin.shortcuts.title": "Keyboard shortcuts",
  "admin.shortcuts.orgs": "Go to organisations",
  "admin.shortcuts.audit": "Go to audit log",
  "admin.shortcuts.staff": "Go to vendor staff",
  "admin.shortcuts.search": "Focus organisation search",
  "admin.shortcuts.new": "New organisation",
  "admin.shortcuts.rows": "Move row selection",
  "admin.shortcuts.open": "Open selected row",
  "admin.shortcuts.close": "Close dialog or clear search",
  "admin.shortcuts.submit": "Submit form or dialog",
  "admin.shortcuts.tabs": "Switch tab",
  "admin.shortcuts.help": "Show this sheet",
  "admin.shortcuts.endsession": "End support session",
  "admin.shortcuts.keys.go": "g then {key}",
} as const satisfies Record<string, string>;
