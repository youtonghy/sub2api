import { describe, expect, it } from 'vitest'

import { PROXY_URL_REGEX, parseProxyUrl } from '../proxyHelpers'

// Vue 版从 ProxiesView.vue 源码里抽取正则再测试；React 版把解析逻辑导出，直接对正则与 parseProxyUrl 断言。
describe('proxy batch URL parsing (IPv6 support)', () => {
  it('keeps bracketed-IPv6 host alternative in the regex', () => {
    expect(PROXY_URL_REGEX.source).toContain('\\[[0-9a-f:.]+\\]')
  })

  const regex = PROXY_URL_REGEX

  it.each([
    ['socks5://[2001:db8::1]:1080', true],
    ['socks5h://[2001:db8::1]:1080', true],
    ['http://[::1]:8080', true],
    ['socks5://user:pass@[2001:db8::1]:1080', true],
    ['socks5://proxy.example.com:1080', true],
    ['http://192.168.1.1:8080', true],
    ['socks5://user:pass@proxy.example.com:1080', true],
    // bare IPv6 without brackets is ambiguous with host:port — rejected
    ['socks5://2001:db8::1:1080', false],
    // unsupported schemes / malformed ports stay invalid
    ['ftp://example.com:21', false],
    ['socks5://example.com:port', false]
  ])('%s => %s', (line, expected) => {
    expect(regex.test(line)).toBe(expected)
  })

  it('extracts bare IPv6 host without brackets', () => {
    const m = 'socks5://user:pass@[2001:db8::1]:1080'.match(regex)
    expect(m).toBeTruthy()
    const [, , username, password, rawHost, port] = m as RegExpMatchArray
    expect(username).toBe('user')
    expect(password).toBe('pass')
    expect(rawHost.replace(/^\[|\]$/g, '')).toBe('2001:db8::1')
    expect(port).toBe('1080')
    expect(parseProxyUrl('socks5://user:pass@[2001:db8::1]:1080')).toEqual({
      protocol: 'socks5',
      host: '2001:db8::1',
      port: 1080,
      username: 'user',
      password: 'pass'
    })
  })
})
