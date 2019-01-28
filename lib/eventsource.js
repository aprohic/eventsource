const original = require('original')
const parse = require('url').parse
const events = require('events')
const util = require('util')
const fetch = require('whatwg-fetch').fetch

const httpsOptions = [
  'pfx', 'key', 'passphrase', 'cert', 'ca', 'ciphers',
  'rejectUnauthorized', 'secureProtocol', 'servername', 'checkServerIdentity',
]

const bom = [239, 187, 191]
const colon = 58
const space = 32
const lineFeed = 10
const carriageReturn = 13

function hasBom (buf) {
  return bom.every(function (charCode, index) {
    return buf[index] === charCode
  })
}

/**
 * Creates a new EventSource object
 *
 * @param {String} url the URL to which to connect
 * @param {Object} [eventSourceInitDict] extra init params. See README for details.
 * @api public
 **/
function EventSource (url, eventSourceInitDict) {

  let readyState = EventSource.CONNECTING

  Object.defineProperty(this, 'readyState', {
    get: function () {
      return readyState
    },
  })

  Object.defineProperty(this, 'url', {
    get: function () {
      return url
    },
  })

  const self = this
  self.reconnectInterval = 1000

  let controller = undefined

  function onConnectionClosed (message) {
    if (readyState === EventSource.CLOSED) return
    readyState = EventSource.CONNECTING
    _emit('error', new Event('error', { message: message }))

    // The url may have been changed by a temporary
    // redirect. If that's the case, revert it now.
    if (reconnectUrl) {
      url = reconnectUrl
      reconnectUrl = null
    }
    setTimeout(function () {
      if (readyState !== EventSource.CONNECTING) {
        return
      }
      connect()
    }, self.reconnectInterval)
  }

  let req
  let lastEventId = ''
  if (eventSourceInitDict && eventSourceInitDict.headers && eventSourceInitDict.headers['Last-Event-ID']) {
    lastEventId = eventSourceInitDict.headers['Last-Event-ID']
    delete eventSourceInitDict.headers['Last-Event-ID']
  }

  let discardTrailingNewline = false
  let data = ''
  let eventName = ''

  let reconnectUrl = null

  function fetch_connect () {
    controller = new AbortController()
    const signal = controller.signal
    const options = {
      method: 'get',
      signal,
    }

    options.headers = { 'Cache-Control': 'no-cache', 'Accept': 'text/event-stream' }
    if (lastEventId) options.headers['Last-Event-ID'] = lastEventId
    if (eventSourceInitDict && eventSourceInitDict.headers) {
      for (let i in eventSourceInitDict.headers) {
        const header = eventSourceInitDict.headers[i]
        if (header) {
          options.headers[i] = header
        }
      }
    }

    // Pass this on to the Fetch
    if (eventSourceInitDict && eventSourceInitDict.withCredentials !== undefined) {
      options.withCredentials = eventSourceInitDict.withCredentials
    }

    fetch(url, options)
      .then(res => {

        // Handle HTTP errors
        if ([500, 502, 503, 504].indexOf(res.status) !== -1) {
          _emit('error', new Event('error', { status: res.status, message: res.statusText }))
          onConnectionClosed()
          return
        }

        // Handle HTTP redirects
        if (res.status === 301 || res.status === 307) {
          if (!res.headers.location) {
            // Server sent redirect response without Location header.
            _emit('error', new Event('error', { status: res.status, message: res.statusText }))
            return
          }
          if (res.status === 307) reconnectUrl = url
          url = res.headers.location
          process.nextTick(connect)
          return
        }

        if (res.status !== 200) {
          _emit('error', new Event('error', { status: res.status, message: res.statusText }))
          return self.close()
        }

        readyState = EventSource.OPEN

        _emit('open', new Event('open'))

        // text/event-stream parser adapted from webkit's
        // Source/WebCore/page/EventSource.cpp
        let isFirst = true
        let buf

        function onProgressCallback (chunk) {
          buf = buf ? Buffer.concat([buf, chunk]) : chunk
          if (isFirst && hasBom(buf)) {
            buf = buf.slice(bom.length)
          }

          isFirst = false
          var pos = 0
          var length = buf.length

          while (pos < length) {
            if (discardTrailingNewline) {
              if (buf[pos] === lineFeed) {
                ++pos
              }
              discardTrailingNewline = false
            }

            var lineLength = -1
            var fieldLength = -1
            var c

            for (var i = pos; lineLength < 0 && i < length; ++i) {
              c = buf[i]
              if (c === colon) {
                if (fieldLength < 0) {
                  fieldLength = i - pos
                }
              } else if (c === carriageReturn) {
                discardTrailingNewline = true
                lineLength = i - pos
              } else if (c === lineFeed) {
                lineLength = i - pos
              }
            }

            if (lineLength < 0) {
              break
            }

            parseEventStreamLine(buf, pos, fieldLength, lineLength)

            pos += lineLength + 1
          }

          if (pos === length) {
            buf = void 0
          } else if (pos > 0) {
            buf = buf.slice(pos)
          }
        }

        let reader = res.body.getReader()

        return new Promise(function (resolve, reject) {
          const readNextChunk = () => {
            reader.read().then(function (result) {
              if (result.done) {
                //Note: bytes in textDecoder are ignored
                reject('no more data')
              } else {
                const chunk = Buffer.from(result.value)
                onProgressCallback(chunk)
                readNextChunk()
              }
            }).catch(reject)
          }
          readNextChunk()
        })

      })
      .catch(err => {
        console.log(err, 'error')
        if (['AbortError', 'DOMException'].indexOf(err.name) === -1) {
          onConnectionClosed(err.message)
        }
      })

  }

  function xhr_connect () {

    const options = {}

    options.headers = { 'Cache-Control': 'no-cache', 'Accept': 'text/event-stream' }
    if (lastEventId) options.headers['Last-Event-ID'] = lastEventId
    if (eventSourceInitDict && eventSourceInitDict.headers) {
      for (let i in eventSourceInitDict.headers) {
        const header = eventSourceInitDict.headers[i]
        if (header) {
          options.headers[i] = header
        }
      }
    }

    let isFirst = true
    let buf

    function onProgressCallback (chunk) {
      buf = buf ? Buffer.concat([buf, chunk]) : chunk
      if (isFirst && hasBom(buf)) {
        buf = buf.slice(bom.length)
      }

      isFirst = false
      var pos = 0
      var length = buf.length

      while (pos < length) {
        if (discardTrailingNewline) {
          if (buf[pos] === lineFeed) {
            ++pos
          }
          discardTrailingNewline = false
        }

        var lineLength = -1
        var fieldLength = -1
        var c

        for (var i = pos; lineLength < 0 && i < length; ++i) {
          c = buf[i]
          if (c === colon) {
            if (fieldLength < 0) {
              fieldLength = i - pos
            }
          } else if (c === carriageReturn) {
            discardTrailingNewline = true
            lineLength = i - pos
          } else if (c === lineFeed) {
            lineLength = i - pos
          }
        }

        if (lineLength < 0) {
          break
        }

        parseEventStreamLine(buf, pos, fieldLength, lineLength)

        pos += lineLength + 1
      }

      if (pos === length) {
        buf = void 0
      } else if (pos > 0) {
        buf = buf.slice(pos)
      }
    }

    req = new XMLHttpRequest()
    req.open('GET', url)
    var offset = 0
    req.onprogress = function () {
      var responseText = req.responseText
      var chunk = responseText.slice(offset)
      offset += chunk.length
      onProgressCallback(Buffer.from(chunk, 'utf8'))
    }
    req.onreadystatechange = function () {
      if (req.readyState === 2) {
        const headers = req.getAllResponseHeaders()

        // Handle HTTP errors
        if ([500, 502, 503, 504].indexOf(req.status) !== -1) {
          _emit('error', new Event('error', { status: req.status, message: req.statusText }))
          onConnectionClosed()
          return
        }

        // Handle HTTP redirects
        if (req.status === 301 || req.status === 307) {
          if (!req.headers.location) {
            // Server sent redirect response without Location header.
            _emit('error', new Event('error', { status: req.status, message: req.statusText }))
            return
          }
          if (req.status === 307) reconnectUrl = url
          url = headers.location
          process.nextTick(connect)
          return
        }

        if (req.status !== 200) {
          _emit('error', new Event('error', { status: req.status, message: req.statusText }))
          return self.close()
        }

        readyState = EventSource.OPEN

        _emit('open', new Event('open'))

      } else if (req.readyState === 4) {
        self._close()
      }
    }

    req.responseType = 'text'

    if (eventSourceInitDict && eventSourceInitDict.headers) {
      for (let i in eventSourceInitDict.headers) {
        const header = eventSourceInitDict.headers[i]
        if (header) {
          req.setRequestHeader(i, header)
        }
      }
    }

    req.send()
  }

  function connect () {
    return xhr_connect()
  }

  connect()

  function _emit () {
    if (self.listeners(arguments[0]).length > 0) {
      self.emit.apply(self, arguments)
    }
  }

  this._close = function () {
    if (readyState === EventSource.CLOSED) return
    readyState = EventSource.CLOSED
    if (controller) controller.abort()
    if (req) req.abort && req.abort();
  }

  function parseEventStreamLine (buf, pos, fieldLength, lineLength) {
    if (lineLength === 0) {
      if (data.length > 0) {
        var type = eventName || 'message'
        _emit(type, new MessageEvent(type, {
          data: data.slice(0, -1), // remove trailing newline
          lastEventId: lastEventId,
          origin: original(url),
        }))
        data = ''
      }
      eventName = void 0
    } else if (fieldLength > 0) {
      var noValue = fieldLength < 0
      var step = 0
      var field = buf.slice(pos, pos + (noValue ? lineLength : fieldLength)).toString()

      if (noValue) {
        step = lineLength
      } else if (buf[pos + fieldLength + 1] !== space) {
        step = fieldLength + 1
      } else {
        step = fieldLength + 2
      }
      pos += step

      var valueLength = lineLength - step
      var value = buf.slice(pos, pos + valueLength).toString()

      if (field === 'data') {
        data += value + '\n'
      } else if (field === 'event') {
        eventName = value
      } else if (field === 'id') {
        lastEventId = value
      } else if (field === 'retry') {
        var retry = parseInt(value, 10)
        if (!Number.isNaN(retry)) {
          self.reconnectInterval = retry
        }
      }
    }
  }
}

