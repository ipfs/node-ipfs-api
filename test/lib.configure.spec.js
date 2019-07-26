/* eslint-env mocha */
'use strict'

const chai = require('chai')
const dirtyChai = require('dirty-chai')
const expect = chai.expect
chai.use(dirtyChai)
const Multiaddr = require('multiaddr')

const configure = require('../src/lib/configure')

describe('lib/configure', () => {
  it('should accept no config', () => {
    configure(config => {
      expect(config.apiAddr).to.eql('http://localhost:5001')
    })()
  })

  it('should accept string multiaddr', () => {
    const input = '/ip4/127.0.0.1/tcp/5001'
    configure(config => {
      expect(config.apiAddr).to.eql('http://127.0.0.1:5001')
    })(input)
  })

  it('should accept multiaddr instance', () => {
    const input = Multiaddr('/ip4/127.0.0.1')
    configure(config => {
      expect(config.apiAddr).to.eql('http://127.0.0.1')
    })(input)
  })

  it('should accept object with protocol, host and port', () => {
    const input = { protocol: 'https', host: 'ipfs.io', port: 138 }
    configure(config => {
      expect(config.apiAddr).to.eql('https://ipfs.io:138')
    })(input)
  })

  it('should accept object with protocol only', () => {
    const input = { protocol: 'https' }
    configure(config => {
      expect(config.apiAddr).to.eql('https://localhost')
    })(input)
  })

  it('should accept object with host only', () => {
    const input = { host: 'ipfs.io' }
    configure(config => {
      expect(config.apiAddr).to.eql('http://ipfs.io')
    })(input)
  })

  it('should accept object with port only', () => {
    const input = { port: 138 }
    configure(config => {
      expect(config.apiAddr).to.eql('http://localhost:138')
    })(input)
  })
})
