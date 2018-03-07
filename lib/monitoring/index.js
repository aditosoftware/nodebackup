'use strict'

const icinga2 = require('icinga2-api');
const logger = require('../logger/Logger');
const lodash = require('lodash');
module.exports = monserver;

function monserver(monconfig, target) {
    this.config = monconfig;
    this.host = monconfig.starter.monserver;
    this.port = monconfig.starter.monport;
    this.user = monconfig.starter.monapiuser;
    this.pass = monconfig.starter.monapipass;
    this.hostgroup = monconfig.starter.hostgroup;
    this.servicegroup = monconfig.starter.servicegroup;
    this.hosttemplate = monconfig.starter.hosttemplate;
    this.srvtemplate = monconfig.starter.srvtemplate;
    this.singlebackup = target;

    this.icingaServer = new icinga2(this.host, this.port, this.user, this.pass);
}

//check if a template for backup host exist
monserver.prototype.checkHosttemplate = function (name, callback) {
    var self = this;

    self.icingaServer.checkExistHostTemplate(self.hosttemplate, function (err, result) {
        if (err) {
            return callback(err, null);
        } else {
            return callback(null, result);
        }
    })
}
//bserver - name of backup server, output - output from running backup
monserver.prototype.sendBackupStat = function (bserver, output, callback) {
    var self = this;
    var backupHostState = 0;
    bserver = bserver + '_backupsrv';
    // let arrForErr = {}; //save output with errors 

    var createServices = function (callback) {

        //write/create all services where backupjob running without errors;
        output.map((OutMessage) => {
            var errorOut = OutMessage.output.error; //output is a error output of command or not
            var message = OutMessage.output.message; //command output message
            var name = OutMessage.server.replace(/[/]/g, '---');
            var type = OutMessage.type; //type of message (duplicity output or not)

            if (errorOut == true) {

            } else {

                if (type == "borg" || type == "duplicity") {

                    setCreateServiceState(self, bserver, name, 0, message, type)
                        .then((result) => {
                            logger.debug("Backup server: " + bserver + ". Service " + name + " was created and state of service was set");
                            return callback(null, result);
                        })
                        .catch((err) => {
                            logger.error("Backup Server: " + bserver + ". Cannot set state(0) of service or create a service. Err: " + JSON.stringify(err));
                            return callback(err, null);
                        })
                }
            }
        })

        //search in output array for errors, and write this outputs in a new array;
        let errMsgArr = lodash.filter(output, { 'output': { 'error': true } }); //search error stat in array
        if (errMsgArr.length > 0) {
            
            backupHostState = 1;
            var outputBackupState = "";
            var outputServiceState = "";

            errMsgArr.map((errMsg) => {

                var errorOut = errMsg.output.error; //output is a error output of command or not
                var message = errMsg.output.message; //command output message
                var name = errMsg.server.replace(/[/]/g, '---');

                //write all errMsg to a string, this message will be wrote in the state of backup server
                //split string
                var msgSpltArr = message.split('\n');
                var msgArr = msgSpltArr[0].split(':');

                outputBackupState += name + " ::: " + msgArr[2] + " - " + msgArr[3] + " :: " + msgArr[4] + " " + msgArr[5] + '\n';

                if (name == bserver) { } else {

                    var serviceState = 2; //error
                    outputServiceState += name + " ::: " + msgArr[2] + "::" + msgArr[3] + ": " + msgArr[4] + '\n';
                    errMsg.output.message = outputServiceState

                    //send state of backup to monitoring, create a service if not exist.
                    setCreateServiceState(self, bserver, name, serviceState, errMsg, false)
                        .then((result) => {
                            logger.debug("Backup server: " + bserver + ". Service " + name + " was created and state of service was set");
                        })
                        .catch((err) => {
                            logger.error("Backup Server: " + bserver + ". Cannot set state(2) of service " + name + " or create a service. Err: " + err);
                        })

                }
            })
            //write state of backup server in to monitoring
            setHostMonStat(self, bserver, backupHostState, outputBackupState)
                .then((hoststat) => {
                    logger.debug("Backup server: " + bserver + " state " + backupHostState + " was set");
                    return callback(null, hoststat);
                })
                .catch((err) => {
                    logger.error("Backup server: " + bserver + " state " + backupHostState + " cannot be set in monitoring.Err: " + err);
                    return callback(err, null);
                })
        }
    }

    //compare backups with services in monitoring and delete services if backup not exist
    var compareBackupMon = function (callback) {

        var bServArr = []; //aaray of objects from backup
        var bServArrTemp = []; //aaray of objects from backup - temp
        var iServArr = []; //array for services from monitoring

        output.map((server) => {
            if (server.server !== bserver) {
                var name = server.server.replace(/[/]/g, '---');
                bServArrTemp.push(name);
                bServArrTemp.push(name);
            }
        })

        bServArr = Array.from(new Set(bServArrTemp)); //remove duplicates

        self.icingaServer.getServiceFiltered({
            "filter": "service.vars.Backup_Server == servicename",
            "filter_vars": {
                "servicename": bserver
            }
        }, function (err, result) {
            if (err) {
                return callback(err, null);
            } else {
                if (result.length > 0) {
                    result.map((iciSrvObj) => {
                        var letTempArr = iciSrvObj.name.split('!');
                        iServArr.push(letTempArr[1]);
                        
                        deleteDiffToBackup(self, bServArr, iServArr, bserver, function (err, result) {
                            if (err) {
                                logger.error("Cannot delete difs to mon. Err: " + err);
                                return callback(err, null);
                            } else {
                                logger.debug("Diffs between backupjob and monitorin are deleted.");
                                return callback(null, result);
                            }
                        })
                    })
                }
            }
        })
    }

    //check if the backup server exist in monitoring
    checkHost(self, bserver)
        .then((stat) => {
            logger.debug("Backup server: " + bserver + " was found in monitoring");
            
            setHostMonStat(self, bserver, backupHostState, "OK")
                .then((hoststat) => {
                    logger.debug("Backup server: " + bserver + " state " + backupHostState + " was set.");
                    
                    createServices(function (err, stateOutput) {
                        if (err) {
                            return callback(err, null);
                        } else {
                            //ignore compare, if it's a single backup
                            if (self.singlebackup == null && self.singlebackup == undefined && backupHostState == 0) {
                                compareBackupMon(function (err, comRes) {
                                    if (err) {
                                        return callback(err, null);
                                    } else {
                                        return callback(null, comRes);
                                    }
                                });
                            } else {
                                logger.debug("Single backup");
                                return callback(null, stateOutput);
                            }

                        }
                    })

                })
                .catch((err) => {
                    logger.error("Backup server: " + bserver + " state " + backupHostState + " cannot be set in monitoring.Err: " + err);
                    return callback(err, null);
                })
        })
        .catch((err) => {
            if (err.Statuscode == '404') {
                
                //backup server was not found, create the new one
                createHost(self, bserver)
                    .then((createStat) => {
                        logger.debug("Backup server: " + bserver + " was created in monitoring");
                        
                        setHostMonStat(self, bserver, backupHostState, "OK")
                            .then((hoststat) => {
                                logger.debug("Backup server: " + bserver + " state " + backupHostState + " was set.");
                        
                                createServices(function (err, stateOutput) {
                                    if (err) {
                                        return callback(err, null);
                                    } else {
                                        //ignore compare, if it's a single backup
                                        if (self.singlebackup == null && self.singlebackup == undefined && backupHostState == 0) {
                                            compareBackupMon(function (err, comRes) {
                                                if (err) {
                                                    return callback(err, null);
                                                } else {
                                                    return callback(null, comRes);
                                                }
                                            });
                                        } else {
                                            logger.debug("Single backup");
                                            return callback(null, stateOutput);
                                        }
                                    }
                                })
                            })
                            .catch((err) => {
                                logger.error("Backup server: " + bserver + " state " + backupHostState + " cannot be set in monitoring.Err: " + err);
                            })
                    })
                    .catch((err) => {
                        logger.error("Cannot create backup server. Err: " + err);
                        return callback(err, null);
                    })
            } else {
                return callback(err, null);
            }
        })
}

