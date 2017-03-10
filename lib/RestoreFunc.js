"use strict";

/*
 * 1. Check Config
 * 2. mount sshfs
 * 3. Restore data
 */

var path = require('path');
var fs = require('fs');
var ssh2 = require('ssh2');
var clientscp = require('scp2');
var yaml2json = require('yamljs');
var async = require('async');
var constants = require('./Constants');
var moduleBackupConfig = require('./BackupConfig');
module.exports = RestoreFunc;

function RestoreFunc(pLogger, pProgram, pServerConfig, pSSHKeyPath, pTarget) {
  this.logger = pLogger;
  this.program = pProgram;
  this.serverconfig = pServerConfig;
  this.sshkeypath = pSSHKeyPath;
  this.target = pTarget;

  this.starter = this.serverconfig.starter;
  this.execServer = this.serverconfig.clientserver[this.program.exec];
  this.targetServer = this.serverconfig.backupserver[this.program.server];

  this.dockerfilesarr = [];
  this.dockerBackupCounter = 0;
  //this.target = this._convertYamlJson(this.targetServer); //convert prerun to json array 
}

RestoreFunc.prototype._restore = function () {
  var self = this;

  var serverFromRestore = self.program.server;
  //self._restoreStart(custPaht, serverToRestore, serverFromRestore);

  if (self.program.pathdefault !== undefined) {
    var reServer = self.program.pathdefault;
    var backupPath = self.serverconfig.clientserver[reServer].backup;
    if (backupPath !== undefined && backupPath !== null) {
      rePath = backupPath;
      var pathsplit = path.parse(rePath);
      self.logger.debug(pathsplit);
      var rePath = pathsplit.dir;
      var reFolder = pathsplit.base;
      self._restoreStart(rePath, reFolder, reServer, serverFromRestore);
    } else {
      self.logger.error("path not defined.Exit");
      process.exit(0);
    }

  } else {
    if (self.program.pathcustom !== undefined) {
      var pathCust = self.program.pathcustom;
      var split = pathCust.split(":");

      if (split.length > 1) {
        var reServer = split[0];
        var rePath = split[1];
        var pathSplit = path.parse(rePath);
        var reFolder = pathSplit.base;
        self._restoreStart(rePath, reFolder, reServer, serverFromRestore);
      } else {
        self.logger.error("-c parameter not comletetd (server:path).Exit");
        process.exit(1);
      }
      ;
    } else {
      self.logger.error("Path is empty. Exit");
      process.exit(1);
    }
  }
};

RestoreFunc.prototype._restoreStart = function (pRestorePath, pRestoreFolder, serverToRestore, serverFromRestore) {
  var self = this;
  var restoreObj = {
    'target': serverToRestore,
    'server': serverFromRestore,
    'rePath': pRestorePath,
    'reFolder': pRestoreFolder
  };
  self.logger.debug("Restore object: ", restoreObj);

  if (self.targetServer.tmpdir !== undefined && self.targetServer.tmpdir !== null) {
    var tmpdir = self.targetServer.tmpdir;
  } else {
    var tmpdir = "";
  }

  var sshkey = self.sshkeypath;
  var sshkeyRemote = '/tmp/idRecover';

  var commArr = [];

  var pConfig = self.serverconfig.clientserver[restoreObj.target];

  var backupserver = self.serverconfig.backupserver[restoreObj.server];

  var mkDir = "sudo mkdir -p /tmp/Restore" + serverToRestore + " && echo created";
  if (pConfig.sftpServer !== undefined && pConfig.sftpServer !== null) {
    if (pConfig.sftpServer.sudo !== undefined && pConfig.sftpServer.sudo !== null && pConfig.sftpServer.sudo === true) {
      if (pConfig.sftpServer.path !== undefined && pConfig.sftpServer.path !== null) {
        var sshParam = ' -o ServerAliveInterval=15 -o StrictHostKeyChecking=no -o IdentityFile=' + sshkeyRemote + ' -o sftp_server="/usr/bin/sudo ' + pConfig.sftpServer.path + '"';
      } else {
        self.logger.debug("sfptServer.sudo set to true, but sftpServer.path is not defined, ignore");
        var sshParam = ' -o IdentityFile=' + sshkeyRemote + ' -o ServerAliveInterval=15 -o StrictHostKeyChecking=no -o StrictHostKeyChecking=no';
      }
    } else {
      var sshParam = ' -o IdentityFile=' + sshkeyRemote;
    }
  } else {
    var sshParam = ' -o IdentityFile=' + sshkeyRemote;
  }

  var passphrase = self.targetServer.passphrase;
  if (passphrase !== undefined && passphrase !== null) {
    var duplicityComm = "sudo PASSPHRASE=\"" + passphrase + "\" TMPDIR=\"" + tmpdir + "\" duplicity ";
  } else {
    var duplicityComm = "sudo TMPDIR=\"" + tmpdir + "\" duplicity --no-encryption ";
  }
  
  var duplicityarchiv = self.targetServer.duplicityarchiv;
  if (duplicityarchiv !== undefined && duplicityarchiv !== null) {
    var duplicityArch = " --archive-dir=" + duplicityarchiv;
  } else {
    var duplicityArch = "";
  }

  if (self.program.time !== undefined && self.program.time !== null) {
    var restoreTime = " -t " + self.program.time;
  } else {
    var restoreTime = "";
  }

  if (self.program.overwrite !== undefined) {
    var overwrite = " --force";
  } else {
    var overwrite = "";
  }

  var mountComand = "sudo sshfs " + self.serverconfig.clientserver[restoreObj.target].USER + "@" + self.serverconfig.clientserver[restoreObj.target].HOST + ":" + restoreObj.rePath + "/" + " /tmp/Restore" + serverToRestore + sshParam + " && echo mounted";
  var uMount = "sudo umount /tmp/Restore" + serverToRestore + " && echo umounted";
  var pathDel = "sudo rm -Rf /tmp/Restore" + serverToRestore + " && echo folder was deleted";

  //duplicity --ssh-options="-oIdentityFile='~/.ssh/id_rsa'" --no-encryption /tmp/superdocker/a/data/keybox.intern/ --rsync-options	="--rsync-path='sudo rsync'" rsync://admin2@backup2//a/target/keybox_duplicity
  var duplicitySSHParam = ' --ssh-options=\"-oIdentityFile=\'' + sshkeyRemote + '\'\ -oStrictHostKeyChecking=no -oServerAliveInterval=15 -oStrictHostKeyChecking=no"';
  var duplicityOthPara = restoreTime;
  var duplicityRsyncPara = ' --rsync-options=\'--rsync-path=\"sudo rsync\"\ -e \"ssh -p ' + backupserver.PORT + ' -i ' + sshkeyRemote + '\"\'';
  var rsyncParam = " rsync://" + self.targetServer.USER + "@" + self.targetServer.HOST + "/" + self.targetServer.backuppath + "/" + self.target;

  //if include,exclude exist add to rdiff-backup command
  var duplicityRun = duplicityComm + overwrite + duplicityArch + duplicitySSHParam + duplicityOthPara + duplicityRsyncPara + rsyncParam + " /tmp/Restore" + serverToRestore;

  //delete ssh key
  var delSSH = "sudo rm -Rf " + sshkeyRemote + " && echo ssh key was deleted";

  //add commands to a array
  commArr.push(mkDir);
  commArr.push(mountComand);
  commArr.push(duplicityRun);
  commArr.push(uMount);
  commArr.push(pathDel);
  commArr.push(delSSH);

  self._copyssh(commArr, restoreObj.server);

};

