'use strict';

const async = require('async');
const exec = require('child_process').exec;
const path = require('path');

const URLS = {
  LOGIN: 'https://login.skype.com/login',
  PORTAL_OVERVIEW: 'https://secure.skype.com/portal/overview',
  CHAT_URL: 'https://web.skype.com?intcmp=accountweb-_-uktrybeta'
};

const GenericProcessor = require('./GenericProcessor');

class SkypeProcessor extends GenericProcessor {

  login(credentials, cb) {
    let page = this.page;

    if(!this.isInitialized) return cb(this.loginError('Not initialized'));
    if(this.loggedIn) return cb(this.loginError(`Already logged in. Login: ${this.user.login}`));

    page.open(URLS.LOGIN)
      .then(status => {
        if(status !== 'success') return cb(this.loginError('Could not open login page'));
        // at page https://login.skype.com/login

        // check for captcha
        return page
          .evaluate(function() {
            return $('#captchaContainer')[0];
          });
      })
      .then(captcha => {
        if(!captcha) return Promise.resolve();
        return this.captchaPrompt();
      })
      .then(captcha => {
        // submit form
        if(!captcha) captcha = '';
        return page
          .evaluate(function(credentials, captcha) {
            $('input#username').val(credentials.login).keyup().change();
            $('input#password').val(credentials.password).keyup().change();
            if(captcha) $('#captchaContainer table tbody input').val(captcha).keyup().change();
            $('form#loginForm').submit();
          }, credentials, captcha);
      })
      .then(() => {
        return this.waitForPageLoad();
      })
      .then(() => {
        // in case of correct credentials
        // at /portal/overview
        return page
          .evaluate(function() {
            return location.href;
          })
          .then(url => url === URLS.PORTAL_OVERVIEW);
      })
      .then(isCredentialsCorrect => {
        function gotoChatPage() {
          return page
            .evaluate(function(url) {
              location.href = url;
            }, URLS.CHAT_URL);
        }

        return isCredentialsCorrect ? gotoChatPage() : this.rejectWithWrongCredentials();
      })
      .then(() => {
        return this.waitForPageLoad();
      })
      .then(() => {
        return this.includeJquery();
      })
      .then(() => {
        // at https://web.skype.com?intcmp=accountweb-_-uktrybeta
        this.loggedIn = true;
        this.user.login = credentials.login;
        this.output(`logged in: ${this.user.login}`);
        cb();
      })
      .catch(err => {
        if(err.type === 'msg') return cb(this.errorMessage(err.message));
        cb(this.loginError(err));
      });

  }

  captchaPrompt() {
    let self = this;
    let page = this.page;
    let dfd = Promise.defer();

    page
      // get captcha position
      .evaluate(function() {
        return $('#captchaContainer table tbody img')[0].getBoundingClientRect();
      })
      .then(captchaBB => {
        // set render area
        return page.property('clipRect', {
          top: captchaBB.top,
          left: captchaBB.left,
          width: captchaBB.width,
          height: captchaBB.height
        });
      })
      .then(() => {
        return page.render(path.join(this.SCREENSHOTS_DIR, 'captcha.png'));
      })
      .then(() => {
        // reset render area
        return page.property('clipRect', {
          top: 0,
          left: 0,
          width: self.viewport.width,
          height: self.viewport.height
        });
      })
      .then(() => {
        // open captcha img in viewer, and ask for input
        async.waterfall([
          cb => {
            // TODO .nix equivalent
            exec('start captcha.png', cb);
          },
          (stdout, stderr, cb) => {
            self.cmdInput('captcha', 'text', cb);
          }
        ], (err, captcha)=> {
          if(err) return dfd.reject(this.loginError(err));
          dfd.resolve(captcha);
        });

      });

    return dfd.promise;
  }

  rejectWithWrongCredentials() {
    return this.page
      .evaluate(function() {
        return $('.messageBox.message_error span').text();
      })
      .then(error => {
        return Promise.reject({type: 'msg', message: error});
      });
  }

  recipient(credentials, cb) {
    if(!this.loggedIn) return cb(this.recipientError('Not logged in'));

    let page = this.page;

    page
      // goto contacts list
      .evaluate(function() {
        $('a[role="menuitem"] span.skypeAddressBook').click()
      })
      .then(() => {
        return this.waitForPageLoad();
      })
      .then(() => {
        // goto found conversation
        let recipientSelector = `.grid span[title="${credentials.recipient}"]`;

        return page
          .evaluate(function(selector) {
            $(selector).click();
          }, recipientSelector);
      })
      .then(() => {
        cb();
      })
      .catch(err => {
        cb(this.recipientError(err));
      });
  }

  message(input, cb) {
    if(!input || !input.message) return cb();

    let page = this.page;
    page
      .evaluate(function(message) {
        document.querySelectorAll("textarea[name='messageInput']")[0].value = message;
        var evt = document.createEvent("KeyboardEvent");
        evt.initKeyboardEvent("keydown", true, true, window, 0, 0, 0, 0, 13, 13);
        document.querySelectorAll("textarea[name='messageInput']")[0].dispatchEvent(evt);
      }, input.message.trim())
      .then(() => {
        return page.evaluate(function() {
          document.querySelectorAll("div.send-button-holder button")[0].click();
        });
      })
      .then(() => {
        cb();
      })
      .catch(err => {
        cb(this.messageError(err));
      });
  }

  status(cb) {
    console.log();

    console.log(`  initialized: ${this.isInitialized}`);
    console.log(`  logged in: ${this.loggedIn}`);
    if(this.loggedIn) console.log(`  user login: ${this.user.login}`);

    console.log();
    cb();
  }

  static interfaceMethods() {
    return [
      {
        alias: 'login',
        input: [
          {
            alias: 'login',
            type: 'text'
          },
          {
            alias: 'password',
            type: 'password'
          }
        ]
      },
      {
        alias: 'pageStatus',
        input: []
      },
      {
        alias: 'status',
        input: []
      },
      {
        alias: 'recipient',
        input: [
          {
            alias: 'recipient',
            type: 'text'
          }
        ]
      },
      {
        alias: 'message',
        input: [
          {
            alias: 'message',
            type: 'text'
          }
        ]
      },
      // for debug purposes
      {
        alias: 'evaluateCmd',
        input: [
          {
            alias: 'cmd',
            type: 'text'
          }
        ]
      }
    ];
  }

}

module.exports = SkypeProcessor;
