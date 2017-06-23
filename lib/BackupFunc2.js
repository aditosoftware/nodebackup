"use strict";

var fs = require('fs');
var ssh2 = require('ssh2');

function backupRun(logger, backupServer, execServer, backupConfig) {
    this.logger = logger;
    this.bServer = backupServer;
    this.eServer = execServer;
    this.bConfig = backupConfig;
    this.sshKeyPath = backupConfig.starter.sshkey
    this.sshkey = fs.readFileSync(this.sshKeyPath, "utf8");
    this.logger.debug(backupConfig.starter);
}

backupRun.prototype.checkSSHConnection = async function (serverName) {
    var self = this;
    var exec = self.bConfig.clientserver[self.eServer]
    var client = self.bConfig.clientserver[serverName]

    return new Promise((resolve, reject) => {
        self.runUnderSSH("hostname", self.sshkey, exec, client)
            .then((sshOutput) => {
                return resolve(sshOutput);
            }, (sshOutputErr) => {
                return reject(sshOutputErr)
            })
    })

};

backupRun.prototype.createBackupPrePostCommands = async function (prepostCom) {
    var self = this;
    var backupServerConfig = self.bConfig.backupserver[self.bServer]

    return new Promise((resolve, reject) => {
        var preArr = [];
        var postArr = [];
        var commObj = {
            'name': self.bServer,
        }
        if (prepostCom == "prerun") {
            if (backupServerConfig.prerun !== undefined && backupServerConfig.prerun !== null) {
                var backupSerPrerun = JSON.parse(backupServerConfig.prerun);
                for (var i = 0; i < backupSerPrerun.length; i++) {

                    var commands = {
                        'server': self.bServer,
                        'command': backupSerPrerun[i],
                        'stat': false
                    }
                    preArr.push(commands);
                    commObj.arr = preArr;
                }
            }
        }

        if (prepostCom == 'postrun') {
            if (backupServerConfig.postrun !== undefined && backupServerConfig.postrun !== null) {
                var backupSerPostrun = JSON.parse(backupServerConfig.postrun);
                for (var i = 0; i < backupSerPostrun.length; i++) {

                    var commands = {
                        'server': self.bServer,
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

backupRun.prototype.createBackupCommandDocker = async function (serversArr) {
    var self = this;
    var allContainerReturn = [];
    var returnArr = [];

    for (var i = 0; i < serversArr.length; i++) {
        var runSt = await self.getAllContainerOnServer(serversArr[i]);
        if (runSt.length >= 0) {
            runSt.map((container) => {
                returnArr.push(container)
            })
        }
    }

    return new Promise((resolve, reject) => {
        return resolve(returnArr);
    })

}

backupRun.prototype.runCommands = async function (toRunArr, splitArrInt) {
    var self = this;
    var outputArr = [];
    var stopAll = false;
    var chunkSize = splitArrInt;

    var createGroupedArray = function (arr, chunkSize) {
        var groups = [], i;
        for (i = 0; i < arr.length; i += chunkSize) {
            groups.push(arr.slice(i, i + chunkSize));
        }
        return groups;
    }

    var groupedCommArr = createGroupedArray(toRunArr, chunkSize);

    for (var x = 0; x < groupedCommArr.length; x++) {
        var commandsArr = groupedCommArr[x];

        for (var i = 0; i < commandsArr.length; i++) {
            var commands = commandsArr[i].arr;

            for (var y = 0; y < commands.length; y++) {
                var eServer = self.bConfig.clientserver[self.eServer]
                var tServer = self.bConfig.clientserver[commands[y].server]
                var commandToRun = commands[y].command;
                var outputObj = {
                    'server': commandsArr[i].name,
                    'command': commandToRun,
                    'output': {
                        'error': '',
                        'message': '',
                        'stat': commands[y].stat
                    }
                }

                var commType = commands[y].type;
                if (commType !== undefined && commType !== null && commType == "duplicity") {
                    outputObj.type = "duplicity";
                } else {
                    outputObj.type = false;
                }

                var connName = commandsArr[i].containerName;
                if (connName !== undefined && connName !== null) {
                    outputObj.server = commandsArr[i].name + "/" + connName;
                }

                try {
                    var outputComm = await self.runUnderSSH(commandToRun, self.sshkey, eServer, tServer);
                    outputObj.output.error = false;
                    outputObj.output.message = outputComm;
                }
                catch (err) {
                    outputObj.output.stat = true;

                    if (outputObj.server == self.bServer) {
                        outputObj.output.error = true;
                        outputObj.output.message = "Backup server : " + self.bServer + " command problem. Output: " + err + " Stopp all next commands.Exit";
                        outputArr.push(outputObj);
                        stopAll = true;
                        break;
                    } else {
                        outputObj.output.error = true;
                        var failover = commandsArr[i].failover;
                        if (failover.run) {
                            try {

                                var eServerFailover = self.bConfig.clientserver[failover.server];
                                var outputComm = await self.runUnderSSH(failover.command, self.sshkey, eServer, eServerFailover);
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

        if (stopAll) {
            stopAll = false;
            break;
        }
    }

    return new Promise((resolve, reject) => {
        return resolve(outputArr);
    })
}

//return arrays of linked containers, where label "backup" is defined
backupRun.prototype.getAllContainerOnServer = async function (server) {
    var self = this;
    var dockerHostConfig = self.bConfig.clientserver[server];
    var execConfig = self.bConfig.clientserver[self.eServer];
    var containerArrCommand = [];
    var getContainers = "echo -e \"GET /containers/json?all=1 HTTP/1.0\r\n\" | sudo nc -U /var/run/docker.sock"

    var dockerOutput = await self.runUnderSSH(getContainers, self.sshkey, execConfig, dockerHostConfig, false);

    var conInfo = dockerOutput.toString().split("\n");
    var httpCode = conInfo[0].replace('HTTP/1.0 ', '').slice(0, 3);

    if (httpCode === "200") {
        var containers = JSON.parse(conInfo[conInfo.length - 2]);
        var conOutArr = []
        for (var i = 0; i < containers.length; i++) {
            var dockerConObj = {};
            var runC = await self.containerProm(containers[i], server);
            if (runC !== undefined) {
                conOutArr.push(runC);
            }
        }

        return new Promise((resolve) => {
            return resolve(conOutArr);
        })
    }
}

backupRun.prototype.containerProm = async function (container, dockerHost) {
    var self = this;
    var dockerHostConfig = self.bConfig.clientserver[dockerHost];
    var execConfig = self.bConfig.clientserver[self.eServer];


    var labels = container.Labels;

    if (labels.backup !== undefined && labels.backup !== null) {
        var slicedName = container.Names[0];
        var containerName = slicedName.slice(1, slicedName.length);
        var getContainerInfo = "echo -e \"GET /containers/" + containerName + "/json HTTP/1.0\r\n\" | sudo nc -U /var/run/docker.sock"

        var getLinksOfCon = await self.runUnderSSH(getContainerInfo, self.sshkey, execConfig, dockerHostConfig, false);
        var conInfo = getLinksOfCon.toString().split("\n");
        var httpCode = conInfo[0].replace('HTTP/1.0 ', '').slice(0, 3);
        var containerObj = {};
        var containerArr = [];
        var commandArrContainer = [];
        var serverConnObj = {};

        if (httpCode === "200") {
            var conParsed = JSON.parse(conInfo[conInfo.length - 2]);
            var conLinksArr = conParsed.HostConfig.Links;
            var nameStr = conParsed.Name;
            var connName = nameStr.slice(1, nameStr.length);
            var containerObj = {
                'name': labels.name
            }

            if (conLinksArr !== undefined && conLinksArr !== null) {
                var tempnameArr = [];
                for (var x = 0; x < conLinksArr.length; x++) {
                    var link = conLinksArr[x];
                    var linkArr = link.split(":");
                    var name = linkArr[0].slice(1, linkArr[0].length);
                    tempnameArr.push(name);
                }

                containerArr = tempnameArr.reduce(function (a, b) {
                    if (a.indexOf(b) < 0) a.push(b);
                    return a;
                }, []);
                //containerArr.push(connName);
            } else {
            }
        } else {
            //reject("get container info error " + httpCode);
        }

        containerObj.links = containerArr;

        var containerCommArr = [];
        var prerun = [];
        var postrun = [];

        if (labels.prerun !== undefined) {
            var prerun = JSON.parse(labels.prerun);
        }
        if (labels.postrun !== undefined) {
            var postrun = JSON.parse(labels.postrun);
        }

        if (labels.strategy == "off") {
            var dockerstop = "sudo docker stop " + connName;
            var dockerstart = 'sudo docker start';
            var links = containerObj.links;
            if (links.length > 0) {
                for (var i = 0; i < links.length; i++) {
                    dockerstop += " " + links[i];
                    dockerstart += " " + links[i];
                }
            }
            prerun.unshift(dockerstop);
            dockerstart += " " + connName;
        }

        //create Objec
        var serverConnObj = {
            'HOST': dockerHostConfig.HOST,
            'USER': dockerHostConfig.USER,
            'PORT': dockerHostConfig.PORT,
            'prerun': prerun,
            'postrun': labels.postrun,
            'strategy': labels.strategy,
            'nextfullbackup': labels.nextfullbackup,
            'noffullbackup': labels.noffullbackup,
            'backup': labels.backup,
            'confprefixes': labels.confprefixes,
            'compression': labels.compression,
            'sftpServer': dockerHostConfig.sftpServer,
            'docker': 'true',
        }

        serverConnObj.failover = {};

        if (labels.startaftererror !== undefined && labels.startaftererror !== null) {
            if (labels.startaftererror == "false") {
                serverConnObj.startaftererror = false;
            } else {
                serverConnObj.startaftererror = true;
                serverConnObj.failover.run = true;
                serverConnObj.failover.command = dockerstart;
                serverConnObj.failover.server = dockerHost;
            }
        } else {
            serverConnObj.startaftererror = true;
            serverConnObj.failover.run = true;
            serverConnObj.failover.command = dockerstart;
            serverConnObj.failover.server = dockerHost;
        }

        if (labels.failovercustom !== undefined && labels.failovercustom !== null) {
            serverConnObj.failover.run = true;
            serverConnObj.failover.command = labels.failovercustom;;
            serverConnObj.failover.server = dockerHost;
        }

        if (labels.name !== undefined && labels.name !== null) {
            serverConnObj.name = labels.name;
        } else {
            serverConnObj.name = connName;
        }

        if (prerun !== undefined && prerun !== null) {
            serverConnObj.prerun = prerun;
        }

        if (postrun !== undefined && postrun !== null) {
            serverConnObj.postrun = postrun;
            if (labels.strategy == "off") {
                postrun.push(dockerstart);
            }
        }

        var connCom = await self.createBackupCommands(serverConnObj, dockerHost, 'true');

        return new Promise((resolve, reject) => {
            return resolve(connCom);
        })

    } else {

    }
}

backupRun.prototype.getAllDockerHost = function (servers) {
    var self = this;
    var DockerHostsArr = [];

    return new Promise((resolve, reject) => {
        for (var i = 0; i < servers.length; i++) {
            var backupClientConfig = self.bConfig.clientserver[servers[i]];

            if (backupClientConfig.docker !== undefined && backupClientConfig.docker !== null) {
                var dockerHost = true;
            } else {
                var dockerHost = false;
            }

            if (dockerHost) {
                DockerHostsArr.push(servers[i]);
            }
        }
        return resolve(DockerHostsArr);
    })
}

backupRun.prototype.createBackupCommandsServer = async function (servers) {
    var self = this;
    var backupServerConfig = self.bConfig.backupserver[self.bServer];
    var serverToBackupArr = [];
    for (var i = 0; i < servers.length; i++) {
        var config = self.bConfig.clientserver[servers[i]];
        if (config.backup !== undefined && config.backup !== null) {
            var backupCommand = await self.createBackupCommands(config, servers[i], false)
            serverToBackupArr.push(backupCommand);
        }
    }

    return new Promise((resolve, reject) => {
        return resolve(serverToBackupArr);
    })
}

//serverConfig, servername, {'dockerhost':true, containername: {
//     'docker': true,
//     'name': contaienername
// }}
backupRun.prototype.createBackupCommands = async function (serverConfig, server, dockerType) {
    var self = this;
    var backupServerConfig = self.bConfig.backupserver[self.bServer];

    var ConfigArr = [];
    var config = serverConfig;
    var sName = server;

    if (dockerType) {
        var cName = config.name
        var dockerHost = true;
        if (containerName !== undefined && containerName !== null && containerName !== false) {
            var containerName = containerName;
        }
    } else {
        var cName = sName;
        var dockerHost = false;
        containerName = null;
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
        'server': self.bServer,
        'command': "sudo mkdir -p /tmp/" + cName,
        'stat': false
    }
    var checkBackupDir = {
        'server': self.bServer,
        'command': "sudo mkdir -p " + backupServerConfig.backuppath + "/" + cName,
        'stat': false
    }
    if (config.sftpServer !== undefined && config.sftpServer !== null) {
        if (config.sftpServer.sudo !== undefined && config.sftpServer.sudo !== null && config.sftpServer.sudo === true) {
            if (config.sftpServer.path !== undefined && config.sftpServer.path !== null) {
                var sshParam = ' -o ServerAliveInterval=15 -o StrictHostKeyChecking=no -o StrictHostKeyChecking=no -o Compression=no -o IdentityFile=/tmp/id -o sftp_server="/usr/bin/sudo ' + config.sftpServer.path + '"';
            } else {
                self.logger.debug("sfptServer.sudo set to true, but sftpServer.path is not defined, ignore");
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

            self.logger.debug(config + " SMB Share found");
        } else {
            self.logger.error(config + " SMB Share is not defined");
        }
    } else {
        var mComandTemp = "sudo sshfs -p " + config.PORT + " " + config.USER + "@" + config.HOST + ":" + config.backup + " /tmp/" + cName + sshParam;
    }

    var mountComand = {
        'server': self.bServer,
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
        self.logger.debug(cName + ":includes:" + includeArr);
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
        self.logger.debug(cName + ":excludes:" + excludeArr);
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
        self.logger.debug(cName + ": Next full backup will be start after: " + config.nextfullbackup);
    } else {
        var fullafter = "";
        self.logger.debug(cName + ": Next full backup is not defined. Only inc backups");
    }

    //check compression
    if (config.compression === false) {
        var duplicityCompress = ' --gpg-options "--compress-algo none"';
        self.logger.debug("Compression on " + cName + " is disabled");
    } else {
        var duplicityCompress = "";
        self.logger.debug("Compression on " + cName + " is enabled");
    }

    var passphrase = backupServerConfig.passphrase;
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

    self.logger.debug(sName + ":duplicity command: " + duplicityRunTemp);

    var duplicityRun = {
        'server': self.bServer,
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
        self.logger.debug(cName + ":preRun found: " + preRunArr);
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
        self.logger.debug(sName + ":postRun found: " + postRun);
    }

    var uMountTempDir = {
        'server': self.bServer,
        'command': uMount,
        'stat': false
    }

    var delTempDir = {
        'server': self.bServer,
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
        if (config.startaftererror) {
            commandObj.failover = config.failover;
        } else {
            commandObj.failover = false;
        }
    } else {
        commandObj.containerName = null;
        commandObj.failover = false;
    }

    return new Promise((resolve, reject) => {
        return resolve(commandObj);
    })
}

//server1 - exec, server2 - sshRun client
//Exec Object = { HOST: 'backup2.aditosoftware.local',
//   USER: 'admin2',
//   PORT: '22' 
// }
backupRun.prototype.runUnderSSH = async function (command, sshkey, server1, server2, doOutput) {
    var self = this;
    var fserConf = server1;
    var sserConf = server2;
    var output = "";
    return new Promise((resolve, reject) => {
        var conn1 = new ssh2;
        var conn2 = new ssh2;

        conn1.on('error', function (err) {
            conn1.end();
            return reject(err);
        });

        conn1.on('ready', function () {
            self.logger.debug("Start connection to exec: " + sserConf.HOST);
            conn1.exec("nc " + sserConf.HOST + " " + fserConf.PORT, function (err, stream) {
                if (err) {
                    conn1.end();
                    return reject(err);
                } else {
                    stream.stderr.on('data', function (data) {
                        self.logger.error("error on " + fserConf.HOST + ":" + data);
                        conn1.end();
                        return reject("" + data);
                    });
                }
                conn2.connect({
                    sock: stream,
                    username: sserConf.USER,
                    privateKey: sshkey,
                    readyTimeout: 15000,
                    keepaliveInterval: 10000
                });
            });
        });

        conn2.on('ready', function () {
            self.logger.debug("Start connection to " + sserConf.HOST + " through " + fserConf.HOST);
            self.logger.debug("Server: " + sserConf.HOST + ": " + command);
            conn2.exec(command, function (err, stream) {
                if (err) {
                    self.logger.error("error on " + sserConf.HOST + ": command - " + command);
                    stream.end();
                    conn2.end();
                    conn1.end();
                    return reject(err);
                }
                stream.on('close', function (code, signal) {
                    self.logger.debug('Command ' + command + ' run code: ' + code);
                });
                stream.on('end', function () {
                    stream.end();
                    conn2.end();
                    conn1.end(); // close parent (and this) connection 

                    return resolve(output);
                }).on('data', function (data) {
                    if (doOutput === false) {
                        self.logger.debug("Output command: " + command + ": output ok");
                    } else {
                        self.logger.debug("Output command: " + command + ": " + data.toString());
                    }
                    output += data.toString();
                }).stderr.on('data', function (err) {
                    return reject("Connection through " + fserConf.HOST + " to " + sserConf.HOST + " ERR: " + err);
                });
            });
        });

        conn1.connect({
            host: fserConf.HOST,
            port: fserConf.PORT,
            username: fserConf.USER,
            privateKey: sshkey,
            readyTimeout: 15000,
            keepaliveInterval: 10000
        });
    });
}

backupRun.prototype.deleteSSHKey = function () {
    var self = this;
    var execServer = self.bConfig.clientserver[self.eServer];
    var runOnServer = execServer;

    return new Promise((resolve, reject) => {
        self.runUnderSSH('rm -Rf /tmp/id', self.sshkey, execServer, runOnServer)
            .then((result) => {
                self.logger.debug("SSH key was delete from " + self.eServer);
                return resolve(result);
            }, (error) => {
                self.logger.error("Cannot delete ssh key from " + self.eServer);
                return reject(error);
            })
    })

}

backupRun.prototype.copySSHKey = async function () {
    var self = this;
    var conn = new ssh2();
    var localpath = self.sshKeyPath;
    var remotepath = "/tmp/id";
    var execServer = self.bConfig.clientserver[self.eServer];

    return new Promise((resolve, reject) => {
        conn.on('error', function (err) {
            conn.end();
            self.logger.debug("SSH Key: " + localpath);
            self.logger.debug("PORT: " + execServer.PORT);
            return reject("Copy ssh key failed: " + err);
        });

        conn.on('ready', function () {
            conn.sftp(function (err, sftp) {
                if (err) {
                    return reject(err);
                } else {
                    var readStream = fs.createReadStream(localpath);
                    var writeStream = sftp.createWriteStream(remotepath);

                    writeStream.on('close', function () {
                        sftp.end();
                        conn.end();
                        self.logger.debug("SSH Key was copy to " + self.eServer);
                        self.runUnderSSH("chmod 600 /tmp/id", self.sshkey, execServer, execServer)
                            .then((result) => {
                                self.logger.debug('Copy of ssh key was successfull');
                                return resolve("Copy of ssh key was successfull");
                            }, (err) => {
                                self.logger.error('cannot set sshkey permissions: ' + err);
                                return reject("cannot set sshkey permissions " + err);
                            })
                    });
                    readStream.pipe(writeStream);
                }
            });
        });
        conn.connect({
            host: execServer.HOST,
            port: execServer.PORT,
            username: execServer.USER,
            privateKey: fs.readFileSync(localpath),
            keepaliveInterval: 30000
        });
    })
}

module.exports = backupRun;