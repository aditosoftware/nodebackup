"use strict";

/*
 * 1. Check Config
 * 2. mount sshfs
 * 3. Restore data
 */

var path = require('path');
var fs = require('fs');
var logger = require('./Logger');
var execArr = require('./execArray');
var helpc = require('./helpFunc');
var sshComm = require('./sshFunc');
module.exports = RestoreFunc;

function RestoreFunc(backupServer, execServer, serverconfig, rPath, backupTime, passPhrase) {
  this.bServer = backupServer;
  this.eServer = execServer;
  this.bConfig = serverconfig;
  this.bTime = backupTime;
  this.pPhrase = passPhrase;
  this.rPath = rPath;
}

//start restore function
RestoreFunc.prototype.startRestore = function (callback) {
  var self = this;
  var pathCust = self.rPath;
  var split = pathCust.split(":");

  if (split.length > 1) { //split the path like freepbx:/tmp in "freepbx" and "temp";
    self.reServer = split[0];
    self.rePath = split[1];

    self.createRestoreCommands() //this function create an array of commands
      .then((recoveryArr) => {
        // recoveryArr = [ { server: 'backupServer',
        //                   command: 'sudo mkdir -p /tmp/Restorefreepbx',
        //                   stat: false },
        //                 { server: 'backupServer',
        //                   command: 'sudo sshfs root@sip.example.com:/tmp/ /tmp/Restorefreepbx -o IdentityFile=/tmp/idRecover',
        //                   stat: false },
        //                 { server: 'backupServer',
        //                   command: 'sudo PASSPHRASE="DUPLICITY-PASSPHRASE" TMPDIR="/backup/backuptemp" duplicity restore  --force  --archive-dir=/backup/duplicityarchiv --ssh-options="-oIdentityFile=\'/tm    p/idRecover\' -oStrictHostKeyChecking=no -oServerAliveInterval=15 -oStrictHostKeyChecking=no" --rsync-options=\'--rsync-path="sudo rsync" -e "ssh -p 22 -i /tmp/idRecover"\' rsync://admin2@backupServer.example.com//backup/freepbx /tmp/Restorefreepbx',
        //                   stat: true },
        //                 { server: 'backupServer',
        //                   command: 'sudo umount /tmp/Restorefreepbx',
        //                   stat: false },
        //                 { server: 'backupServer',
        //                   command: 'sudo rm -Rf /tmp/Restorefreepbx',
        //                   stat: false } ]

        sshComm.copySSHKey(self.eServer, self.bConfig.SSHKey, self.bConfig, 'idRecover') //copy ssh key to exec server
          .then((result) => {
            execArr.runCommands(recoveryArr, self.eServer, self.bServer, self.bConfig) //run created commandsarray
              .then((recoveryResult) => {
                
                return callback(null, recoveryResult);
                
                sshComm.deleteSSHKey(self.eServer, self.bConfig.SSHKey, self.bConfig, 'idRecover'); //delete ssh key after backup from exec server
                
              },(err)=>{
                logger.error(err);
                return callback(err, null);
              })
          }, (err) => {
            logger.error(err);
            return callback(err, null);
          })
      }, (err) => {
        logger.error(err);
        return callback(err, null);
      })

  } else {
    logger.error("-p parameter not comletetd (server:path).Exit");
    return callback(err, null);
    process.exit(1);
  }
}