RestoreFunc.prototype._copyssh = function (pCommArr, pServer) {
  var self = this;
  var sshkey = self.sshkeypath;
  var sshkeyremote = '/tmp/idRecover';
  var serverToRun = this.serverconfig.backupserver[pServer];

  clientscp.scp(sshkey, {
    host: serverToRun.HOST,
    username: serverToRun.USER,
    port: serverToRun.PORT,
    privateKey: fs.readFileSync(sshkey),
    path: sshkeyremote
  }, function (err) {
    if (err === null) {
      self.logger.debug("SSH Key was copy to " + serverToRun.HOST);
      self._setpermissionsSSHKey(pCommArr, pServer);
    } else {
      self.logger.error(err);
    }
  });
};

//set permissions of key on exec server
RestoreFunc.prototype._setpermissionsSSHKey = function (pCommArr, pServer) {
  var self = this;
  var sshkey = self.sshkeypath;
  var sshkeyremote = '/tmp/idRecover';
  var serverToRun = this.serverconfig.backupserver[pServer];

  var conn = new ssh2();
  conn.on('ready', function () {
    //console.log('Client :: ready');
    conn.exec("chmod 600 " + sshkeyremote, function (err, stream) {
      if (err)
        throw err;
      stream.on('close', function (code, signal) {
        //console.log('Stream :: close :: code: ' + code + ', signal: ' + signal);
        self.logger.debug("Set permission 600 on " + serverToRun.HOST + ":" + sshkeyremote);
        self._runSSHComm(pCommArr, pServer);
        conn.end();
      }).on('data', function (data) {
      }).stderr.on('data', function (data) {
        self.logger.error("chmod: " + data);
      });
    });
  }).connect({
    host: serverToRun.HOST,
    port: serverToRun.PORT,
    username: serverToRun.USER,
    privateKey: fs.readFileSync(sshkey),
    keepaliveInterval: 30000
        //if run in Windows
        //privateKey: fs.readFileSync('H:/.ssh/id_rsa')
  });
};

RestoreFunc.prototype._runSSHComm = function (pCommArr, pServer) {
  var self = this;
  var sshkey = self.sshkeypath;
  var sshkeyremote = sshkeyremote;
  var serverToRun = this.serverconfig.backupserver[pServer];
  var outputObj = {};

  var funcArr = [];
  for (var i = 0; i < pCommArr.length; i++) {
    (function (command) {
      var runArrCommand = function (pParallelFunc) {
        var conn = new ssh2();
        conn.on('ready', function () {

          self.logger.debug("Start command: " + command + " on " + serverToRun.HOST);
          conn.exec(command, function (err, stream) {
            if (err)
              throw err;
            stream.on('data', function (data) {
              self.logger.debug("Output: " + data);
              outputObj.output += data;
              self.logger.debug("" + data);
            }).stderr.on('data', function (err) {
              outputObj.error += err;
              self.logger.error("Error: " + err);
            }).on('close', function (code) {
              pParallelFunc(null, "" + err);
            });
          });
        }).connect({
          host: serverToRun.HOST,
          port: serverToRun.PORT,
          username: serverToRun.USER,
          privateKey: fs.readFileSync(sshkey),
          keepaliveInterval: 30000
        });
      };
      funcArr.push(runArrCommand);
    })(pCommArr[i]);
  }



  async.series(funcArr, function (err, results) {
    if (err) {
      //pCallBack.call(self, err);
    } else {
      console.log("completed.Exit");
      process.exit(0);
    }
  });
};