//func to check if service exist in monitoring, if not create a new one and set state of them
function setCreateServiceState(self, bserver, serviceName, serviceState, message, type) {

    return new Promise((resolve, reject) => {

        if (type == "borg") {
            var borgOut = JSON.parse(message);
            var serviceObj = JSON.stringify({
                "templates": [self.srvtemplate],
                "attrs": {
                    "display_name": "Backup of server " + serviceName,
                    "vars.backupprovider": type,
                    "vars.Backup_Server": bserver
                }
            })
        }

        if (type == "duplicity") {
            var serviceObj = JSON.stringify({
                "templates": [self.srvtemplate],
                "attrs": {
                    "display_name": "Backup of server " + serviceName,
                    "vars.backupprovider": type,
                    "vars.Backup_Server": bserver
                }
            })
        }

        if (type == false) {

            var serviceObj = JSON.stringify({
                "templates": [self.srvtemplate],
                "attrs": {
                    "display_name": "Backup of server " + serviceName,
                    "vars.backupprovider": "not_defined",
                    "vars.Backup_Server": bserver
                }
            })
        }

        var setServicePerfData = function (serviceObj, callback) {

            if (serviceState != 0) { //if a command exited with the error stat, then search this error in output array and write as a message in monitoring.

                var msg = message.output.message;
                self.icingaServer.setServiceState(serviceName, bserver, serviceState, msg, function (err, result) {
                    if (err) {
                        logger.error("Cannot set state " + serviceState + " of service " + serviceName + ".Err: " + JSON.parse(err));
                        return callback(err, null);
                    } else {
                        return callback(null, result);
                    }
                })

            } else {

                if (type == 'borg') {
                    var borgJson = JSON.parse(message);
                    var starttime = borgJson.archive.start;
                    var endtime = borgJson.archive.end;
                    var changedsize = borgJson.cache.stats.unique_csize;
                    var dedupsize = borgJson.archive.stats.deduplicated_size;
                    var totalsize = borgJson.archive.stats.original_size;

                    var perfdataArr = [
                        "Backup size in MB=" + changedsize / 1000000 + "MB;",
                        "Backup size changed in MB=" + dedupsize / 1000000 + "MB;"
                    ]

                    var outputService = JSON.stringify({
                        'Name': serviceName,
                        'StartTime': starttime,
                        'Endtime': endtime,
                        'Compressed Size': (changedsize / 1000000) + ' MB',
                        'Changed Files Size': (dedupsize / 1000000) + ' MB',
                        'Original Size': (totalsize / 1000000) + ' MB',
                    });

                    self.icingaServer.setServicePerfdata(serviceName, bserver, serviceState, outputService, perfdataArr, function (err, result) {
                        if (err) {
                            return callback(err, null);
                        } else {
                            return callback(null, result);
                        }
                    })
                }

                if (type == 'duplicity') {
                    self.icingaServer.setServiceState(serviceName, bserver, serviceState, "Backup was created", function (err, result) {
                        if (err) {
                            return callback(err, null);
                        } else {
                            return callback(null, result);
                        }
                    })
                }
            }
        }

        self.icingaServer.getService(bserver, serviceName, function (err, result) {
            if (err) {
                if (err.Statuscode == '404') {
                    
                    self.icingaServer.createServiceCustom(serviceObj, bserver, serviceName, function (err, srvStat) {
                        if (err) {
                            return reject(err);
                        } else {
                            //set state and message and perfdata
                            setServicePerfData(serviceObj, function (err, result) {
                                if (err) {
                                    return reject(err);
                                } else {
                                    return resolve(result);
                                }
                            })
                        }
                    })
                } else {
                    return reject(err);
                }
            } else {

                setServicePerfData(serviceObj, function (err, result) {
                    if (err) {
                        return reject(err);
                    } else {
                        return resolve(result);
                    }
                })
            }
        })
    })
}

