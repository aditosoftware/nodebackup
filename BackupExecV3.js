"use strict";

var fs = require('fs');
var yaml2json = require('yamljs');
var path = require('path');
var program = require('commander');
var helpf = require('./lib/helpFunc');
var backup = require('./lib/Backup');
var logger = require('./lib/Logger');

program
  .version('3.0.10')
  .option('-b, --backup', 'start backup')
  .option('-e, --exec [exec]', 'server, which start backup job')
  .option('-t, --target [target]', 'single server for backup')
  .option('-s, --server [server]', 'backup server')
  .option('-d, --debug', 'debug to console')
  .option('-f, --debugfile', 'debug to file')
  .option('-r, --restore', 'starte restore')
  .option('-c, --pathcustom [pathcustom]', 'path to restore data (custom path)')
  .option('-o, --overwrite', 'overwrite existing folder by recovery')
  .option('-p, --pathdefault [pathdefault]', 'default path from config.yml')
  .option('-m, --time [time]', 'backup from [time]')
  .option('-i, --verify', 'verify all backups on a backup server');

program.on('--help', function () {
  console.log('  Info:');
  console.log('   Read README.md for more info');
  console.log(' ');
  console.log('  Backup:');
  console.log('    Backup: sudo ./BackupExecV3 -b -e backup2 -s backup2');
  console.log('    Single backup: sudo ./BackupExecV3 -b -e backup2 -s backup2 -t freepbx');
  console.log(' ');
  console.log('  Recovery: ');
  console.log('    Backup to original path: sudo ./BackupExecV3.js -r -t backup-new-test -s backup2 -p freepbx -o');
  console.log('    Backup to custom path: sudo ./BackupExecV3.js -r -t backup-new-test -s backup2 -c freepbx:/tmp/newFolder');
  console.log('    Backup to custom path: sudo ./BackupExecV3.js -r -t backup-new-test -s backup2 -c freepbx:/tmp/newFolder -o -m (2D|1W|10s|50m)');
  console.log(' ');
  //console.log('    $ server-exec.js -e backup2 -s backup2 -d -t single-server-to-backup');
});
program.parse(process.argv);

//check start arguments
if (!program.args.length && process.argv.length < 3) {
  if (!program.restore) {
    console.log("to few arguments. Use -h for help");
    process.exit(1);
  }
}

//Check if config.yml exist
var scriptdir = path.dirname(process.argv[1]); //get dir of scripts
var configpath = scriptdir + "/" + "config.yml";

//check if config.yml exist
if (!fs.existsSync(configpath)) {
  console.log("Config.yml not found");
  process.exit(1);
}
//read config.yml
var serverconfig = yaml2json.parse(fs.readFileSync(configpath, 'utf-8'));

//define block of starter config from config.yml
var starter = serverconfig.starter;

//check if path of logs are relative or absolut
if (path.isAbsolute(starter.log.path)) {
  //path is absolut
  var logdir = starter.log.path;
} else {
  //path is relativ, create absolute path
  var logdir = path.resolve(path.dirname(process.argv[1]) + "/" + starter.log.path);
  serverconfig.log.path = logdir;
}

//check if log dir exist, create if not found
if (!fs.existsSync(logdir)) {
  fs.mkdirSync(logdir);
}

//check if pid dir exist
if (starter.pids !== undefined && starter.pids !== null) {
  if (path.isAbsolute(starter.pids)) {
    var pidsdir = starter.pids;
  } else {
    var pidsdir = path.resolve(path.dirname(process.argv[1]) + '/' + starter.pids);
  }
  serverconfig.starter.pids = pidsdir;
} else {
  console.log("Config for starter.pids not found. Exit");
  process.exit(1);
}

//check if pids folder exist
if (!fs.existsSync(pidsdir)) {
  fs.mkdirSync(pidsdir);
}

//define logger
var date = new Date();
var hour = date.getHours();
var year = date.getFullYear();
var month = date.getMonth() + 1;
month = (month < 10 ? "0" : "") + month;
var day = date.getDate();
day = (day < 10 ? "0" : "") + day;
var timeAct = year + "-" + month + "-" + day;

//define level of logging
if (program.debug) {
  logger.setLevel('debug', '' + logdir + "/" + timeAct + "_" + program.server + '_debug_.log');
} else if (program.debugfile) {
  logger.setLevel('debugfile', '' + logdir + "/" + timeAct + '_' + program.server + '_debug_.log');
} else {
  logger.setLevel('info', '' + logdir + "/" + timeAct + '_' + program.server + '.log');
}

//check if ssh key exist
if (path.isAbsolute(starter.sshkey)) {
  var sshKeyPath = starter.sshkey;
} else {
  var sshKeyPath = path.resolve(path.dirname(process.argv[1]) + "/" + starter.sshkey);
}

//check if sshkey exist
if (!fs.existsSync(sshKeyPath)) {
  logger.debug("SSH Key was not found");
  process.exit(1);
} else {
  var sshkey = fs.readFileSync(sshKeyPath, "utf8");
}

