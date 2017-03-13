"use strict";

var fs = require('fs');
var yaml2json = require('yamljs');
var path = require('path');
var program = require('commander');
var winston = require('winston');
var backup = require('./lib/BackupFunc2');

program
  .version('1.2.0')
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
  console.log('    Backup: sudo ./BackupExecV2 -b -e backup2 -s backup2');
  console.log('    Single backup: sudo ./BackupExecV2 -b -e backup2 -s backup2 -t freepbx');
  console.log(' ');
  console.log('  Recovery: ');
  console.log('    Backup to original path: sudo ./BackupExecV2.js -r -t backup-new-test -s backup2 -p freepbx -o');
  console.log('    Backup to custom path: sudo ./BackupExecV2.js -r -t backup-new-test -s backup2 -c freepbx:/tmp/newFolder');
  console.log('    Backup to custom path: sudo ./BackupExecV2.js -r -t backup-new-test -s backup2 -c freepbx:/tmp/newFolder -o -m (2D|1W|10s|50m)');
  console.log(' ');
  //console.log('    $ server-exec.js -e backup2 -s backup2 -d -t single-server-to-backup');
});
program.parse(process.argv);

// must be before .parse() since
// node's emit() is immediate


var level; //{ emerg: 0, alert: 1, crit: 2, error: 3, warning: 4, notice: 5, info: 6, debug: 7 }
//define level of logging
if (program.debug) {
  level = "debug";
} else {
  level = "info";
}

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
}

