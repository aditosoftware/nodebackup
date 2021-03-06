"use strict";

var backup = require('../backup/BackupFunc');
var logger = require('../logger/Logger');
var ssh = require('../misc/sshFunc');
var helpf = require('../misc/helpFunc');
var runComm = require('../misc/execArray');

function backupRun(backupServer, execServer, backupConfig, singleBackup) {
    this.bServer = backupServer;
    this.eServer = execServer;
    this.bConfig = backupConfig;
    if (singleBackup !== undefined && singleBackup !== null) {
        logger.debug("Single Backup run");
        this.singleBackup = singleBackup;
    } else {
        this.singleBackup = false;
    }
}

var backupArray = [];

backupRun.prototype.exec = function (callback) {
    var self = this;
    var config = self.bConfig;

    logger.info("Generating run array...")
    backup.createBackupPrePostCommands('prerun', self.bServer, self.eServer, config) //check and create (if defined) the prerun commans for a backup server. 
        .then((preRunBackup) => {
            logger.debug("Create backup prerun commands");

            backup.createBackupCommandsServer(self.bServer, self.eServer, config) //create an array with all backupjobs
                .then((serverArr) => {
                    serverArr.map((backupConfig) => {
                        backupArray.push(backupConfig); 
                    })
                    logger.debug("...run config array was generated");

                    backup.createBackupPrePostCommands('postrun', self.bServer, self.eServer, config) //check and create the postrun comands for a backup server.
                        .then((backupPostRun) => {

                            logger.debug("Create backup postrun commands");
                            
                            var toRunArr = [];
                            if (self.singleBackup !== false) { //check if this is a single backup (only one container or server or deploy, "-t")
                                backupArray.map((backupServer) => {
                                    if (backupServer.name == self.singleBackup) {
                                        toRunArr.push(backupServer); //write only one server configuration to run Array
                                    }
                                })

                                backupArray.map((container) => {
                                    if (container.containerName == self.singleBackup) {

                                        logger.debug('Container was found on docker host ' + container.name);
                                        toRunArr.push(container); // single backup is a container, write config of this container to run Array
                                    }
                                })
                            } else {
                                toRunArr = Array.from(backupArray);
                            }

                            if (toRunArr.length <= 0) { //output, if nothing to backup
                                logger.debug("##########################################");
                                logger.debug("No server/container found for backupServer " + self.bServer + ". Exit");
                                logger.debug("##########################################");
                                process.exit(0);
                            }

                            //push backup prerun to run Array
                            if (preRunBackup.arr !== undefined && preRunBackup.arr.length > 0) {
                                toRunArr.unshift(preRunBackup);
                            }

                            //push backup postrun to run Array
                            if (backupPostRun.arr !== undefined && backupPostRun.arr.length > 0) {
                                toRunArr.push(backupPostRun);
                            }

                            ssh.copySSHKey(self.eServer, config.SSHKey, config, '_id_' + self.eServer) //copy ssh key to exec server
                                .then((commandStat) => {

                                    logger.info("...run Array completed. Starting Backup commands")
                                    logger.info("...starting Backup commands")
                                    runComm.runCommands(toRunArr, self.eServer, self.bServer, config) //run backups of all object in array "toRunArr"
                                        .then((outArr) => {

                                            ssh.deleteSSHKey(self.eServer, config.SSHKey, config, '_id_' + self.eServer) //delete ssh key after all backups
                                                .then((out)=>{

                                                    return callback(null, outArr);

                                                },(err)=>{
                                                    logger.error(err);
                                                })

                                        }, (err) => {
                                            logger.error(err);
                                        })

                                }, (err) => {
                                    logger.error(err);
                                })

                        }), (err) => {
                            return callback(err, null);
                        }
                }, (err) => {
                    return callback(err, null);
                })
        }, (err) => {
            return callback(err, null);
        })
}

module.exports = backupRun;