//add SSHKey to the server config object
serverconfig.SSHKey = sshkey;

//check type - backup, restore, verify
if (program.restore == undefined && program.verify == undefined && program.backup == undefined) {
  console.log("Please select backup (-b), restore(-r), verify(-i) or help (-h)");
  process.exit(0);
}

//start restore
if (program.restore) {
  var restoreFunc = new moduleRestoreFunc(logger, program, serverconfig, sshkeypath, program.target, pidsdir);
  restoreFunc._restore();
}

//start verify
if (program.verify) {
  var verBackup = new moduleVerify(serverconfig, program.server, program.exec, logger);

  verBackup.verifyAllBackups(function (err, bArr) {
    if (err) {
      logger.error(err);
      process.exit(1);
    } else {
      verBackup.writeOutput(bArr);
      process.exit(0);
    }
  });
}

//start backup
if (program.backup) {
  logger.info("Start Backup");

  var backupServerConfig = serverconfig.backupserver[program.server]; //get config of backup server from config.yaml
  var execServerConfig = serverconfig.clientserver[program.exec]; //get config of exec server from config.yaml
  if (program.target) {
    var targetServer = serverconfig.clientserver[program.target];
  }

  logger.debug("Backup server is: " + program.server);
  logger.debug("Exec server is: " + program.exec);
  logger.debug("Parse config.yml");

  var testConfig = helpf.checkConfig([backupServerConfig, execServerConfig]) //check configuration of backup and exec servers
    .then(configOK => {
      if (configOK !== 0) {
        logger.error(configOK + " of backup or exec server is not defined in config.yml. Exit");
        process.exit(1);
      } else {
        var backupJob = new backup(program.server, program.exec, serverconfig, program.target); //start new backup job

        backupJob.exec(function (err, backupResult) { //parse result output of backup.
          if (err) {
            logger.error(err);
          } else {
            getFormatedOutput(backupResult); //format output
          }
        });
      }
    })
}

var getFormatedOutput = function (output) {
  var formatedOutputObj = [];

  output.map((runOutput) => {
    var errorOut = runOutput.output.error; //output is a error output of command or not
    var message = runOutput.output.message; //command output message
    var type = runOutput.type; //type of message (duplicity output or not)
    var name = runOutput.server;

    if (errorOut) {
      logger.info(name + " | " + " | " + " | " + "  | " + " | " + message); //output for logger in file(if -f) or console
      formatedOutputObj.push({//create object for table output bottom
        "Name": name,
        "StartTime": "",
        "ElapsedTime": "",
        "Increment Files Size": "",
        "Total Size changed": "",
        "Errors": message
      });
    } else {

      if (type == 'duplicity') {
        var statRegEx = /StartTime/gi;
        var startArrInt = 0;

        if (message.match(starter)) {
          var stat = message.toString().split("\n");

          for (var i = 0; i < stat.length; i++) {
            if (stat[i].match(statRegEx)) {
              startArrInt = i - 1
              break
            }
          }

          //parse --print-statistic output of duplicity
          var ln = startArrInt;
          var starttime = stat[ln + 1].substring(25, 49); //StartTime 1454660238.00 (|Fri Feb  5 09:17:18 2016|)
          var elapsedTime = stat[ln + 3].substring(12, 100); //ElapsedTime |16.94 (16.94 seconds)|
          var incFiles = stat[ln + 13].substring(13, 100); //IncrementFiles |3|
          var totalSize = stat[ln + 14].substring(27, 100);//TotalDestinationSizeChange |88975749 (84.9 MB)|
          var errors = stat[ln + 15].substring(7, 100); //Errors |0|

          logger.info(name + " | " + starttime + " | " + elapsedTime + " | " + incFiles + "  | " + totalSize + " | " + errors); //write output to log file
          //      like: 
          //      2016-02-10T15:15:49.027Z - info: Name | StartTime | ElapsedTime | Incerment Files Size  | Total Size changed | Errors
          //      2016-02-10T15:15:49.031Z - info: freepbx |  |  |   |  | mv: cannot stat `/var/spool/asterisk/backup/taeglich/*.tgz': No such file or directory

          formatedOutputObj.push({//create object for table output bottom
            "Name": name,
            "StartTime": starttime,
            "ElapsedTime": elapsedTime,
            "Increment Files Size": incFiles,
            "Total Size changed": totalSize,
            "Errors": errors
          });

        }
      }
    }
  })
  require('console.table');
  console.table(formatedOutputObj);

  //  Table Output:
  //Name             StartTime                 ElapsedTime          Increment Files Size  Total Size changed  Errors
  //---------------  ------------------------  -------------------  --------------------  ------------------  ------
  //backup-new-test  Wed Feb 10 15:38:49 2016  2.75 (2.75 seconds)  0                     0 (0 bytes)         0
}