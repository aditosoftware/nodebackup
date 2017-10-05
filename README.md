# Nodebackup

Nodebackup is a program written in Node.js.
This program can save the data of a server (folder), docker container volumes and also kubernetes deploy volumes (you need to define the annotations)

We use for backup the [duplicity](http://duplicity.nongnu.org)

## Docker container

We've build a docker container with nodebackup [here](https://hub.docker.com/r/adito/nodebackup/)

You need only to mount the id_rsa(ssh private key), crontab.tmp and config.yaml
Show the example for docker-compose (docker-compose.yaml)

## Description
We have three differen type of server:
1. Server - normalserver
2. Docker Host - dockerhost
3. Kubernetes deploy (this is the same, as the docker host)

### Schema
1. Starter,exec,server,client are different server

a. Starter started Nodebackup on exec.\
b. Exec started a backupjob, defined in config.yml \
c. The backupdate will be transferd through exec server

 ![schema1](schema/starter-exec-client-server.png)


2. Starter, exex/client, server exec and client are the same server.
 
a. Starter started Nodebackup on exec.\
b. exec startet backupjob on the same server

 ![schema2](schema/starter-exec-server.png)

## Requiments
### Node.js

Install Node.js, you need version 7 or higher (with support of async/await)\
Install npm packages from packages.json
Run

    npm i

### Duplicity 

You need to install [duplicity](http://duplicity.nongnu.org) on exec

### SSHFS

Install this on exec server

### CIFS

Install cifs, if you'll backup a samba share (for example windows share)

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

You need to save the **config.yml** in the same folder as nodebackup. Config.yml is a file in YAML format
You can show a example - config_example.yaml

### Starter configuration

Starter
    
    starter:
        sshkey: id_rsa 
        log:
          path: /var/log/backupexecv2
        pids: /var/run/nodebackup

**sshkey** - path to ssh key \
**log** - path to folder of log files \
**pids** - the running backupjob create a pid file, if a pidfile exist, then an backupjob cannot start

### Backupserver configuration

Backup Server (Server, which save the backup)

    backupserver:
      backup2:
        passphrase: LkalmflkAJMAlkjfslk
        HOST: backup2.domain.local
        USER: admin2
        PORT: '22'
        backuppath: /a/target
        backupfor: '["freepbx", "superdocker"]'
        backuppartsize: 200
        tmpdir: /tmp
        prerun: '["echo backupserver_prerun1", "echo backupserver_prerun1"]'
        postrun: '["echo backupserver_postrun1", "echo backupserver_postrun1"]'
        
**backup2** - name of the server. You can define more the on backup server \
**HOST** - DNS name of server. IP address is possible \
**USER** - user for authentification \
**PORT** - ssh port \
**backuppartsize** (optional) - size of backup archiv parts. If not defined, set to default (100mb) \
**backuppath** - path where the nodebackup will be save backups. Example: /a/target/clientname/path-from-clientconfig-backup \
**backupfor** - server from config/clientserver \
**prerun** - a command to run befor start backup. You can run a script, that is saved on target server \
**postrun** - a command to run after backup. \
**tmpdir** - folder for temporary files of duplicity (only a backuppart) \

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
        passphrase: "lasdkfasdf0)!=LfkajsdfL"
        sftpServer:
          sudo: true
          path: /usr/lib/sftp-server  
            
**freepbx** - alias of the server \
**HOST** - DNS name of server. IP address is possible \
**USER** - user for authentification \
**PORT** - ssh port \
**noffullbackup**(optional) - number of fullbackups on server. Equivalent to duplicity "duplicity remove-all-but-n-full" \
**nextfullbackup**(optional) - age of a fullbackup.Equivalent to duplicity "full-if-older-than" \
**prerun** - a command to run befor start backup. You can run a script, that is saved on target server \
**postrun** - a command to run after backup. \
**confprefixes** - add paramater for rdiff-backup, more information in man rdiff-backup. You don't need to write "--" \
**sftpServer** - if you will use sudo on client, you need to define where is sfpt-server (use command "whereis sftp-server") \
**compression** - default true \
**passphrase** - duplicity passphrase, can now for each server or container defined \


### Client Server (Dockerhost)

Docker Host configuration in **config.yaml** file

    clientserver:
      superdocker:
        docker: "true"
        HOST: superdocker.domain.local
        USER: docker
        PORT: '22'

Kubernetes configuration in **config.yaml** file

    heku1:
        HOST: k8s-node1.example.com
        USER: root
        PORT: 22
        kube: true
        namespaces: '["fortesting"]'

**namespaces**(optional) - if defined, the nodebackup will be show only this one namespace, it not defined, then nodebackup will be check all namespaces in k8s cluster. \

**IMPORTANT** you need to install the kubectl on server, the backupjob used this tool to delete and creat the k8s deploys.

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
        passphrase: "lasdkfasdf0)!=LfkajsdfL"
        name: backup-new-test
        
        
#### Samba Share
    
    SMB:
      SET: "true"
      PATH: "d$"
      PASS: "AD User Pass"
      DOMAIN: "example.local"

#### kubernetes deploy (show example "echoserver-dep.yaml)

    
    nextfullbackup: "1W"
    noffullbackup: "2"
    backup: "/cephfs/derby"
    strategy: "off"
    passphrase: "containerPASS"

**name**(optional) - name of container in backup, if not defined then the backupjob will be use the name of container. 
**SMB** - Samba Config \
**PATH**  - Path on server (like \\server\d$) \
**PASS** - AD User Pass \
**DOMAIN** - AD Domain \
**strategy: off** - container/s or deploy will be shutdown befor backup (docker-compose -f /path/docker-compose.yml stop) and start again after backup \
**strategy: on** - backup will be run without shutdown the container or kubernetes deploy \
**startaftererror** - start container after error (prerun,postrun,backup). Default true \
**passphrase** - duplicity passphrase, can now for each server or container defined \
**failovercustom** - if container commands prerun,backup,postrun run in a error, then you can define a failovercustom command, the normal command is "sudo docker start CONTAINERNAME" \

other option are equivalent to clientserver configuration

#### Prerun and postrun will be run on docker host not in container, if you will run a command in conainer you can use "docker exec": 

    prerun: '["sudo docker-run exec -it containername command"]'

## Usage

    #:/nodejs/nodebackup$ node BackupExecV2.js -h

    Options:

        -h, --help             output usage information
        -V, --version          output the version number
        -b, --backup           start backup
        -e, --exec [exec]      server, which start backup job
        -t, --target [target]  single server for backup
        -s, --server [server]  backup server
        -d, --debug            debug to console
        -f, --debugfile        debug to file
        -r, --restore          starte restore
        -p, --path [path]      Paht server:/path
        -m, --time [time]      backup from [time]
        -o, --phrase [phrase]  duplicity passphrase

### Example 
    
    node BackupExecV2 -b -e backup2 -s backup2
    
I've used here backup2 as exec and target server

### Backup of a single server 
With "-t name" can you make a single backup

    node BackupExecV2 -b -e backup2 -s backup2 -t freepbx
    
#### Single backup of a docker container or kubernetes deploy

    node BackupExecV2 -b -e backup2 -s backup2 -t backup-new-test

### Restore

#### Restore a container "backup-new-test" from backup2 server on freepbx server. This option working only on normal server
    
    sudo node BackupExecV3.js -r -e backup2 -s backup2 -p freepbx:/tmp -o DUPLICITY-PASSPHRASE
    
#### Restore a backup from date: s,m,h,D,W,M,Y
    sudo node BackupExecV3.js -r -e backup2 -s backup2 -p freepbx:/tmp -o DUPLICITY-PASSPHRASE -m 2M

### Output

    Name               StartTime                 ElapsedTime          Increment Files Size  Total Size changed  Errors
    -----------------  ------------------------  -------------------  --------------------  ------------------  ------
    freepbx            Tue Feb 23 14:48:18 2016  1.54 (1.54 seconds)  0                     0 (0 bytes)         0
    superdocker/backup-new-test-2  Tue Feb 23 14:48:20 2016  2.27 (2.27 seconds)  0                     0 (0 bytes)         0
    superdocker/backup-new-test    Tue Feb 23 14:48:20 2016  2.05 (2.05 seconds)  0                     0 (0 bytes)         0

