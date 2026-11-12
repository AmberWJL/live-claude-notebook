import { describe, expect, test } from 'claude-code/testing'

import { sshLoginOf, webTunnel } from '../src/services/web-tunnel'

describe('web tunnel', () => {
  test('names the host by its host name, else the address the connection reached', () => {
    expect(sshLoginOf('203.0.113.5 50000 10.0.0.9 22', 'build-box\n', 'amber')).toEqual({ user: 'amber', host: 'build-box' })
    expect(sshLoginOf('203.0.113.5 50000 10.0.0.9 22', '', 'amber')).toEqual({ user: 'amber', host: '10.0.0.9' })
    expect(sshLoginOf('', '', 'amber')).toBeUndefined()
  })

  test('leaves out a user or host the command could not carry unquoted', () => {
    expect(sshLoginOf('203.0.113.5 50000 10.0.0.9 22', 'box; rm -rf ~', 'amber')).toEqual({ user: 'amber', host: '10.0.0.9' })
    expect(sshLoginOf('203.0.113.5 50000 10.0.0.9 22', 'build-box', 'a b')).toEqual({ user: '', host: 'build-box' })
  })

  test('forwards the next port up to the server, and names the page at the near end', () => {
    expect(webTunnel({ user: 'amber', host: 'build-box' }, 47231, '/#/General%2Fa.md')).toEqual({
      host: 'build-box',
      command: 'ssh -N -o ExitOnForwardFailure=yes -L 47232:127.0.0.1:47231 amber@build-box',
      url: 'http://127.0.0.1:47232/#/General%2Fa.md',
    })
    expect(webTunnel({ user: '', host: '10.0.0.9' }, 65535, '').command).toBe('ssh -N -o ExitOnForwardFailure=yes -L 65534:127.0.0.1:65535 10.0.0.9')
  })
})