module.exports = EventSource

util.inherits(EventSource, events.EventEmitter)
EventSource.prototype.constructor = EventSource; // make stacktraces readable

['open', 'error', 'message'].forEach(function (method) {
  Object.defineProperty(EventSource.prototype, 'on' + method, {
    /**
     * Returns the current listener
     *
     * @return {Mixed} the set function or undefined
     * @api private
     */
    get: function get () {
      var listener = this.listeners(method)[0]
      return listener ? (listener._listener ? listener._listener : listener) : undefined
    },

    /**
     * Start listening for events
     *
     * @param {Function} listener the listener
     * @return {Mixed} the set function or undefined
     * @api private
     */
    set: function set (listener) {
      this.removeAllListeners(method)
      this.addEventListener(method, listener)
    },
  })
})

/**
 * Ready states
 */
Object.defineProperty(EventSource, 'CONNECTING', { enumerable: true, value: 0 })
Object.defineProperty(EventSource, 'OPEN', { enumerable: true, value: 1 })
Object.defineProperty(EventSource, 'CLOSED', { enumerable: true, value: 2 })

EventSource.prototype.CONNECTING = 0
EventSource.prototype.OPEN = 1
EventSource.prototype.CLOSED = 2

/**
 * Closes the connection, if one is made, and sets the readyState attribute to 2 (closed)
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/API/EventSource/close
 * @api public
 */
