#!/bin/bash
#Create Cron job
crontab /crontab.tmp && /usr/sbin/crond -f -d 0