//function that create the restore commands array
RestoreFunc.prototype.createRestoreCommands = async function () {
  var self = this;
  var commArr = [];
  var reServerConfig = helpc.getServerConfig(self.reServer, '', self.bConfig);
  var sshkeyRemote = '/tmp/idRecover';
  var backupServerConfig = helpc.getServerConfig(self.bServer, 'backup', self.bConfig);
  var clientServerConfig = helpc.getServerConfig(self.reServer, '', self.bConfig);

  var mkDir = {
    'server': self.bServer,
    'command': "sudo mkdir -p /tmp/Restore" + self.reServer,
    'stat': false
  }

  if (backupServerConfig.tmpdir !== undefined && backupServerConfig.tmpdir !== null) {
    var tmpdir = backupServerConfig.tmpdir;
    logger.debug("Duplicity tempfolder is defined : " + tmpdir);
  } else {
    var tmpdir = "";
    logger.debug("Duplicity tempfolder is not defined, use default");
  }

  if (reServerConfig.sftpServer !== undefined && reServerConfig.sftpServer !== null) {
    if (reServerConfig.sftpServer.sudo !== undefined && reServerConfig.sftpServer.sudo !== null && reServerConfig.sftpServer.sudo === true) {
      if (reServerConfig.sftpServer.path !== undefined && reServerConfig.sftpServer.path !== null) {
        var sshParam = ' -o ServerAliveInterval=15 -o StrictHostKeyChecking=no -o IdentityFile=' + sshkeyRemote + ' -o sftp_server="/usr/bin/sudo ' + reServerConfig.sftpServer.path + '"';
      } else {
        logger.debug("sfptServer.sudo set to true, but sftpServer.path is not defined, ignore");
        var sshParam = ' -o IdentityFile=' + sshkeyRemote + ' -o ServerAliveInterval=15 -o StrictHostKeyChecking=no -o StrictHostKeyChecking=no';
      }
    } else {
      var sshParam = ' -o IdentityFile=' + sshkeyRemote;
    }
  } else {
    var sshParam = ' -o IdentityFile=' + sshkeyRemote;
  }

  var passphrase = self.pPhrase;
  if (passphrase !== undefined && passphrase !== null) {
    var duplicityComm = "sudo PASSPHRASE=\"" + passphrase + "\" TMPDIR=\"" + tmpdir + "\" duplicity restore ";
    logger.debug("Duplicity passpharase is defined");
  } else {
    var duplicityComm = "sudo TMPDIR=\"" + tmpdir + "\" duplicity restore --no-encryption ";
    logger.debug("Duplicity passphrase is not defined, backup is not encrypted");
  }

  var duplicityarchiv = backupServerConfig.duplicityarchiv;
  if (duplicityarchiv !== undefined && duplicityarchiv !== null) {
    var duplicityArch = " --archive-dir=" + duplicityarchiv;
  } else {
    var duplicityArch = "";
  }

  if (self.bTime !== undefined && self.bTime !== null) {
    var restoreTime = " -t " + self.bTime;
  } else {
    var restoreTime = "";
  }

  //create object to mount a folder from restoredserver to backupserver through ssh
  var sshMount = "sudo sshfs " + clientServerConfig.USER + "@" + clientServerConfig.HOST + ":" + self.rePath + "/" + " /tmp/Restore" + self.reServer + sshParam;
  var mountCommand = {
    'server': self.bServer,
    'command': sshMount,
    'stat': false
  }

  //command to unmoud ssh folder
  var sshUnmount = "sudo umount /tmp/Restore" + self.reServer;
  var uMountCommand = {
    'server': self.bServer,
    'command': sshUnmount,
    'stat': false
  }

  //command to delete temporaly folder after umount
  var pathDel = "sudo rm -Rf /tmp/Restore" + self.reServer;
  var pathDelCommand = {
    'server': self.bServer,
    'command': pathDel,
    'stat': false
  }

  //duplicity --ssh-options="-oIdentityFile='~/.ssh/id_rsa'" --no-encryption /tmp/superdocker/a/data/keybox.intern/ --rsync-options	="--rsync-path='sudo rsync'" rsync://admin2@backup2//a/target/keybox_duplicity
  var duplicitySSHParam = ' --ssh-options=\"-oIdentityFile=\'' + sshkeyRemote + '\'\ -oStrictHostKeyChecking=no -oServerAliveInterval=15 -oStrictHostKeyChecking=no"';
  var duplicityOthPara = restoreTime;
  var duplicityRsyncPara = ' --rsync-options=\'--rsync-path=\"sudo rsync\"\ -e \"ssh -p ' + backupServerConfig.PORT + ' -i ' + sshkeyRemote + '\"\'';
  var rsyncParam = " rsync://" + backupServerConfig.USER + "@" + backupServerConfig.HOST + "/" + backupServerConfig.backuppath + "/" + self.reServer;

  //if include,exclude exist add to rdiff-backup command
  var duplicityRun = duplicityComm + ' --force ' + duplicityArch + duplicitySSHParam + duplicityOthPara + duplicityRsyncPara + rsyncParam + " /tmp/Restore" + self.reServer;
  var duplicityCommand = {
    'server': self.bServer,
    'command': duplicityRun,
    'stat': true
  }


  //add commands to a array
  commArr.push(mkDir);
  commArr.push(mountCommand);
  commArr.push(duplicityCommand);
  commArr.push(uMountCommand);
  commArr.push(pathDelCommand);

  var commObj = {
    'name': self.reServer,
    'arr': commArr,
    'failover': {
      'run': false
    }
  }

  return new Promise((resolve, reject) => {
    return resolve([commObj]);
  })
}