//check if the backup host exist
function checkHost(self, host) {
    return new Promise((resolve, reject) => {

        self.icingaServer.getHost(host, function (err, result) {
            if (err) {
                return reject(err);
            } else {
                return resolve(result);
            }
        })
    })
}

//func to create a host in monitoring
function createHost(self, bserver) {

    var bConfig = self.config.backupserver[bserver]
    var forServerArr = JSON.parse(bConfig.backupfor);
    var forServer = "";

    forServerArr.map((server) => {
        forServer += server + ",";
    })

    var icingaObj = JSON.stringify({
        "templates": [self.hosttemplate],
        "attrs": {
            "display_name": "Backup Server " + bserver,
            "vars.group": self.hostgroup,
            "vars.backuppath": bConfig.backuppath,
            "vars.backupprovider": bConfig.provider,
            "vars.backupfor": forServer
        }
    })

    return new Promise((resolve, reject) => {
        self.icingaServer.createHostCustom(icingaObj, bserver, function (err, result) {
            if (err) {
                return reject(err);
            } else {
                return resolve(result);
            }
        })
    })
}

//func to set state of monitoring host (0 - ok, 2 - err);
function setHostMonStat(self, bserver, hostState, StateMessage) {

    return new Promise((resolve, reject) => {
        self.icingaServer.setHostState(bserver, hostState, StateMessage, function (err, result) {
            if (err) {
                return reject(err);
            } else {
                return resolve(result);
            }
        })
    })
}

//compare backup jobs of once backup server with registred services in monitoring and delete
// service if this backups jobs was not found.
function deleteDiffToBackup(self, backupArr, monArr, bserver, callback) {

    var diff = monArr.filter(x => backupArr.indexOf(x) == -1);

    if (diff.length > 0) {
        for (var x = 0; x < diff.length; x++) {
            self.icingaServer.deleteService(diff[x], bserver, function (err, result) {
                if (err) {
                    logger.error("Error on delete service. Err: " + JSON.stringify(err));
                    return callback(err, null);
                } else {
                    logger.debug("Monitoring service: " + diff[x] + " of host " + bserver + " was deleted. Backupjob was not found");
                    return callback(null, result);
                }
            })
        }
    }
}