'use strict';

var helpf = require('./helpFunc');
var logger = require('./Logger');
var sshRun = require('./execArray');

var createBackupCommands = async function (serverConfig, server, dockerType, backupConfig, backupServer, execServer) {
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

    var ConfigArr = [];
    var config = serverConfig
    var sName = server;

    if (dockerType) { //if type of server is docker or kubernetes
        var cName = config.name
        var dockerHost = true;
    } else {
        var cName = sName;
        var dockerHost = false;
        var containerName = null;
    }

    //command to list the repo folder of a backup (if folder exist);
    var backupRepoCheck = [{
        'name': backupServer,
        'arr': [
            {
                'server': backupServer,
                'command': 'ls -A1 ' + backupServerConfig.backuppath,
                'stat': true
            }
        ]
    }]

    var checkRepoDirs = await sshRun.runCommands(backupRepoCheck, execServer, backupServer, backupConfig);
    var repoDir = checkRepoDirs[0].output.message;
    var dirsArr = repoDir.split('\n');

    //check if passphrasse for backup is defined
    if (config.passphrase !== undefined && config.passphrase !== null) {
        var passphrase = 'sudo BORG_PASSPHRASE=' + config.passphrase;
        var borgPassVar = ' -e repokey-blake2';
        logger.debug("Passphrase for backup is in container/server defiened");
    } else {
        if (backupServerConfig.passphrase !== undefined && backupServerConfig.passphrase !== null) {
            var passphrase = 'sudo BORG_PASSPHRASE=' + backupServerConfig.passphrase;
            var borgPassVar = ' -e repokey-blake2';
        } else {
            var passphrase = 'sudo ';
            var borgPassVar = ' -e none';
        }
    }

    //command to initial a folder as a borg repo
    var inizialiseBackup = {
        'server': backupServer,
        'command': passphrase + ' borg init' + borgPassVar + ' ' + backupServerConfig.backuppath + "/" + cName,
        'stat': false
    }

    //create mount command
    //sshfs aditoadmin@172.23.40.220:/ /tmp/dockerdmz -o Cipher=arcfour -o IdentityFile=/home/vagrant/.ssh/id_rsa -o sftp_server="/usr/bin/sudo /usr/lib/sftp-server"
    var mkDir = {
        'server': backupServer,
        'command': "sudo mkdir -p /tmp/" + cName,
        'stat': false
    }

    //check sftp parameter in config.yaml
    if (config.sftpServer !== undefined && config.sftpServer !== null) {
        if (config.sftpServer.sudo !== undefined && config.sftpServer.sudo !== null && config.sftpServer.sudo === true) {
            if (config.sftpServer.path !== undefined && config.sftpServer.path !== null) {
                var sshParam = ' -o ServerAliveInterval=15 -o Ciphers=arcfour -o StrictHostKeyChecking=no -o StrictHostKeyChecking=no -o Compression=no -o IdentityFile=/tmp/id -o sftp_server="/usr/bin/sudo ' + config.sftpServer.path + '"';
            } else {
                logger.debug("sfptServer.sudo set to true, but sftpServer.path is not defined, ignore");
                var sshParam = ' -o IdentityFile=/tmp/id -o ServerAliveInterval=15 -o Ciphers=arcfour -o StrictHostKeyChecking=no -o Compression=no';
            }
        } else {
            var sshParam = ' -o IdentityFile=/tmp/id -o StrictHostKeyChecking=no -o Ciphers=arcfour -o ServerAliveInterval=15 -o Compression=no';
        }
    } else {
        var sshParam = ' -o IdentityFile=/tmp/id -o StrictHostKeyChecking=no -o Ciphers=arcfour -o ServerAliveInterval=15 -o Compression=no';
    }

    //check if samba config exist in congig.yaml
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

    //command to mound the backup folder of client
    var mountComand = {
        'server': backupServer,
        'command': mComandTemp,
        'stat': false
    }

    //check includes from config of the client
    if (config.include !== undefined) {
        var includeArr = JSON.parse(config.include);

        for (var i = 0; i < includeArr.length; i++) {
            if (include === undefined) {
                // var include = " --pattern \'+ /tmp/" + cName + "/" + includeArr[i] + "\'";
                var include = ' --pattern \"+ /tmp/' + cName + '/' + includeArr[i] + '\"';
            } else {
                // include = include + " --pattern \'+ /tmp/" + cName + "/" + includeArr[i] + "\'";
                include = include + ' --pattern \"+ /tmp/' + cName + '/' + includeArr[i] + '\"';
            }
        }
        logger.debug(cName + ":includes:" + includeArr);
    }

    //check excludes from config of the client
    if (config.exclude !== undefined) {
        var excludeArr = JSON.parse(config.exclude);

        for (var x = 0; x < excludeArr.length; x++) {
            if (exclude === undefined) {
                // var exclude = " --pattern \'- /tmp/" + cName + "/" + excludeArr[x] + "\'";
                var exclude = ' --pattern \"- /tmp/' + cName + '/' + excludeArr[x] + '\"';
            } else {
                // exclude = exclude + " --pattern \'- /tmp/" + cName + "/" + excludeArr[x] + "\'";
                exclude = exclude + ' --pattern \"- /tmp/' + cName + '/' + excludeArr[x] + '\"';
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

    //set backupfolder
    if (backupServerConfig.borgcache !== undefined && backupServerConfig.borgcache !== null) {
        var cacheDir = ' BORG_CACHE_DIR=' + backupServerConfig.borgcache;
    } else {
        var cacheDir = '';
    }

    //set borg compression
    if (backupServerConfig.borgcompression == 'lz4') {
        var compression = ' -C lz4';
    } else if (backupServerConfig.borgcompression == 'zlib') {
        var compression = ' -C zlib';
    } else if (backupServerConfig.borgcompression == 'lzma') {
        var compression = ' -C lzma';
    } else {
        var compression = '';
    }

    //write date string for backup  - ddMMMYYYY
    var monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    var date = new Date();
    var day = date.getDate();
    var monthIndex = date.getMonth();
    var year = date.getFullYear();
    var dateformated = day + monthNames[monthIndex] + year;
    var randNum = Math.floor(Math.random() * 1000) + 1

    //if include,exclude exist add to rdiff-backup command
    if (InExclude !== undefined) {
        var borgRunTemp = passphrase + cacheDir + ' borg create' + compression + ' --json ' + InExclude + ' ' + backupServerConfig.backuppath + '/' + cName + '::' + dateformated + '_' + randNum + ' /tmp/' + cName;
    } else {
        var borgRunTemp = passphrase + cacheDir + ' borg create' + compression + ' --json ' + backupServerConfig.backuppath + '/' + cName + '::' + dateformated + '_' + randNum + ' /tmp/' + cName;
    }

    //borg command for backup
    var borgRun = {
        'server': backupServer,
        'command': borgRunTemp,
        'type': 'borg',
        'stat': true
    }

    logger.debug(sName + ":borg command: " + borgRunTemp);

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

    //search in output command, if file "config" and "README" found, than it is a borg repo
    if (dirsArr.indexOf(cName) >= 0) {
        //folder in /backup path exist
        var RepoFiles = [{
            'name': backupServer,
            'arr': [
                {
                    'server': backupServer,
                    'command': 'sudo ls -A1 ' + backupServerConfig.backuppath + '/' + cName,
                    'stat': true
                }
            ]
        }]
        var checkRepoFiles = await sshRun.runCommands(RepoFiles, execServer, backupServer, backupConfig);
        var RepoFiles = checkRepoFiles[0].output.message;
        var dirsArr = RepoFiles.split('\n');
        if (dirsArr.indexOf('config') >= 0 && dirsArr.indexOf('README') >= 0) {
            logger.debug(cName + ': files config and README found, this this a borg repo. Initialise repo not needed');
            //files config and README found, this this a borg repo. Initialise repo not needed
        } else {
            //folder found, but files config and README not found, need inizialise borg repo        
            logger.debug(cName + ': folder found, but files config and README not found, need inizialise borg repo');
            ConfigArr.push(inizialiseBackup);
        }
    } else {
        //folder in /backup path not exist
        logger.debug(cName + ': folder for backup not found, the one new will be created');
        ConfigArr.push(inizialiseBackup);
    }

    //mount, remove shares;
    var uMountTempDir = {
        'server': backupServer,
        'command': "sudo umount /tmp/" + cName,
        'stat': false
    }
    //command to delete the temp folder
    var delTempDir = {
        'server': backupServer,
        'command': "sudo rm -Rf /tmp/" + cName,
        'stat': false
    }

    ConfigArr.push(mkDir);

    logger.debug('Backup respository was not found, inizialise new one');

    ConfigArr.push(mountComand);
    ConfigArr.push(borgRun);

    //check parameter for keep backups
    if (config.keepbackup !== undefined && config.keepbackup !== null) {
        logger.debug(cName + ": Keepbackup option is defined and will be used after backup: " + config.keepbackup);
        var keepBackup = passphrase + ' borg prune --keep-daily=' + config.keepbackup + ' ' + backupServerConfig.backuppath + '/' + cName;
        var keepBackupComm = {
            'server': backupServer,
            'command': keepBackup,
            'stat': true
        }
        ConfigArr.push(keepBackupComm);
    } else {
        if (backupServerConfig.keepbackup !== undefined && backupServerConfig.keepbackup !== null) {
            logger.debug(cName + ": Keepbackup option is in container/server not defined, use from backupserver " + backupServerConfig.keepbackup);
            var keepBackup = passphrase + ' borg prune --keep-daily=' + backupServerConfig.keepbackup + ' ' + backupServerConfig.backuppath + '/' + cName;
            var keepBackupComm = {
                'server': backupServer,
                'command': keepBackup,
                'stat': true
            }
            ConfigArr.push(keepBackupComm);
        } else {
            var fullafter = "";
            logger.debug(cName + ": Next full backup is not defined. Only inc backups");
        }
    }

    ConfigArr.push(uMountTempDir);
    ConfigArr.push(delTempDir);

    //create postRun
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

    // console.log(ConfigArr);

    return new Promise((resolve, reject) => {
        return resolve(commandObj);
    })
}

module.exports = {
    createBackupCommands
}