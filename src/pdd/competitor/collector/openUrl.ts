export function collectorOpenUrl(job: { navigationUrl?: string; canonicalUrl: string }): string {
  return job.navigationUrl || job.canonicalUrl
}

/** After login has left the login page, reopen the product target, not the login wrapper. */
export function collectorRestoreUrl(job: { restoreUrl?: string; navigationUrl?: string; canonicalUrl: string }): string {
  return job.restoreUrl || job.navigationUrl || job.canonicalUrl
}
