"use strict";

var sshComm = require('./sshFunc');
var logger  = require('./Logger');
var kube    = require('./kubeBackup');
var helpf   = require('./helpFunc');
var dock    = require('./dockerBackup');
var fs      = require('fs');

//this function create an array of commands for backup 
// server prerun and postrun commands
var createBackupPrePostCommands = async function (prepostCom, backupServer, execServer, backupConfig) {
    var self                = this;
    var backupConfig        = backupConfig;
    var backupServerConfig  = helpf.getServerConfig(backupServer, 'backup', backupConfig);
    var execServerConfig    = helpf.getServerConfig(execServer, '', backupConfig);

    return new Promise((resolve, reject) => {
        var preArr  = []; //arr for preRun commands
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
    var self                = this;
    var backupServerConfig  = helpf.getServerConfig(backupServer, 'backup', backupConfig);
    var servers             = JSON.parse(backupServerConfig.backupfor);
    var serverToBackupArr   = [];
    var pidfolder           = backupConfig.starter.pids;
    for (var y = 0; y < servers.length; y++) {
        var config          = helpf.getServerConfig(servers[y], '', backupConfig);
        
        if (config.backup !== undefined && config.backup !== null) { //this is a normal server (where wi'll be save only a folder with files)
            var serverBackupCommands = await createBackupCommands(config, servers[y], false, backupConfig, backupServer)
            serverToBackupArr.push(serverBackupCommands);
        }
        if (config.docker !== undefined && config.docker !== null) { //this is a docker host
            //wi'll run a command to get information of all container running on this docker host
            var dockerBackupCommands = await dock.getAllContainerOnServer(servers[y], backupConfig, backupServer, execServer);
            
            for (var i = 0; i < dockerBackupCommands.length; i++) { //create backupcommands array for each container, where backup labes are defined
                var conComm = await createBackupCommands(dockerBackupCommands[i], servers[y], true, backupConfig, backupServer);
                serverToBackupArr.push(conComm);
            }
        }

        if (config.kube !== undefined && config.kube !== null) {//this is a kubernetes node
            //get all deploys from all or from defined namespaces (this is an option from config.yaml file)
            var kubeDeploys = await kube.getAllDeployOnKube(servers[y], backupConfig, backupServer, execServer);
            
            for (var i = 0; i < kubeDeploys.length; i++) { //create backupcommands for each container, where backup annotation are defined
                var depComm = await createBackupCommands(kubeDeploys[i], servers[y], true, backupConfig, backupServer);
                serverToBackupArr.push(depComm); //push backupcommands to an array;
            }
        }
    }

    return new Promise((resolve, reject) => {
        return resolve(serverToBackupArr);
    })
}

var createBackupCommands = async function (serverConfig, server, dockerType, backupConfig, backupServer) {
    //    serverconfig =  { HOST: 'superdocker.local',
    //   USER: 'docker',
    //   PORT: 22,
    //   prerun: [ 'sudo docker stop backupnewtest_httpd_1 backupnewtest_redis_1' ],
    //   postrun: undefined,
    //   strategy: 'off',
    //   nextfullbackup: '1M',
    //   noffullbackup: '2',
    //   backup: '/a/data/backup-new-test',
    //   confprefixes: '["allow-source-mismatch"]',
    //   compression: undefined,
    //   sftpServer: { sudo: true, path: '/usr/lib/sftp-server' },
    //   docker: 'true',
    //   passphrase: '+++++containerPASS#######' }
    // console.log(serverConfig);

    var backupServerConfig = helpf.getServerConfig(backupServer, 'backup', backupConfig); //get configuration of backup server

    var ConfigArr   = [];
    var config      = serverConfig
    var sName       = server;

    if (dockerType) { //if type of server is docker or kubernetes
        var cName   = config.name 
        var dockerHost = true;
    } else {
        var cName = sName;
        var dockerHost = false;
        var containerName = null;
    }

    //check if confprefixes are defined, if true add prefix to rdiff-backup command
    if (config.confprefixes !== undefined && config.confprefixes !== null) {
        var rdiffPrefixes;
        var confprefixes = JSON.parse(config.confprefixes);
        for (var y = 0; y < confprefixes.length; y++) {
            if (y === 0) {
                rdiffPrefixes = " --" + confprefixes[y];
            } else {
                rdiffPrefixes += " --" + confprefixes[y];
            }
        }
    } else {
        rdiffPrefixes = "";
    }

    //create mount command
    //sshfs aditoadmin@172.23.40.220:/ /tmp/dockerdmz -o IdentityFile=/home/vagrant/.ssh/id_rsa -o sftp_server="/usr/bin/sudo /usr/lib/sftp-server"
    var mkDir = {
        'server': backupServer,
        'command': "sudo mkdir -p /tmp/" + cName,
        'stat': false
    }
    var checkBackupDir = {
        'server': backupServer,
        'command': "sudo mkdir -p " + backupServerConfig.backuppath + "/" + cName,
        'stat': false
    }
    if (config.sftpServer !== undefined && config.sftpServer !== null) {
        if (config.sftpServer.sudo !== undefined && config.sftpServer.sudo !== null && config.sftpServer.sudo === true) {
            if (config.sftpServer.path !== undefined && config.sftpServer.path !== null) {
                var sshParam = ' -o ServerAliveInterval=15 -o StrictHostKeyChecking=no -o StrictHostKeyChecking=no -o Compression=no -o IdentityFile=/tmp/id -o sftp_server="/usr/bin/sudo ' + config.sftpServer.path + '"';
            } else {
                logger.debug("sfptServer.sudo set to true, but sftpServer.path is not defined, ignore");
                var sshParam = ' -o IdentityFile=/tmp/id -o ServerAliveInterval=15 -o StrictHostKeyChecking=no -o Compression=no';
            }
        } else {
            var sshParam = ' -o IdentityFile=/tmp/id -o StrictHostKeyChecking=no -o ServerAliveInterval=15 -o Compression=no';
        }
    } else {
        var sshParam = ' -o IdentityFile=/tmp/id -o StrictHostKeyChecking=no -o ServerAliveInterval=15 -o Compression=no';
    }

    if (config.SMB !== undefined) {
        if (config.SMB.SET === "true") {
            if (config.SMB.DOMAIN !== undefined && config.SMB.DOMAIN !== null) {
                var mComandTemp = "sudo mount -t cifs //" + config.HOST + "/" + config.SMB.PATH + " /tmp/" + cName + " -o username=" + config.USER + ",passwd=\'" + config.SMB.PASS + "\',domain=" + config.SMB.DOMAIN + ",iocharset=utf8,file_mode=0777,dir_mode=0777";
            } else {
                var mComandTemp = "sudo mount -t cifs //" + config.HOST + "/" + config.SMB.PATH + " /tmp/" + cName + " -o username=" + config.USER + ",passwd=\'" + config.SMB.PASS + "\',iocharset=utf8,file_mode=0777,dir_mode=0777";
            }

            logger.debug(config + " SMB Share found");
        } else {
            logger.error(config + " SMB Share is not defined");
        }
    } else {
        var mComandTemp = "sudo sshfs -p " + config.PORT + " " + config.USER + "@" + config.HOST + ":" + config.backup + " /tmp/" + cName + sshParam;
    }

    var mountComand = {
        'server': backupServer,
        'command': mComandTemp,
        'stat': false
    }

    //mount, remove shares;
    var uMount = "sudo umount /tmp/" + cName;
    var pathDel = "sudo rm -Rf /tmp/" + cName;

    if (config.include !== undefined) {
        var includeArr = JSON.parse(config.include);

        for (var i = 0; i < includeArr.length; i++) {
            if (include === undefined) {
                var include = " --include \'/tmp/" + cName + "/" + includeArr[i] + "\'";
            } else {
                include = include + " --include /tmp/" + cName + "/" + includeArr[i];
            }
        }
        logger.debug(cName + ":includes:" + includeArr);
    }

    //check backup part size
    //backuppartsize
    if (backupServerConfig.backuppartsize !== undefined && backupServerConfig.backuppartsize !== null) {
        var backupPartSize = " --volsize=" + backupServerConfig.backuppartsize;
    } else {
        var backupPartSize = " --volsize=100";
    }

    //create exclude for rdiff-backup command
    if (config.exclude !== undefined) {
        var excludeArr = JSON.parse(config.exclude);

        for (var x = 0; x < excludeArr.length; x++) {
            if (exclude === undefined) {
                var exclude = " --exclude \'/tmp/" + cName + "/" + excludeArr[x] + "\'";
            } else {
                exclude = exclude + " --exclude \'/tmp/" + cName + "/" + excludeArr[x] + "\'";
            }
        }
        logger.debug(cName + ":excludes:" + excludeArr);
    }

    //add include,exclude to var InExclude;
    var InExclude;
    if (include !== undefined) {
        InExclude = include + " ";
    }
    if (exclude !== undefined) {
        if (InExclude !== undefined) {
            InExclude += exclude;
        } else {
            InExclude = exclude;
        }
    }

    if (backupServerConfig.tmpdir !== undefined && backupServerConfig.tmpdir !== null) {
        var tmpdir = backupServerConfig.tmpdir;
    } else {
        var tmpdir = "";
    }

    if (config.nextfullbackup !== undefined && config.nextfullbackup !== null) {
        var fullafter = " --full-if-older-than " + config.nextfullbackup;
        logger.debug(cName + ": Next full backup will be start after: " + config.nextfullbackup);
    } else {
        var fullafter = "";
        logger.debug(cName + ": Next full backup is not defined. Only inc backups");
    }

    //check compression
    if (config.compression === false) {
        var duplicityCompress = ' --gpg-options "--compress-algo none"';
        logger.debug("Compression on " + cName + " is disabled");
    } else {
        var duplicityCompress = "";
        logger.debug("Compression on " + cName + " is enabled");
    }

    if (config.passphrase !== undefined && config.passphrase !== null) {
        var passphrase = config.passphrase;
        logger.debug("Passphrase for backup is in container/server defiened");
    } else {
        var passphrase = backupServerConfig.passphrase;
    }

    if (passphrase !== undefined && passphrase !== null) {
        var duplicityComm = "sudo PASSPHRASE=\"" + passphrase + "\" TMPDIR=\"" + tmpdir + "\" duplicity ";
    } else {
        var duplicityComm = "sudo TMPDIR=\"" + tmpdir + "\" duplicity --no-encryption ";
    }

    var duplicityarchiv = backupServerConfig.duplicityarchiv;
    if (duplicityarchiv !== undefined && duplicityarchiv !== null) {
        var duplicityArch = " --archive-dir=" + duplicityarchiv;
    } else {
        var duplicityArch = "";
    }

    var duplicitySSHParam = ' --ssh-options=\"-oIdentityFile=\'/tmp/id\'\ -oStrictHostKeyChecking=no -oServerAliveInterval=15 -oCompression=no"';
    var duplicityOthPara = " /tmp/" + cName;
    var duplicityRsyncSudo = ' --rsync-options=\'--rsync-path=\"sudo rsync\" --rsh=\"ssh -oBatchMode=yes -p ' + backupServerConfig.PORT + ' -oIdentityFile=\'/tmp/id\' -oStrictHostKeyChecking=no -oCompression=no\"\'';
    var rsyncParam = " rsync://" + backupServerConfig.USER + "@" + backupServerConfig.HOST + "/" + backupServerConfig.backuppath + "/" + cName;

    //if include,exclude exist add to rdiff-backup command
    if (InExclude !== undefined) {
        var duplicityRunTemp = duplicityComm + duplicityArch + backupPartSize + fullafter + duplicityCompress + InExclude + rdiffPrefixes + duplicitySSHParam + duplicityOthPara + duplicityRsyncSudo + rsyncParam;
    } else {
        var duplicityRunTemp = duplicityComm + duplicityArch + backupPartSize + fullafter + duplicityCompress + rdiffPrefixes + duplicitySSHParam + duplicityOthPara + duplicityRsyncSudo + rsyncParam;
    }

    logger.debug(sName + ":duplicity command: " + duplicityRunTemp);

    var duplicityRun = {
        'server': backupServer,
        'command': duplicityRunTemp,
        'type': 'duplicity',
        'stat': true
    }

    ConfigArr.push(mkDir);
    ConfigArr.push(checkBackupDir);

    //create preRun
    var preRunCommands = config.prerun;
    if (preRunCommands !== undefined && preRunCommands !== null && preRunCommands.length > 0) { //if prerun commands exist add this to command array -> commandArr;
        if (dockerHost == true) {
            var preRunArr = preRunCommands;
        } else {
            var preRunArr = JSON.parse(preRunCommands);
        }
        for (var y = 0; y < preRunArr.length; y++) {
            var ppArr = {
                'server': sName,
                'command': preRunArr[y],
                'stat': false
            }
            ConfigArr.push(ppArr);
        }
        logger.debug(cName + ":preRun found: " + preRunArr);
    }

    //create command to mount sshfs 
    ConfigArr.push(mountComand);

    //add rdiff-backup commands to commandArr
    ConfigArr.push(duplicityRun);

    var postRunCommands = config.postrun;
    if (postRunCommands !== undefined && postRunCommands !== null && postRunCommands.length > 0) { //if postrun commands exist add this to command arr -> commandArr;
        if (dockerHost) {
            var postRun = postRunCommands;
        } else {
            var postRun = JSON.parse(postRunCommands);
        }
        for (var y = 0; y < postRun.length; y++) {
            var pArr = {
                'server': sName,
                'command': postRun[y],
                'stat': false
            }
            ConfigArr.push(pArr);
        }
        logger.debug(sName + ":postRun found: " + postRun);
    }

    if (config.noffullbackup != undefined) {
        var num = config.noffullbackup;
        var duplicityRunClean = duplicityComm + " remove-all-but-n-full " + num + " --force " + rsyncParam + duplicityRsyncSudo + duplicityArch;
        var runDupFullBackupClean = {
            'server': backupServer,
            'command': duplicityRunClean,
            'stat': false
        }
        logger.debug(sName + ": " + runDupFullBackupClean);
        ConfigArr.push(runDupFullBackupClean);

    } else {
        logger.debug(sName + ": Command to remove old Backups was not found");
    }

    var uMountTempDir = {
        'server': backupServer,
        'command': uMount,
        'stat': false
    }

    var delTempDir = {
        'server': backupServer,
        'command': pathDel,
        'stat': false
    }

    ConfigArr.push(uMountTempDir);
    ConfigArr.push(delTempDir);

    var commandObj = {
        name: sName,
        arr: ConfigArr
    }

    if (dockerType) {
        commandObj.containerName = cName;
        commandObj.pidnm = cName;
        if (config.startaftererror) {
            commandObj.failover = config.failover;
        } else {
            commandObj.failover = false;
        }
    } else {
        commandObj.containerName = null;
        commandObj.pidnm = sName;
        commandObj.failover = false;
    }

    return new Promise((resolve, reject) => {
        return resolve(commandObj);
    })
}

var runCommands = async function (toRunArr, eServer, bServer, backupConfig) {
    var outputArr = [];
    var stopAll = false;
    var pidsfolder = backupConfig.starter.pids;

    for (var i = 0; i < toRunArr.length; i++) {
        var commands = toRunArr[i].arr;
        var pidfile = pidsfolder + '/' + toRunArr[i].pidnm + '.pid';

        // var commType = commands.find(o => o.type === 'duplicity');

        for (var y = 0; y < commands.length; y++) {
            var execServer = helpf.getSSHConf(eServer, '', backupConfig);
            var tServer = helpf.getSSHConf(commands[y].server, '', backupConfig);
            var commandToRun = commands[y].command;
            var commandOutput = commands[y].stat;
            var commType = commands[y].type;
            var outputObj = {
                'server': toRunArr[i].name,
                'command': commandToRun,
                'output': {
                    'error': '',
                    'message': '',
                    'stat': commands[y].stat
                }
            }

            // if (pidfile !== undefined) {
            //     if (commType == 'duplicity') {
            //         console.log(pidfile, "\n", commType);
            //     }
            // }

            //check pidfile;
            // var pidfile = pidsfolder + '/' + toRunArr[i].pidnm;
            // if (!fs.existsSync(pidfile)) {
            //     var notRun = false;
            //     var dt = new Date();
            //     fs.writeFileSync(pidfile, "started until " + dt, 'utf8');
            // } else {
            //     var notRun = true;
            //     var fileStartTime = fs.readFileSync(pidfile);
            // }

            var commType = commands[y].type;
            if (commType !== undefined && commType !== null && commType == "duplicity") {
                outputObj.type = "duplicity";
            } else {
                outputObj.type = false;
            }

            var connName = toRunArr[i].containerName;
            if (connName !== undefined && connName !== null) {
                outputObj.server = toRunArr[i].name + "/" + connName;
            }

            if (commType !== undefined) {
                if (!fs.existsSync(pidfile)) {
                    var notRun = false;
                } else {
                    var notRun = true;
                }
            }
            try {
                if (commType !== undefined) { //duplicity
                    if (notRun) { //if pid file not exist
                        var backupDate = fs.readFileSync(pidfile, 'utf8');
                        outputObj.output.error = true;
                        outputObj.output.message = 'Backupjob already running since' + backupDate;
                    } else { //pid file exist
                        var dt = new Date();
                        fs.writeFileSync(pidfile, dt, 'utf8');

                        var outputComm = await sshComm.runUnderSSH(commandToRun, execServer.SSHKey, execServer, tServer, commandOutput);
                        outputObj.output.error = false;
                        outputObj.output.message = outputComm;

                        fs.unlinkSync(pidfile);
                    }
                } else {
                    var outputComm = await sshComm.runUnderSSH(commandToRun, execServer.SSHKey, execServer, tServer, commandOutput);
                    outputObj.output.error = false;
                    outputObj.output.message = outputComm;
                }
            }
            catch (err) {
                outputObj.output.stat = true;

                if (outputObj.server == bServer) {
                    outputObj.output.error = true;
                    outputObj.output.message = "Backup server : " + bServer + " command problem. Output: " + err + " Stopp all next commands.Exit";
                    outputArr.push(outputObj);
                    stopAll = true;
                    break;
                } else {
                    outputObj.output.error = true;
                    var failover = toRunArr[i].failover;
                    if (failover.run) {
                        try {
                            var eServerFailover = helpf.getSSHConf(failover.server, '', backupConfig);
                            var outputComm = await sshComm.runUnderSSH(failover.command, eServerFailover.SSHKey, execServer, eServerFailover);
                            outputObj.output.message = "Command run error: " + commandToRun + " " + err + ". Run failover comand: Output: " + outputComm;
                            outputArr.push(outputObj);
                        }
                        catch (err) {
                            outputObj.output.message = "Command run error: " + err + ". Run failover comand, also err: " + outputComm;
                            outputArr.push(outputObj);
                        }
                    } else {
                        outputObj.output.message = "Command run error: " + commandToRun + " " + err;
                        outputArr.push(outputObj);
                    }

                    break;
                }
            }

            outputArr.push(outputObj);
        }

        if (stopAll) {
            stopAll = false;
            break;
        }
    }

    return new Promise((resolve, reject) => {
        return resolve(outputArr);
    })
}


module.exports = {
    createBackupCommandsServer,
    createBackupPrePostCommands,
    runCommands
}