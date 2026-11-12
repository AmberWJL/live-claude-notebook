/**
 * A session on a machine reached over SSH has no screen to open a browser on,
 * and its web notebook listens on that machine's own 127.0.0.1. What it can
 * offer instead: the SSH tunnel to run on the person's own computer, and the
 * page at its near end. Pure; the hooks module reads the environment.
 */

export type SshLogin = { user: string; host: string }

export type WebTunnel = { host: string; command: string; url: string }

/** A name the copied command can carry unquoted: letters, digits, dot, dash, underscore. */
const PLAIN_NAME = /^[\w.-]+$/

/**
 * The login to name in the command: this machine's host name, else the
 * address the SSH connection reached (`SSH_CONNECTION`'s third field, which
 * may be a private one), and the user when it is plain; undefined when there
 * is no host to name.
 */
export function sshLoginOf(connection: string, hostname: string, user: string): SshLogin | undefined {
  const reached = connection.trim().split(/\s+/)[2] ?? ''
  const host = [hostname.trim(), reached].find(name => PLAIN_NAME.test(name))
  if (host === undefined) return undefined
  return { user: PLAIN_NAME.test(user) ? user : '', host }
}

/**
 * The tunnel to the server's `port`, and the page `path` (a `#/` route or '')
 * at its near end. The near end is the next port up, as the person's own
 * computer may run its own web notebook on the same default port; with
 * `ExitOnForwardFailure` a port taken there fails loudly.
 */
export function webTunnel(login: SshLogin, port: number, path: string): WebTunnel {
  const localPort = port < 65_535 ? port + 1 : port - 1
  const target = login.user === '' ? login.host : `${login.user}@${login.host}`
  return {
    host: login.host,
    command: `ssh -N -o ExitOnForwardFailure=yes -L ${localPort}:127.0.0.1:${port} ${target}`,
    url: `http://127.0.0.1:${localPort}${path}`,
  }
}