//check if log dir exist, create if not found
if (!fs.existsSync(logdir)) {
  fs.mkdirSync(logdir);
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

//logger is configured to save output to log file
var logger = new (winston.Logger)({
  level: level,
  transports: [
    new (winston.transports.File)({
      filename: '' + logdir + "/" + timeAct + '_' + program.server + '.log',
      json: false
    })
  ]
});

//add console output if debug is on
if (program.debug) {
  logger.add(winston.transports.Console, { json: false });
} else {
  if (program.debugfile) {
    logger = new (winston.Logger)({
      level: 'debug',
      transports: [
        new (winston.transports.File)({
          filename: '' + logdir + "/" + timeAct + "_" + program.server + '_debug_.log',
          json: false
        })
      ]
    });
  } else {
    //if error, write to console
    logger.add(winston.transports.Console, {
      level: 'error',
      json: false
    });
  }
}

if(program.restore == undefined && program.verify == undefined && program.backup == undefined){
  console.log("Please select backup (-b), restore(-r), verify(-i) or help (-h)");
  process.exit(0);
}

if (program.restore) {
  var restoreFunc = new moduleRestoreFunc(logger, program, serverconfig, sshkeypath, program.target, pidsdir);
  restoreFunc._restore();
}
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
if (program.backup) {
  logger.info("Start Backup");

  var backupServerConfig = serverconfig.backupserver[program.server];
  var execServerConfig = serverconfig.clientserver[program.exec];
  if (program.target) {
    var targetServer = serverconfig.clientserver[program.target];
  }

  logger.debug("Backup server is: " + program.server);
  logger.debug("Exec server is: " + program.exec);
  logger.debug("Parse config.yml");

  var checkConfig = function (config) {
    return new Promise((resolve, reject) => {
      _checkConfig(config[0], (err, result) => {
        if (err) {
          return reject(err);
        } else {
          _checkConfig(config[1], function (err, result) {
            if (err) {
              return reject(err);
            } else {
              return resolve(0);
            }
          })
        }
      })
    })
  }

  var testConfig = checkConfig([backupServerConfig, execServerConfig])
    .then(configOK => {
      if (configOK !== 0) {
        logger.error(configOK + " of backup or exec server is not defined in config.xml. Exit");
        process.exit(1);
      } else {
        var backupJob = new backup(logger, program.server, program.exec, serverconfig);

        logger.debug("Start test SSH connection to exec server: " + program.exec);

        backupJob.checkSSHConnection(program.exec) //check ssh to exec server
          .then((response) => {
            logger.debug("SSH test connection to exec " + program.exec + " successfull");

            backupJob.checkSSHConnection(program.server) //check ssh connection to backup server
              .then((response) => {
                logger.debug("SSH test connection to backup server " + program.exec + " successfull");

                backupJob.createBackupPrePostCommands('prerun') //create backup server prerun commands
                  .then((backupPreRun) => {
                    logger.debug("Create backup prerun commands");

                    backupJob.createBackupPrePostCommands('postrun') //create backup server postrun commands
                      .then((backupPostRun) => {

                        logger.debug("Create backup postrun commands");
                        var backupClients = serverconfig.backupserver[program.server].backupfor
                        var serversToBackup = JSON.parse(backupClients);

                        backupJob.createBackupCommandsServer(serversToBackup) //create backupcommands for normal (not docker host) servers
                          .then((backupServersArr) => {
                            logger.debug("Config array was generated");

                            backupJob.getAllDockerHost(serversToBackup) //get docker host from config.yml
                              .then((dockerHostsArr) => {

                                backupJob.createBackupCommandDocker(dockerHostsArr) //create backup commands for all docker container (where labels are defined)
                                  .then((containersArr) => {
                                    var toRunArr = [];

                                    logger.debug('Write all commands to an array');

                                    //check if single backup "-t"
                                    if (program.target) {
                                      var serversToBackup = serverconfig.clientserver[program.target]
                                      if (serversToBackup !== undefined && serversToBackup !== null) {
                                        backupServersArr.map((backupServer) => {
                                          if (backupServer.name == program.target) {
                                            toRunArr.push(backupServer); //write only one server configuration to run Array
                                          }
                                        })
                                      } else {
                                        logger.debug("not found in config.yml maybe docker container. Get all Docker containers");
                                        containersArr.map((container) => {
                                          if (container.containerName == program.target) {
                                            logger.debug('Container was found on docker host ' + container.name);
                                            toRunArr.push(container); // single backup is a container, write config of this container to run Array
                                          }
                                        })
                                      }
                                    } else {
                                      //push server backup configuration to run Array  
                                      backupServersArr.map((backupServer) => {
                                        if (backupServer.arr.length) {
                                          toRunArr.push(backupServer);
                                        }
                                      })

                                      //push container backup config to run Array
                                      containersArr.map((container) => {
                                        if (container.arr.length > 0) {
                                          toRunArr.push(container);
                                        }
                                      })
                                    }

                                    if (toRunArr.length <= 0 ){
                                      logger.debug("##########################################");
                                      logger.debug("No server/container found for backup. Exit");
                                      logger.debug("##########################################");
                                      process.exit(0);
                                    }
                                    
                                    //push backup prerun to run Array
                                    if (backupPreRun.arr !== undefined && backupPreRun.arr.length > 0) {
                                      toRunArr.unshift(backupPreRun);
                                    }

                                    //push backup postrun to run Array
                                    if (backupPostRun.arr !== undefined && backupPostRun.arr.length > 0) {
                                      toRunArr.push(backupPostRun);
                                    }

                                    backupJob.copySSHKey() //copy ssh key to exec server, for connections from exec to all another servers
                                      .then((result) => {

                                        var maxParallel = parseInt(backupServerConfig.maxjobs);

                                        //1. commandarr, 2. number of max parallel running backup jobs
                                        backupJob.runCommands(toRunArr, maxParallel)
                                          .then((runOutputArr) => {

                                            backupJob.deleteSSHKey(); //delete ssh key from exec server after backup jobs complete

                                            //parse output #####################
                                            var formatedOutputObj = [];
                                            runOutputArr.map((runOutput) => {
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

                                                    //parse --print-statistic output
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

                                            //table output to console
                                            require('console.table');
                                            console.table(formatedOutputObj);
                                            //  Table Output:
                                            //Name             StartTime                 ElapsedTime          Increment Files Size  Total Size changed  Errors
                                            //---------------  ------------------------  -------------------  --------------------  ------------------  ------
                                            //backup-new-test  Wed Feb 10 15:38:49 2016  2.75 (2.75 seconds)  0                     0 (0 bytes)         0

                                          })
                                      }, (err) => {
                                        logger.error(err);
                                      })
                                  }, (err) => {
                                    logger.error(err);
                                  })
                              })
                          }, (err) => {
                            logger.error("Error: config array was not generated " + err);
                          })
                      })
                  })
              }, (error) => {
                logger.error("SSH test connection to backup server " + program.exec + " failed: " + error);
              })
          }, (error) => {
            logger.error("SSH test connection to exec " + program.exec + " failed: " + error);
          });
      }
    })
}

//function to check parameter PORT,USER,HOST of a server(client/server);
function _checkConfig(serverConfig, callback) {
  if (!serverConfig.HOST) {
    return callback("HOST");
  }
  if (!serverConfig.USER) {
    return callback("USER");
  }
  if (!serverConfig.PORT) {
    return callback("PORT");
  }
  return callback(0);
}