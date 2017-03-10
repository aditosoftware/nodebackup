# BackupNode

BackupNode is a program written in Node.js to make backup of server and docker hosts.
The possible backups are only data.

We use for backup the [duplicity](http://duplicity.nongnu.org)

## Description
We have two differen type of server:
1. Server - normalserver
2. Docker Host - dockerhost

### Schema
1. Starter,exec,server,client are different server
    (show image starter-exec-client-server.png in schema)
 a. Starter started BackupNode on exec.
 b. Exec started a backupjob, defined in config.yml 
 c. The backupdate will be transferd through exec server

2. Starter, exex/client, server exec and client are the same server. 
    (show image starter-exec-server.png in schema)
 a. Starter started BackupNode on exec.
 b. exec startet backupjob on the same server

## Requiments
### Node.js

Install Node.js, you need version 7 or higher (async/await)
Install npm packages from packages.json
Run

    npm i

### Duplicity 

You need to install duplicity (last 0.6) on exec

### SSHFS

Install this on exec server

### Docker

Install docker and docker-compose. The nodebackup run docker-compose stop to stop docker-container and docker-compose start to start container again. The information of container muss be save in a docker-compose.yml file. You need a separate folder for each docker-compose file.

### Firewall

Open SSH Port between exec<->target, exec<->client. You can define another ssh port (default 22). The ssh port is defined in config file for each server

### SSH Key

Authentification between starter, exec, target, client used ssh key. SSH key path is defined in config (starter/sshkey)

If the key not exist run on starter

    ssh-keygen
    ssh-copy-id {username}@exec
    ssh-copy-id {username}@target
    ssh-copy-id {username}@client
    
Now you can use this key for authentification. Add path of ssh key to config

Nodebackup will be copy this key to exec server, when backup job is completed key will be deleted.

## Configuration file

You need to save the config.yml in the same folder as nodebackup. Config.yml is a file in YAML format
You can show a example - config_example.yaml

### Starter configuration

Starter
    
    starter:
        sshkey: id_rsa 
        log:
          path: /var/log/backupexecv2

sshkey - path to ssh key
log - path to folder of log files

### Backupserver configuration

Backup Server (Server, which save the backup)

    backupserver:
      backup2:
        HOST: backup2.domain.local
        USER: admin2
        PORT: '22'
        maxjobs: 5
        backuppath: /a/target
        backupfor: '["freepbx"]'
        backuppartsize: 200
        tmpdir: /tmp
        prerun: '["echo backupserver_prerun1", "echo backupserver_prerun1"]'
        postrun: '["echo backupserver_postrun1", "echo backupserver_postrun1"]'
        
backup2 - name of the server. You can define more the on backup server
HOST - DNS name of server. IP address is possible
USER - user for authentification
PORT - ssh port
maxjobs (optional) - number of backupjob at the same time running. If not defined default is 3
backuppartsize (optional) - size of backup archiv parts. If not defined, set to default (100mb)
backuppath - path where the nodebackup will be save backups. Example: /a/target/clientname/path-from-clientconfig-backup
backupfor - server from config/clientserver
prerun - a command to run befor start backup. You can run a script, that is saved on target server
postrun - a command to run after backup.
tmpdir - folder for temporary files of duplicity (only a backuppart)

### Client Server (Server)

Client server

    clientserver: 
      freepbx:
        HOST: sip.example.com
        USER: root
        PORT: '22'
        nextfullbackup: 1m
        noffullbackup: 2
        backup: /var/spool/asterisk/backup/daily
        prerun: '["echo prerun1","echo prerun2"]'
        postrun: '["echo postrun1", "echo postrun2"]'
        confprefixes: '["asynchronous-upload"]'
        compression: "true/false"
        sftpServer:
          sudo: true
          path: /usr/lib/sftp-server  
            
freepbx - alias of the server
HOST - DNS name of server. IP address is possible
USER - user for authentification
PORT - ssh port
noffullbackup(optional) - number of fullbackups on server. Equivalent to duplicity "duplicity remove-all-but-n-full"
nextfullbackup(optional) - age of a fullbackup.Equivalent to duplicity "full-if-older-than"
prerun - a command to run befor start backup. You can run a script, that is saved on target server
postrun - a command to run after backup.
confprefixes - add paramater for rdiff-backup, more information in man rdiff-backup. You don't need to write "--"
sftpServer - if you will use sudo on client, you need to define where is sfpt-server (use command "whereis sftp-server")
compression - default true


### Client Server (Dockerhost)

Docker Host

    clientserver:
      superdocker:
        docker: "true"
        HOST: superdocker.domain.local
        USER: docker
        PORT: '22'
        
dockercompose - a path on this server, where notebackup search for docker-compose.yml files (grep -ril "label:" --include=docker-compose.yml)
You can use both option  - "dockercompose" and "backup" on the same server

#### docker-compose.yml example

    httpd:
      image: httpd
      hostname: backup-new-test-2
      volumes:
        - /a/data/backup-new-test-2/httpdocs:/a/http
        - /a/data/backup-new-test-2/httpconf:/a/conf
      restart: always
      labels:
        backup: /a/data/backup-new-test-2
        prerun: '["touch /tmp/id2.test", "echo test >> /tmp/id2.test"]'
        postrun: '["cat /tmp/id2.test", "rm /tmp/id2.test"]'
        strategy: 'off'
        include: '[ "/a/data/backup-new-test-2/inc1", "/a/data/backup-new-test-2/inc2", "/a/data/backup-new-test-2/inc3" ]'
        exclude: '[ "/a/data/backup-new-test-2/ex1", "/a/data/backup-new-test-2/ex2", "/a/data/backup-new-test-2/ex3" ]'
        compression: "false"
        startaftererror: "false"
        failovercustom: "echo test"
        
##### Samba Share
    
    SMB:
      SET: "true"
      PATH: "d$"
      PASS: "AD User Pass"
      DOMAIN: "example.local"

SMB - Samba Config
PATH  - Path on server (like \\server\d$)
PASS - AD User Pass
DOMAIn - AD Domain
strategy: off - container will be shutdown befor backup (docker-compose -f /path/docker-compose.yml stop) and start again after backup
strategy: on - backup will be run without shutdown the container
startaftererror - start container after error (prerun,postrun,backup). Default true
failovercustom: if container commands prerun,backup,postrun run in a error, then you can define a failovercustom command, the normal command is "sudo docker start CONTAINERNAME"
other option are equivalent to clientserver configuration

#### Prerun and postrun will be run on docker host not in container, if you will run a command in conainer you can use "docker exec": 

    prerun: '["sudo docker-run exec -it containername command"]'

## Usage

    #:/nodejs/nodebackup$ node BackupExecV2.js -h

  Options:

    -h, --help                       output usage information
    -V, --version                    output the version number
    -e, --exec [exec]                server, which start backup job
    -t, --target [target]            single server for backup
    -s, --server [server]            backup server
    -d, --debug                      debug to console and file (Date.log saved in starter:log:path)
    -f, --debugfile                  debug only to file (DATE_debug.log saved in starter:log:path)
    -r, --restore                    starte restore
    -c, --pathcustom [pathcustom]    path to restore data (custom path)
    -o, --overwrite                  overwrite existing folder by recovery
    -p, --pathdefault [pathdefault]  default path from config.yml
    -m, --time [time]                backup from [time]
    -i, --verify                     verify all backups on a backup server


### Example 
    
    node BackupExecV2 -e backup2 -s backup2
    
I've used here backup2 as exec and target server

### Backup of a single server 
With "-t name" can you make a single backup

    node BackupExecV2 -e backup2 -s backup2 -t freepbx
    
#### Single backup of a docker container

Nodebackup search in folder (defined in dockercompose) docker-compose.yml files and get a array of path

    /a/run/backup-new-test/docker-compose.yml
    /a/run/backup-new-test-2/docker-compose.yml
    
The name of container is folder, which contain docker-compose.yml file.
##### Example (backup-new-test)

    node BackupExecV2 -e backup2 -s backup2 -t backup-new-test

### Restore

#### Restore a container "backup-new-test" from backup2 server on freepbx server. This option working only on normal server
    
    Backup to original path: sudo ./BackupExecV2.js -r -t freepbx -s backup2 -p freepbx -o
    
#### Restore a server to custom server and path. If you need to restore a container use the path of docker host
    
    Backup to custom path: sudo ./BackupExecV2.js -r -t backup-new-test -s backup2 -c freepbx:/tmp:outputFolder -o
    
#### Restore a backup from date: s,m,h,D,W,M,Y

    Backup to custom path: sudo ./BackupExecV2.js -r -t backup-new-test -s backup2 -c freepbx:/tmp:outputFolder -o -m (2D|1W|10s|50m)


### Output

    Name               StartTime                 ElapsedTime          Increment Files Size  Total Size changed  Errors
    -----------------  ------------------------  -------------------  --------------------  ------------------  ------
    freepbx            Tue Feb 23 14:48:18 2016  1.54 (1.54 seconds)  0                     0 (0 bytes)         0
    backup-new-test-2  Tue Feb 23 14:48:20 2016  2.27 (2.27 seconds)  0                     0 (0 bytes)         0
    backup-new-test    Tue Feb 23 14:48:20 2016  2.05 (2.05 seconds)  0                     0 (0 bytes)         0

