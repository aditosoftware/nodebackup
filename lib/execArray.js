
var sshComm = require('./sshFunc');
var fs = require('fs');
var helpf = require('./helpFunc');

var runCommands = async function (toRunArr, eServer, bServer, backupConfig) {
    var outputArr = [];
    var stopAll = false;
    var pidsfolder = backupConfig.starter.pids;    

    for (var i = 0; i < toRunArr.length; i++) {
        var commands = toRunArr[i].arr;
        var pidfile = pidsfolder + '/' + toRunArr[i].pidnm + '.pid';

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
    runCommands
}