"use strict";

var sshComm = require('../misc/sshFunc');
var logger = require('../logger/Logger');
var kube = require('../backup/kubeBackup');
var helpf = require('../misc/helpFunc');
var dock = require('../backup/dockerBackup');
var dupl = require('../duplicity/duplicityCommands');
var borg = require('../borg/borgCommands');

//this function create an array of commands for backup 
// server prerun and postrun commands
var createBackupPrePostCommands = async function (prepostCom, backupServer, execServer, backupConfig) {
    var self = this;
    var backupConfig = backupConfig;
    var backupServerConfig = helpf.getServerConfig(backupServer, 'backup', backupConfig);
    var execServerConfig = helpf.getServerConfig(execServer, '', backupConfig);

    return new Promise((resolve, reject) => {
        var preArr = []; //arr for preRun commands
        var postArr = []; //array for postRun commands
        var commObj = {
            'name': backupServer,
        }
        if (prepostCom == "prerun") { //create prerun commands
            if (backupServerConfig.prerun !== undefined && backupServerConfig.prerun !== null) { //if prerun configuration was found
                var backupSerPrerun = JSON.parse(backupServerConfig.prerun); //convert configuration from string to an object
                for (var i = 0; i < backupSerPrerun.length; i++) {

                    var commands = {
                        'server': backupServer,
                        'command': backupSerPrerun[i],
                        'stat': false
                    }
                    preArr.push(commands);
                    commObj.arr = preArr;
                }
            }
        }

        if (prepostCom == 'postrun') { //create postrun commands
            if (backupServerConfig.postrun !== undefined && backupServerConfig.postrun !== null) { //if postrun configuration was found
                var backupSerPostrun = JSON.parse(backupServerConfig.postrun); //convert configuration from string to an object

                for (var i = 0; i < backupSerPostrun.length; i++) {

                    var commands = {
                        'server': backupServer,
                        'command': backupSerPostrun[i],
                        'stat': false
                    }
                    postArr.push(commands);
                    commObj.arr = postArr;
                }
            }
        }

        return resolve(commObj);
    })
};

//this function will be separate the server type - normal server, docker, kubernetes
var createBackupCommandsServer = async function (backupServer, execServer, backupConfig) {
    var self = this;
    var backupServerConfig = helpf.getServerConfig(backupServer, 'backup', backupConfig);
    var servers = JSON.parse(backupServerConfig.backupfor);
    var serverToBackupArr = [];
    var backupProv = backupServerConfig.provider;
    var pidfolder = backupConfig.starter.pids;

    //check, if servers are defined in backupfor section
    if(servers.length <= 0){
        logger.debug('No servers was defined in backupconfig/server/backupfor. Exit');
        process.exit(1);
    }

    if (backupProv == 'borg') {
        //provider borg
        logger.debug("Backupprivder is " + backupProv);
        
        for (var y = 0; y < servers.length; y++) {
            var config = helpf.getServerConfig(servers[y], '', backupConfig);
            
            if (config.backup !== undefined && config.backup !== null) { //this is a normal server (wi'll be save only a folder with files)
                var serverBackupCommands = await borg.createBackupCommands(config, servers[y], false, backupConfig, backupServer, execServer)
                serverToBackupArr.push(serverBackupCommands);
            }
            if (config.docker !== undefined && config.docker !== null) { //this is a docker host
                //wi'll run a command to get information of all container running on this docker host
                var dockerBackupCommands = await dock.getAllContainerOnServer(servers[y], backupConfig, backupServer, execServer);

                for (var i = 0; i < dockerBackupCommands.length; i++) { //create backupcommands array for each container, where backup labes are defined
                    var conComm = await borg.createBackupCommands(dockerBackupCommands[i], servers[y], true, backupConfig, backupServer, execServer);
                    serverToBackupArr.push(conComm);
                }
            }

            if (config.kube !== undefined && config.kube !== null) {//this is a kubernetes node
                //get all deploys from all or from defined namespaces (this is an option from config.yaml file)
                var kubeDeploys = await kube.getAllDeployOnKube(servers[y], backupConfig, backupServer, execServer);

                for (var i = 0; i < kubeDeploys.length; i++) { //create backupcommands for each deploy, where backup annotation are defined
                    var depComm = await borg.createBackupCommands(kubeDeploys[i], servers[y], true, backupConfig, backupServer, execServer);
                    serverToBackupArr.push(depComm); //push backupcommands to an array;
                }
            }
        }
    } else {
        //provider duplicity
        if (backupProv == 'duplicity') {
            logger.debug("Backupprivder is " + backupProv);
            for (var y = 0; y < servers.length; y++) {
                var config = helpf.getServerConfig(servers[y], '', backupConfig);

                if (config.backup !== undefined && config.backup !== null) { //this is a normal server (wi'll be save only a folder with files)
                    var serverBackupCommands = await dupl.createBackupCommands(config, servers[y], false, backupConfig, backupServer)
                    serverToBackupArr.push(serverBackupCommands);
                }
                if (config.docker !== undefined && config.docker !== null) { //this is a docker host
                    //wi'll run a command to get information of all container running on this docker host
                    var dockerBackupCommands = await dock.getAllContainerOnServer(servers[y], backupConfig, backupServer, execServer);

                    for (var i = 0; i < dockerBackupCommands.length; i++) { //create backupcommands array for each container, where backup labes are defined
                        var conComm = await dupl.createBackupCommands(dockerBackupCommands[i], servers[y], true, backupConfig, backupServer);
                        serverToBackupArr.push(conComm);
                    }
                }

                if (config.kube !== undefined && config.kube !== null) {//this is a kubernetes node
                    //get all deploys from all or from defined namespaces (this is an option from config.yaml file)
                    var kubeDeploys = await kube.getAllDeployOnKube(servers[y], backupConfig, backupServer, execServer);

                    for (var i = 0; i < kubeDeploys.length; i++) { //create backupcommands for each deploy, where backup annotation are defined
                        var depComm = await dupl.createBackupCommands(kubeDeploys[i], servers[y], true, backupConfig, backupServer);
                        serverToBackupArr.push(depComm); //push backupcommands to an array;
                    }
                }
            }
        } else {
            logger.error('Backup provider not defined in config.yaml. Exit');
            process.exit(1);
        }
    }

    return new Promise((resolve, reject) => {
        return resolve(serverToBackupArr);
    })
}

module.exports = {
    createBackupCommandsServer,
    createBackupPrePostCommands,
}