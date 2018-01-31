'use strict';

var helpf   = require('../misc/helpFunc');
var logger  = require('../logger/Logger');

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

module.exports = {
    createBackupCommands
}