EventSource.prototype.close = function () {
  this._close()
}

/**
 * Emulates the W3C Browser based WebSocket interface using addEventListener.
 *
 * @param {String} type A string representing the event type to listen out for
 * @param {Function} listener callback
 * @see https://developer.mozilla.org/en/DOM/element.addEventListener
 * @see http://dev.w3.org/html5/websockets/#the-websocket-interface
 * @api public
 */
EventSource.prototype.addEventListener = function addEventListener (type, listener) {
  if (typeof listener === 'function') {
    // store a reference so we can return the original function again
    listener._listener = listener
    this.on(type, listener)
  }
}

/**
 * Emulates the W3C Browser based WebSocket interface using dispatchEvent.
 *
 * @param {Event} event An event to be dispatched
 * @see https://developer.mozilla.org/en-US/docs/Web/API/EventTarget/dispatchEvent
 * @api public
 */
EventSource.prototype.dispatchEvent = function dispatchEvent (event) {
  if (!event.type) {
    throw new Error('UNSPECIFIED_EVENT_TYPE_ERR')
  }
  // if event is instance of an CustomEvent (or has 'details' property),
  // send the detail object as the payload for the event
  this.emit(event.type, event.detail)
}

/**
 * Emulates the W3C Browser based WebSocket interface using removeEventListener.
 *
 * @param {String} type A string representing the event type to remove
 * @param {Function} listener callback
 * @see https://developer.mozilla.org/en/DOM/element.removeEventListener
 * @see http://dev.w3.org/html5/websockets/#the-websocket-interface
 * @api public
 */
EventSource.prototype.removeEventListener = function removeEventListener (type, listener) {
  if (typeof listener === 'function') {
    listener._listener = undefined
    this.removeListener(type, listener)
  }
}

/**
 * W3C Event
 *
 * @see http://www.w3.org/TR/DOM-Level-3-Events/#interface-Event
 * @api private
 */
function Event (type, optionalProperties) {
  Object.defineProperty(this, 'type', { writable: false, value: type, enumerable: true })
  if (optionalProperties) {
    for (var f in optionalProperties) {
      if (optionalProperties.hasOwnProperty(f)) {
        Object.defineProperty(this, f, { writable: false, value: optionalProperties[f], enumerable: true })
      }
    }
  }
}

/**
 * W3C MessageEvent
 *
 * @see http://www.w3.org/TR/webmessaging/#event-definitions
 * @api private
 */
function MessageEvent (type, eventInitDict) {
  Object.defineProperty(this, 'type', { writable: false, value: type, enumerable: true })
  for (var f in eventInitDict) {
    if (eventInitDict.hasOwnProperty(f)) {
      Object.defineProperty(this, f, { writable: false, value: eventInitDict[f], enumerable: true })
    }
  }
}
