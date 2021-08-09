const fetch = require('@dollarshaveclub/node-fetch')
const { request } = require('http')
const Request = fetch.Request
const Response = fetch.Response
const Headers = fetch.Headers

const DEFAULT_CF_BOTSCORE = 100
const CF_BOTSCORE_HEADER = 'x-cloudworker-botscore'

async function fetchShim (...args) {
  let req = new Request(...args)

  // In Cloudflare Workers, host header
  // is ignored
  req.headers.delete('host')

  // In Cloudflare, no upstream requests
  // get streamed so read the entire body in and
  // create a new request with that body.
  // Techinically, this can be disabled by Cloudflare support
  // but it's enabled by default so we will use that as
  // our behavior.
  if (req.body) {
    const body = await req.arrayBuffer()
    req = new Request(req, {body: body})
  }

  const resp = await fetch(req)
  const shim = new ShimResponse(resp.body, resp)
  freezeHeaders(shim.headers)
  return shim
}

function freezeHeaders (headers) {
  Object.defineProperty(headers, 'set', {
    value: (url, status) => {
      throw new TypeError("Can't modify immutable headers")
    },
    writable: false,
  })
  headers.frozen = true
}

class ShimResponse extends Response {
  static redirect (url, status) {
    return new ShimResponse('', {status: status || 302, headers: {Location: url}})
  }

  clone () {
    const cloned = super.clone()
    const res = new ShimResponse(cloned.body, {
      url: cloned.url,
      status: cloned.status,
      statusText: cloned.statusText,
      headers: cloned.headers,
      ok: cloned.ok,
    })

    if (this.headers.frozen) {
      freezeHeaders(res.headers)
    }

    return res
  }
}

class ShimRequest extends Request {
  clone () {
    const cloned = super.clone()
    const req = new ShimRequest(cloned)
    if (this.headers.frozen) {
      freezeHeaders(req.headers)
    }
    if (this.cf) {
      Object.defineProperty(req, 'cf', {value: this.cf, writable: false, enumerable: false})
    }

    return req
  }
}

function bindCfProperty (req) {
  if (!req.cf) {
    const cfValue = Object.assign({
      tlsVersion: 'TLSv1.2',
      tlsCipher: 'ECDHE-ECDSA-CHACHA20-POLY1305',
      country: 'US',
      colo: 'LAX',
    }, req.headers.has(CF_BOTSCORE_HEADER) ? {
      botManagement: {
        score: parseInt(req.headers.get(CF_BOTSCORE_HEADER)),
      },
    } : {})
    Object.defineProperty(req, 'cf', {
      value: cfValue,
      writable: false,
      enumerable: false,
    })
  }
}

module.exports.fetch = fetchShim
module.exports.Request = ShimRequest
module.exports.Response = ShimResponse
module.exports.Headers = Headers
module.exports.freezeHeaders = freezeHeaders
module.exports.bindCfProperty = bindCfProperty
