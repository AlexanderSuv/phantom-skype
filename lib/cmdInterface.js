'use strict';

const readline = require('readline');
const MuteStream = require('mute-stream');

const _ = require('lodash');
const async = require('async');

class Interface {

  /**
   *
   * @param executableInstance: {} // instance to perform actions on
   * @param instanceInterface: [] // actions array: example:
   * [
   *   {
   *     alias: 'login',
   *     input: [
   *       { alias: 'login',
   *         type: 'text' },
   *       { alias: 'password',
   *         type: 'password' }
   *     ]
   *   },
   *   {
   *     alias: 'exit',
   *     input: []
   *   }
   *   ]
   *
   */
  constructor(executableInstance, instanceInterface) {
    this.executable = executableInstance;
    this.executableInterface = instanceInterface;
    this.isFinished = false;
    this.rl = null;
    this.eachCmdCb = null;

    // output stdout
    this._output = new MuteStream();
    this._output.pipe(process.stdout, {end: false});
  }
  
  cmd(eachCmdCb) {
    let rl = this.createRl();
    this.eachCmdCb = eachCmdCb;

    rl.setPrompt(`phantomSkype> `);
    rl.prompt();
    
    rl.on('line', this.onRlLine.bind(this));
    rl.on('SIGINT', this.onRlClose.bind(this));
  }

  createRl() {
    let self = this;
    // destroy existing rl
    this.closeRl();
    this.rl = readline.createInterface({
      input: process.stdin,
      output: this._output,
      completer: self.completer.bind(self),
      terminal: true
    });

    return this.rl;
  }

  completer(line) {
    // take completions from executable
    let completions = _.map(this.executableInterface, 'alias');

    // extends completions
    completions.push('help');

    let hits = completions.filter(function(c) { return c.indexOf(line) == 0 });
    // show all completions if none found
    return [hits.length ? hits : completions, line];
  }

  onRlLine(line) {
    let self = this;
    function onDone(err) {
      if(err) console.error(err);
      self.closeRl();
      self.eachCmdCb(null);
    }

    if(!line.trim().length) return onDone();

    this.performCmd(line, onDone);
  }

  onRlClose() {
    let rl = this.createRl();
    console.log();
    rl.setPrompt('press ctrl+C for exit ');
    rl.prompt();
    rl.on('line', this.onRlLine.bind(this));
    rl.on('SIGINT', () => {
      console.log();
      this.closeRl();
      this.isFinished = true;
      this.eachCmdCb(null);
    });
  }

  closeRl() {
    if(this.rl && typeof this.rl.close === 'function') this.rl.close();
  }

  findMethod(cmd) {
    return _.find(this.executableInterface, { alias: cmd });
  }

  performCmd(line, cb) {
    let cmd = line.trim();

    if(cmd === 'help') {
      console.log('commands: ...');
      return cb();
    }

    let method = this.findMethod(cmd);

    if(!method) {
      console.log('  command not found');
      return cb();
    }

    if(_.isEmpty(method.input)) return this.executable[method.alias](cb);

    let options = {};

    async.eachSeries(method.input,
      (input, eachCb) => {
        this.input(input.alias, input.type, (err, output) => {
          if(err) return cb(err);

          options[input.alias] = output;
          eachCb(null);
        });
      },
      err => {
        if(err) return cb(err);
        this.executable[method.alias](options, cb);
      });

  }

  input(text, type, cb) {
    let isPassword = type === 'password';
    let rl = this.createRl();

    rl.setPrompt(`${text}: `);
    rl.prompt();
    if(isPassword) this._output.mute();

    rl.on('line', line => {
      this._output.unmute();
      if(isPassword) console.log();
      cb(null, line.trim())
    });
    rl.on('SIGINT', this.onRlClose.bind(this));
  }
  
}

module.exports = Interface;
