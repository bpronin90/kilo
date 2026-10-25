// User-facing copy for the MCP authorization and connection surfaces (#1626).
// Kept in one place so the disclosure, the disconnect wording and the tests agree.

export const DISCLOSURE = Object.freeze({
  title: 'Connect an AI client',
  clientNotice: 'Provided by the client, not verified by Kilo.',
  access: 'This client can read the workout notes and weight entries that are already synced to your Kilo Cloud account. It is read-only: it cannot change anything, and it cannot see data that exists only on a device.',
  transmission: 'If you approve, your workout notes and weight entries are sent to this client when it asks for them. The client’s provider handles that data under its own terms, and Kilo cannot recall data that was already sent.',
  disconnect: 'You can disconnect it any time in Account → Connected AI clients. Signing out of Kilo ends the client’s current session but does not disconnect it: the connection stays listed, and the client can ask to reconnect.',
  approve: 'Approve',
  deny: 'Deny',
});

export const STATE_COPY = Object.freeze({
  invalid: {
    title: 'This link isn’t valid',
    body: 'The authorization request is missing or malformed. Go back to your AI client and start the connection again.',
  },
  signedOut: {
    title: 'Sign in to continue',
    body: 'Sign in to the Kilo account you want to connect, then review the request. Nothing is approved until you choose Approve.',
  },
  loading: {
    title: 'Checking the request…',
    body: 'Kilo is confirming this request with the sign-in service.',
  },
  gone: {
    title: 'This request can’t be used',
    body: 'It has expired, was already used or denied, or doesn’t belong to this account. Go back to your AI client and start the connection again.',
  },
  unavailable: {
    title: 'Couldn’t reach the sign-in service',
    body: 'The request could not be checked right now. Nothing was approved. Try again.',
  },
  ended: {
    title: 'Request closed',
    body: 'The account changed or you signed out, so this request was closed. Nothing was approved. Start again from your AI client.',
  },
  consentMissing: {
    title: 'Cloud Sync consent needed first',
    body: 'Kilo could not confirm your Cloud Sync health-data consent, which an AI client needs before it can read anything. Approving is unavailable, and this does not turn on Cloud Sync or grant consent. You can deny this request. Local use of Kilo is not affected.',
  },
  redirecting: {
    title: 'Returning to the AI client…',
    body: 'Your choice was recorded.',
  },
  decisionFailed: 'Your choice could not be recorded. Nothing was approved or denied. Try again.',
});

export const CONNECTIONS_COPY = Object.freeze({
  title: 'Connected AI clients',
  note: 'AI clients you have approved to read your synced workout notes and weight entries. Disconnect ends a client’s access. Signing out of Kilo is separate: it ends sessions but keeps these connections listed.',
  empty: 'No AI clients are connected.',
  loading: 'Loading connected clients…',
  loadFailed: 'Couldn’t load connected clients.',
  retry: 'Retry',
  disconnect: 'Disconnect',
  confirmTitle: 'Disconnect this client?',
  confirmBody: (name) => `${name} will lose access to your Kilo data. It can ask to reconnect, and you will be asked to approve again. Data it already received is not recalled.`,
  cancel: 'Cancel',
  working: 'Disconnecting…',
  revoked: (name) => `${name} was disconnected.`,
  revokeFailed: (name) => `Couldn’t disconnect ${name}. It is still connected. Try again.`,
});
