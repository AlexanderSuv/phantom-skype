'use strict';

const async = require('async');

const SkypeProcessor = require('./lib/SkypeProcessor');
const Interface = require('./lib/cmdInterface');

const skypeProcessorInstance = new SkypeProcessor();

async.auto({

  init: (cb) => {
    skypeProcessorInstance.init(cb);
  },

  cmdCycle: ['init', (results, cb) => {

    let cmdInterface = new Interface(skypeProcessorInstance, SkypeProcessor.interfaceMethods());
    skypeProcessorInstance.setCmdInput(cmdInterface.input.bind(cmdInterface));

    async.whilst(
      // test
      () => !cmdInterface.isFinished,
      // perform cmd
      cmdInterface.cmd.bind(cmdInterface),
      // done cb
      cb
    )

  }],

  exit: ['cmdCycle', (results, cb) => {
    skypeProcessorInstance.exit(cb);
  }]

}, (err) => {
  if(err) console.error(err);
  if(!err) console.log('good bye');
  process.exit();
});
