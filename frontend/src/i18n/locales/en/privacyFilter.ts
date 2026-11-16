// Privacy filter: copy shared by the admin settings/records page and the user records page
export default {
  title: 'Privacy filter',
  hint: 'Before forwarding to upstream accounts, replaces sensitive data in user text and tool results with [REDACTED:type]. This is best effort, not a security boundary, and does not cover text inside images or PDFs. Rules draw on gitleaks and Presidio.',
  loadFailed: 'Failed to load privacy filter settings',
  saveFailed: 'Failed to save privacy filter settings',
  saved: 'Privacy filter settings saved',
  save: 'Save privacy filter settings',
  mode: 'Mode',
  modes: { off: 'Off', observe: 'Count only', redact: 'Redact', restore: 'Redact and restore' },
  modeHint: {
    off: 'No requests are scanned.',
    observe: 'Scans requests from the selected groups and counts matches by category. Requests are not changed and matched text is never recorded.',
    redact: 'Replaces matches in requests from the selected groups. Replacement cannot be undone. If processing fails, the request is rejected instead of forwarded.',
    restore: 'The upstream sees only placeholders. Responses get the original values back before they reach the client, so agents can use them directly. Originals stay in memory for the request or WebSocket connection only. If processing fails, the request is rejected.'
  },
  restoreNotice: 'Placeholders in thinking and reasoning summaries are not restored, nor are those in history the upstream stores and the request refers to through previous_response_id.',
  redactWarning: 'Redaction cannot be undone. Once a coding agent sees a placeholder it may be unable to edit files against the original text or reach a hidden address. Consider starting with Count only.',
  categoriesTitle: 'Categories',
  categories: {
    private_key: { label: 'Private keys', description: 'PEM and OpenSSH private key blocks, including truncated ones.' },
    public_key: { label: 'Public keys', description: 'SSH public key lines, and PEM public keys or certificates.' },
    credential: { label: 'Passwords and tokens', description: 'Passwords, API keys, access tokens and similar credentials in configs and URLs.' },
    financial: { label: 'Payment cards and IBAN', description: 'Card numbers that pass Luhn and match a card network range, and IBANs that pass validation.' },
    identity: { label: 'National IDs', description: 'IDs with a valid check digit or format: mainland China, Hong Kong, Taiwan, US SSN, UK, Singapore, South Korea, Spain, Brazil. Australian TFN and Medicare, Canadian SIN, Aadhaar, My Number and passports need an adjacent label.' },
    proxy: { label: 'Proxy and VPN node credentials', description: 'Share links (vless://, vmess://, trojan://, ss:// and others), plus UUIDs, Reality short IDs, passwords and subscription tokens in proxy configs. Public keys stay visible.' },
    email: { label: 'Email addresses', description: 'Email addresses, excluding SSH targets, noreply addresses and example domains.' },
    ip: { label: 'IP addresses', description: 'IPv4 and IPv6 addresses, excluding loopback addresses and version-like numbers.' }
  },
  groups: 'Groups',
  groupsHint: 'Applies only to the selected groups. With no group selected, no requests are processed.',
  stats: {
    scanned: 'Scanned {count}',
    hit: 'Matched {count}',
    redacted: 'Redacted {count}',
    failed: 'Failed {count}',
    dropped: 'Records not saved {count}',
    restored: 'Restored {restored}, unresolved {unresolved}',
    category: '{count} matches on this instance.'
  },
  searchGroups: 'Search group name or platform',
  noGroups: 'No groups available',
  adminDescription: 'Configure filtering of sensitive data before forwarding, and review matches across all users',
  userDescription: 'Requests of yours that matched the privacy filter before being forwarded upstream',
  tabs: { records: 'Records', settings: 'Settings' },
  records: {
    adminHint: 'One record per request that matched the privacy filter. Only categories and counts are stored, never the matched text. Records share the "Request log retention days" setting in Ops monitoring with usage records and are removed automatically when it expires.',
    userHint: 'A record is kept when one of your requests matches the privacy filter before it is forwarded upstream. Only categories and counts are shown; matched text is never stored.',
    loadFailed: 'Failed to load privacy filter records',
    empty: 'No privacy filter records in this period',
    deletedKey: 'Deleted key',
    hitCount: '{count} matches',
    columns: {
      time: 'Time',
      user: 'User',
      apiKey: 'API key',
      group: 'Group',
      model: 'Model',
      endpoint: 'Endpoint',
      action: 'Action',
      categories: 'Categories',
      requestId: 'Request ID'
    },
    filters: {
      dateRange: 'Date range',
      action: 'Action',
      category: 'Category',
      apiKey: 'API key',
      search: 'Search',
      searchPlaceholder: 'Email, key name or model',
      requestId: 'Request ID',
      all: 'All',
      reset: 'Reset',
      refresh: 'Refresh'
    },
    actions: {
      observe: 'Counted',
      redact: 'Redacted',
      restore: 'Redacted, restorable',
      failed: 'Failed, rejected'
    }
  }
}
