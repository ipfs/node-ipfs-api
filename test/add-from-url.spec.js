/* eslint-env mocha */
/* eslint max-nested-callbacks: ["error", 8] */
'use strict'

const chai = require('chai')
const dirtyChai = require('dirty-chai')
const expect = chai.expect
chai.use(dirtyChai)
const isNode = require('detect-node')
const path = require('path')
const fs = require('fs')
const http = require('http')
const https = require('https')
const each = require('async/each')
const waterfall = require('async/waterfall')
const parallel = require('async/parallel')

const IPFSApi = require('../src')
const f = require('./utils/factory')

describe('.addFromUrl', () => {
  if (!isNode) { return }

  let ipfsd
  let ipfs

  before(function (done) {
    this.timeout(20 * 1000) // slow CI

    f.spawn({ initOptions: { bits: 1024 } }, (err, _ipfsd) => {
      expect(err).to.not.exist()
      ipfsd = _ipfsd
      ipfs = IPFSApi(_ipfsd.apiAddr)
      done()
    })
  })

  after(function (done) {
    this.timeout(10 * 1000)
    if (!ipfsd) return done()
    ipfsd.stop(done)
  })

  let testServers = []

  const sslOpts = {
    key: fs.readFileSync(path.join(__dirname, 'fixtures', 'ssl', 'privkey.pem')),
    cert: fs.readFileSync(path.join(__dirname, 'fixtures', 'ssl', 'cert.pem'))
  }

  const startTestServer = (handler, opts, cb) => {
    if (typeof opts === 'function') {
      cb = opts
      opts = {}
    }

    const server = opts.secure
      ? https.createServer(sslOpts, handler)
      : http.createServer(handler)

    server.listen((err) => {
      if (err) return cb(err)
      testServers.push(server)
      cb(null, server)
    })
  }

  beforeEach(() => {
    // Instructs node to not reject our snake oil SSL certificate when it
    // can't verify the certificate authority
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = 0
  })

  afterEach((done) => {
    // Reinstate unauthorised SSL cert rejection
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = 1

    each(testServers, (server, cb) => server.close(cb), (err) => {
      testServers = []
      done(err)
    })
  })

  it('http', (done) => {
    const data = Buffer.from(`TEST${Date.now()}`)

    parallel({
      server: (cb) => {
        const handler = (req, res) => {
          res.write(data)
          res.end()
        }
        startTestServer(handler, cb)
      },
      expectedResult: (cb) => ipfs.add(data, cb)
    }, (err, taskResult) => {
      expect(err).to.not.exist()
      const { server, expectedResult } = taskResult

      const url = `http://127.0.0.1:${server.address().port}/`
      ipfs.addFromURL(url, (err, result) => {
        expect(err).to.not.exist()
        expect(result).to.deep.equal(expectedResult)
        done()
      })
    })
  })

  it('https', (done) => {
    const data = Buffer.from(`TEST${Date.now()}`)

    parallel({
      server: (cb) => {
        const handler = (req, res) => {
          res.write(data)
          res.end()
        }
        startTestServer(handler, { secure: true }, cb)
      },
      expectedResult: (cb) => ipfs.add(data, cb)
    }, (err, taskResult) => {
      expect(err).to.not.exist()
      const { server, expectedResult } = taskResult

      const url = `https://127.0.0.1:${server.address().port}/`
      ipfs.addFromURL(url, (err, result) => {
        expect(err).to.not.exist()
        expect(result).to.deep.equal(expectedResult)
        done()
      })
    })
  })

  it('http with redirection', (done) => {
    const data = Buffer.from(`TEST${Date.now()}`)

    waterfall([
      (cb) => {
        const handler = (req, res) => {
          res.write(data)
          res.end()
        }
        startTestServer(handler, cb)
      },
      (serverA, cb) => {
        const url = `http://127.0.0.1:${serverA.address().port}`
        const handler = (req, res) => {
          res.statusCode = 302
          res.setHeader('Location', url)
          res.end()
        }
        startTestServer(handler, (err, serverB) => {
          if (err) return cb(err)
          cb(null, { a: serverA, b: serverB })
        })
      }
    ], (err, servers) => {
      expect(err).to.not.exist()

      ipfs.add(data, (err, res) => {
        expect(err).to.not.exist()

        const expectedHash = res[0].hash
        const url = `http://127.0.0.1:${servers.b.address().port}`

        ipfs.addFromURL(url, (err, result) => {
          expect(err).to.not.exist()
          expect(result[0].hash).to.equal(expectedHash)
          done()
        })
      })
    })
  })

  it('https with redirection', (done) => {
    const data = Buffer.from(`TEST${Date.now()}`)

    waterfall([
      (cb) => {
        const handler = (req, res) => {
          res.write(data)
          res.end()
        }
        startTestServer(handler, { secure: true }, cb)
      },
      (serverA, cb) => {
        const url = `https://127.0.0.1:${serverA.address().port}`
        const handler = (req, res) => {
          res.statusCode = 302
          res.setHeader('Location', url)
          res.end()
        }
        startTestServer(handler, { secure: true }, (err, serverB) => {
          if (err) return cb(err)
          cb(null, { a: serverA, b: serverB })
        })
      }
    ], (err, servers) => {
      expect(err).to.not.exist()

      ipfs.add(data, (err, res) => {
        expect(err).to.not.exist()

        const expectedHash = res[0].hash
        const url = `https://127.0.0.1:${servers.b.address().port}`

        ipfs.addFromURL(url, (err, result) => {
          expect(err).to.not.exist()
          expect(result[0].hash).to.equal(expectedHash)
          done()
        })
      })
    })
  })

  it('with only-hash=true', (done) => {
    const handler = (req, res) => {
      res.write(`TEST${Date.now()}`)
      res.end()
    }

    startTestServer(handler, (err, server) => {
      expect(err).to.not.exist()

      const url = `http://127.0.0.1:${server.address().port}/`

      ipfs.addFromURL(url, { onlyHash: true }, (err, res) => {
        expect(err).to.not.exist()

        // A successful object.get for this size data took my laptop ~14ms
        let didTimeout = false
        const timeoutId = setTimeout(() => {
          didTimeout = true
          done()
        }, 500)

        ipfs.object.get(res[0].hash, () => {
          clearTimeout(timeoutId)
          if (didTimeout) return
          expect(new Error('did not timeout')).to.not.exist()
        })
      })
    })
  })

  it('with wrap-with-directory=true', (done) => {
    const filename = `TEST${Date.now()}.txt`
    const data = Buffer.from(`TEST${Date.now()}`)

    parallel({
      server: (cb) => startTestServer((req, res) => {
        res.write(data)
        res.end()
      }, cb),
      expectedResult: (cb) => {
        ipfs.add([{ path: filename, content: data }], { wrapWithDirectory: true }, cb)
      }
    }, (err, taskResult) => {
      expect(err).to.not.exist()

      const { server, expectedResult } = taskResult
      const url = `http://127.0.0.1:${server.address().port}/${filename}?foo=bar#buzz`

      ipfs.addFromURL(url, { wrapWithDirectory: true }, (err, result) => {
        expect(err).to.not.exist()
        expect(result).to.deep.equal(expectedResult)
        done()
      })
    })
  })

  it('with wrap-with-directory=true and URL-escaped file name', (done) => {
    const filename = '320px-Domažlice,_Jiráskova_43_(9102).jpg'
    const data = Buffer.from(`TEST${Date.now()}`)

    parallel({
      server: (cb) => startTestServer((req, res) => {
        res.write(data)
        res.end()
      }, cb),
      expectedResult: (cb) => {
        ipfs.add([{ path: filename, content: data }], { wrapWithDirectory: true }, cb)
      }
    }, (err, taskResult) => {
      expect(err).to.not.exist()

      const { server, expectedResult } = taskResult
      const url = `http://127.0.0.1:${server.address().port}/${encodeURIComponent(filename)}?foo=bar#buzz`

      ipfs.addFromURL(url, { wrapWithDirectory: true }, (err, result) => {
        expect(err).to.not.exist()
        expect(result).to.deep.equal(expectedResult)
        done()
      })
    })
  })

  it('with invalid url', (done) => {
    ipfs.addFromURL('http://invalid', (err, result) => {
      expect(err.code).to.equal('ENOTFOUND')
      expect(result).to.not.exist()
      done()
    })
  })
})
