'use strict';

const path = require('path');
const phantom = require('phantom');
const async = require('async');

const USER_AGENT = 'Mozilla/5.0 (compatible; MSIE 9.0; Windows NT 6.1; Trident/5.0)';

const TIMEOUTS = {
  AFTER_LAST_RESPONSE: 1300,
  PAGE_LOAD_TIMEOUT: 50000
};

const PHANTOM_ARGS = [
  '--ssl-protocol=any',
  '--ignore-ssl-errors=yes',
  '--web-security=no'
];

class GenericProcessor {

  initError(err) {
    return this._Error('Initialization error', err);
  };

  pageReloadError(err) {
    return this._Error('Page reload error', err);
  };

  loginError(err) {
    return this._Error(`Login error`, err)
  };

  recipientError(err) {
    return this._Error(`Recipient error`, err)
  };

  messageError(err) {
    return this._Error(`Message error`, err)
  };

  errorMessage(msg) {
    return `Error: ${msg}`;
  }

  _Error(msg, err) {
    if(!(err instanceof Error)) err = new Error(err);
    let ext = err ? `: ${err.stack || err.message}` : '';
    return `${msg}${ext}`;
  };

  output(msg) {
    console.log(`[processor] ${msg}`);
  }

  setCmdInput(cmdInput) {
    this.cmdInput = cmdInput;
  }

  init(cb) {
    this.SCREENSHOTS_DIR = 'screenshots';
    this.isInitialized = false;
    this.loggedIn = false;
    this.user = {
      login: ''
    };
    this.viewport = {
      width: 1280,
      height: 720
    };

    phantom.create(PHANTOM_ARGS)
      .then(phantomInstance => {
        this.phantom = phantomInstance;
        return phantomInstance.createPage();
      })
      .then(page => {
        this.page = page;
        // skip stiles, analytics
        page.on('onResourceRequested', true, function(requestData, networkRequest) {
          var URL_PATTERNS_TO_SKIP = [
            // /http:\/\/.+?\.css/gi,
            /analytics/gi
          ];

          var patternMatches = URL_PATTERNS_TO_SKIP.filter(function(pattern) {
              return pattern.test(requestData.url);
            }).length > 0;

          if(patternMatches) {
            networkRequest.abort();
          }
        });

        return page.setting('userAgent', USER_AGENT);
      })
      .then(() => {
        return this.page.property('viewportSize', this.viewport);
      })
      .then(() => {
        this.isInitialized = true;
        this.output('initialized');
        if(typeof cb === 'function') cb(null, this.page);
      })
      .catch(err => {
        cb(this.initError(err));
      });

  }

  evaluateCmd(input, cb) {
    if(!this.loggedIn) {
      this.initError('Cant perform cmd, no page open');
      return cb();
    }

    let page = this.page;
    let cmd = `function() { ${input.cmd} }`;

    this.page.on('onConsoleMessage', msg => console.log(msg));

    this.page
      .evaluateJavaScript(cmd)
      .then(res => {
        if(res) console.log(res);
        page.off('onConsoleMessage');
        cb();
      })
      .catch(err => {
        cb(err);
      });
  }

  pageStatus(cb) {
    if(!this.loggedIn) {
      console.log('  unable to check page status: not initialized ');
      return cb();
    }

    let page = this.page;
    page
      .evaluate(function() {
        return {
          jquery: !!$,
          url: location.href
        };
      })
      .then(status => {
        page.render(path.join(this.SCREENSHOTS_DIR, 'status.png'));
        console.log(status);
        cb();
      })
      .catch(err => {
        cb(err);
      });
  }

  includeJquery() {
    return this.page
      .includeJs("https://ajax.googleapis.com/ajax/libs/jquery/3.1.0/jquery.min.js");
  }

  waitForPageLoad() {
    let self = this;
    let allDoneDfd = Promise.defer();
    let url = '';
    let page = this.page;

    function waitForLastResponse() {
      let dfd = Promise.defer();
      let afterLastResponseTimeout;

      page.on('onResourceReceived', () => {

        if(afterLastResponseTimeout) clearTimeout(afterLastResponseTimeout);
        afterLastResponseTimeout = setTimeout(() => {
          page.off('onResourceReceived');
          dfd.resolve();
        }, TIMEOUTS.AFTER_LAST_RESPONSE);

      });

      return dfd.promise;
    }

    function waitForPageContentLoaded() {
      let dfd = Promise.defer();
      let polling = true;

      async.whilst(
        // test
        () => polling,
        // do
        (cb) => {

          page
            .evaluate(function() {
              return {
                readyState: document.readyState,
                url: location.href
              }
            })
            .then(status => {
              if(status.readyState === 'complete') {
                url = status.url;
                polling = false;
                cb();
              }
            })

        },
        // done
        err => {
          if(err) return dfd.reject(err);
          dfd.resolve();
        }
      );

      return dfd.promise;
    }

    waitForLastResponse()
      .then(() => {
        return waitForPageContentLoaded();
      })
      .then(() => {
        this.output(`Loaded page url: ${url}`);
        allDoneDfd.resolve();
      })
      .catch(err => {
        allDoneDfd.reject(self.pageReloadError(err));
      });

    setTimeout(() => {
      page.off('onResourceReceived');
      allDoneDfd.reject(self.pageReloadError('page load timeout'));
    }, TIMEOUTS.PAGE_LOAD_TIMEOUT);

    return allDoneDfd.promise;
  }

  exit(cb) {
    if(this.page) {
      this.page.close();
      this.page = null;
    }
    if(this.phantom || typeof this.phantom.exit === 'function') this.phantom.exit();
    this.phantom = null;
    this.output('exit done');
    if(typeof cb === 'function') cb();
  }

}

module.exports = GenericProcessor;
